import { createHash, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';

import { getAdminFirestore } from './firebase-admin';
import { getTaskCosts, taskCost, type ClariftTask } from '@/lib/managed-inference-config';

export { getTaskCosts, taskCost, type ClariftTask } from '@/lib/managed-inference-config';

function nonNegativeInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function reservationId(tenantId: string, idempotencyKey: string) {
  return createHash('sha256').update(`${tenantId}:${idempotencyKey}`).digest('hex');
}

export class InsufficientCreditsError extends Error {
  constructor() {
    super('There are not enough managed credits for this action.');
    this.name = 'InsufficientCreditsError';
  }
}

export interface CreditReservation {
  id: string;
  tenantId: string;
  requestId: string;
  task: ClariftTask;
  estimatedCredits: number;
  status: 'reserved' | 'settled' | 'released' | 'expired';
}

export class IdempotencyInProgressError extends Error {
  constructor() {
    super('A request with this idempotency key is already in progress.');
    this.name = 'IdempotencyInProgressError';
  }
}

export async function reserveCredits(input: {
  tenantId: string;
  principalId: string;
  workspaceId: string;
  task: ClariftTask;
  idempotencyKey: string;
  requestId?: string;
}): Promise<CreditReservation> {
  const firestore = getAdminFirestore();
  const id = reservationId(input.tenantId, input.idempotencyKey);
  const requestId = input.requestId || randomUUID();
  const estimatedCredits = taskCost(input.task);
  const reservationRef = firestore.doc(`creditReservations/${id}`);
  const walletRef = firestore.doc(`creditWallets/${input.tenantId}`);
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);

  return firestore.runTransaction(async (transaction) => {
    const [existing, wallet] = await Promise.all([
      transaction.get(reservationRef),
      transaction.get(walletRef),
    ]);
    if (existing.exists) {
      const data = existing.data() as CreditReservation;
      if (data.tenantId !== input.tenantId) throw new Error('Credit reservation tenant mismatch.');
      if (data.task !== input.task) throw new Error('An idempotency key cannot be reused for a different task.');
      if (data.status === 'settled') return { ...data, id };
      if (data.status === 'reserved') {
        if (data.requestId !== requestId) throw new IdempotencyInProgressError();
        return { ...data, id };
      }
      if (!wallet.exists) throw new Error('The tenant credit wallet is unavailable.');
      const retryBalance = Number(wallet.data()?.balance) || 0;
      const retryReserved = Number(wallet.data()?.reserved) || 0;
      if (estimatedCredits > Math.max(retryBalance - retryReserved, 0)) throw new InsufficientCreditsError();
      transaction.set(reservationRef, {
        status: 'reserved',
        estimatedCredits,
        finalCredits: null,
        requestId,
        updatedAt: now,
        expiresAt,
        releasedAt: null,
        settledAt: null,
      }, { merge: true });
      transaction.set(walletRef, {
        reserved: retryReserved + estimatedCredits,
        version: (Number(wallet.data()?.version) || 0) + 1,
        updatedAt: now,
      }, { merge: true });
      return { id, tenantId: input.tenantId, requestId, task: input.task, estimatedCredits, status: 'reserved' };
    }
    if (!wallet.exists) throw new Error('The tenant credit wallet is unavailable.');
    const balance = Number(wallet.data()?.balance) || 0;
    const reserved = Number(wallet.data()?.reserved) || 0;
    if (estimatedCredits > Math.max(balance - reserved, 0)) throw new InsufficientCreditsError();

    transaction.create(reservationRef, {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      principalId: input.principalId,
      task: input.task,
      status: 'reserved',
      estimatedCredits,
      finalCredits: null,
      requestId,
      idempotencyHash: id,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });
    transaction.set(walletRef, {
      reserved: reserved + estimatedCredits,
      version: (Number(wallet.data()?.version) || 0) + 1,
      updatedAt: now,
    }, { merge: true });
    return { id, tenantId: input.tenantId, requestId, task: input.task, estimatedCredits, status: 'reserved' };
  });
}

export async function settleCredits(reservationIdValue: string, finalCredits?: number) {
  const firestore = getAdminFirestore();
  const reservationRef = firestore.doc(`creditReservations/${reservationIdValue}`);
  return firestore.runTransaction(async (transaction) => {
    const reservation = await transaction.get(reservationRef);
    if (!reservation.exists) throw new Error('Credit reservation not found.');
    const data = reservation.data()!;
    if (data.status === 'settled') return data;
    if (data.status !== 'reserved') throw new Error('Credit reservation is no longer active.');
    const walletRef = firestore.doc(`creditWallets/${data.tenantId}`);
    const wallet = await transaction.get(walletRef);
    const estimated = nonNegativeInteger(data.estimatedCredits, 0);
    const charged = Math.min(nonNegativeInteger(finalCredits, estimated), estimated);
    const balance = Number(wallet.data()?.balance) || 0;
    const reserved = Number(wallet.data()?.reserved) || 0;
    const now = Timestamp.now();
    transaction.set(walletRef, {
      balance: Math.max(balance - charged, 0),
      reserved: Math.max(reserved - estimated, 0),
      lifetimeSpent: (Number(wallet.data()?.lifetimeSpent) || 0) + charged,
      version: (Number(wallet.data()?.version) || 0) + 1,
      updatedAt: now,
    }, { merge: true });
    transaction.set(reservationRef, { status: 'settled', finalCredits: charged, updatedAt: now, settledAt: now }, { merge: true });
    transaction.create(firestore.doc(`creditLedger/spend_${reservationIdValue}`), {
      tenantId: data.tenantId,
      workspaceId: data.workspaceId,
      principalId: data.principalId,
      type: 'usage_charge',
      task: data.task,
      amount: charged,
      balanceDelta: -charged,
      reservationId: reservationIdValue,
      requestId: data.requestId,
      createdAt: now,
    });
    return { ...data, status: 'settled', finalCredits: charged };
  });
}

export async function releaseCredits(reservationIdValue: string, status: 'released' | 'expired' = 'released') {
  const firestore = getAdminFirestore();
  const reservationRef = firestore.doc(`creditReservations/${reservationIdValue}`);
  return firestore.runTransaction(async (transaction) => {
    const reservation = await transaction.get(reservationRef);
    if (!reservation.exists || reservation.data()?.status !== 'reserved') return false;
    const data = reservation.data()!;
    const walletRef = firestore.doc(`creditWallets/${data.tenantId}`);
    const wallet = await transaction.get(walletRef);
    const now = Timestamp.now();
    transaction.set(walletRef, {
      reserved: Math.max((Number(wallet.data()?.reserved) || 0) - (Number(data.estimatedCredits) || 0), 0),
      version: (Number(wallet.data()?.version) || 0) + 1,
      updatedAt: now,
    }, { merge: true });
    transaction.set(reservationRef, { status, updatedAt: now, releasedAt: now }, { merge: true });
    return true;
  });
}

export async function grantCredits(input: {
  tenantId: string;
  amount: number;
  grantId: string;
  type: 'credit_pack' | 'subscription_cycle' | 'admin_adjustment' | 'migration';
  sourceId?: string | null;
  createdBy?: string;
}) {
  const amount = nonNegativeInteger(input.amount, 0);
  if (!amount) throw new Error('Credit grant amount must be positive.');
  const firestore = getAdminFirestore();
  const id = createHash('sha256').update(`${input.tenantId}:${input.grantId}`).digest('hex');
  const ledgerRef = firestore.doc(`creditLedger/grant_${id}`);
  const walletRef = firestore.doc(`creditWallets/${input.tenantId}`);
  return firestore.runTransaction(async (transaction) => {
    const [existing, wallet] = await Promise.all([transaction.get(ledgerRef), transaction.get(walletRef)]);
    if (existing.exists) return false;
    if (!wallet.exists) throw new Error('The tenant credit wallet is unavailable.');
    const now = Timestamp.now();
    transaction.create(ledgerRef, {
      tenantId: input.tenantId,
      type: input.type,
      amount,
      balanceDelta: amount,
      grantId: input.grantId,
      sourceId: input.sourceId ?? null,
      createdBy: input.createdBy ?? 'system',
      createdAt: now,
    });
    transaction.set(walletRef, {
      balance: (Number(wallet.data()?.balance) || 0) + amount,
      lifetimeGranted: (Number(wallet.data()?.lifetimeGranted) || 0) + amount,
      version: (Number(wallet.data()?.version) || 0) + 1,
      updatedAt: now,
    }, { merge: true });
    return true;
  });
}
