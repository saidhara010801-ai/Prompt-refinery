import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';

import {
  FREE_EVALUATION_DAILY_UNITS,
  FREE_EVALUATION_MONTHLY_UNITS,
  FREE_REFINEMENT_DAILY_UNITS,
  FREE_REFINEMENT_MONTHLY_UNITS,
  PRO_REFINEMENT_DAILY_UNITS,
  PRO_REFINEMENT_MONTHLY_UNITS,
  FREE_TASK_UNITS,
  chooseBasicModeStatus,
  nextUtcDay,
  quotaPeriodKeys,
  taskAllowanceKind,
  type FreeInferenceAllowance,
  type FreeInferenceTask,
} from '@/lib/free-inference';
import { acquireConcurrencySlot, releaseConcurrencySlot } from './distributed-limits';
import { getAdminFirestore } from './firebase-admin';
import type { TenantContext } from './tenant-service';
import type { OpenModelProvider } from './open-model-client';
import { getEffectiveUserEntitlement } from './user-access';

export type InferenceAllowancePlan = 'free' | 'pro';

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function id(...parts: string[]) {
  return createHash('sha256').update(parts.join(':')).digest('hex');
}

export function inferenceAllowancePlan(plan: string | null | undefined): InferenceAllowancePlan {
  return plan === 'individual' || plan === 'pro' || plan === 'pro-max' ? 'pro' : 'free';
}

export function quotaLimits(kind: 'refinement' | 'evaluation', plan: InferenceAllowancePlan = 'free') {
  return kind === 'refinement'
    ? {
        daily: plan === 'pro'
          ? positiveNumber(process.env.CLARIFT_PRO_REFINEMENT_DAILY_UNITS, PRO_REFINEMENT_DAILY_UNITS)
          : positiveNumber(process.env.CLARIFT_FREE_REFINEMENT_DAILY_UNITS, FREE_REFINEMENT_DAILY_UNITS),
        monthly: plan === 'pro'
          ? positiveNumber(process.env.CLARIFT_PRO_REFINEMENT_MONTHLY_UNITS, PRO_REFINEMENT_MONTHLY_UNITS)
          : positiveNumber(process.env.CLARIFT_FREE_REFINEMENT_MONTHLY_UNITS, FREE_REFINEMENT_MONTHLY_UNITS),
      }
    : {
        daily: positiveNumber(process.env.CLARIFT_FREE_EVALUATION_DAILY_UNITS, FREE_EVALUATION_DAILY_UNITS),
        monthly: positiveNumber(process.env.CLARIFT_FREE_EVALUATION_MONTHLY_UNITS, FREE_EVALUATION_MONTHLY_UNITS),
      };
}

export async function resolveInferenceAllowancePlan(context: TenantContext): Promise<InferenceAllowancePlan> {
  const [tenantEntitlement, userEntitlement] = await Promise.all([
    getAdminFirestore().doc(`tenantEntitlements/${context.tenantId}`).get(),
    getEffectiveUserEntitlement(context.principalId),
  ]);
  return inferenceAllowancePlan(
    userEntitlement.isPro ? userEntitlement.tier : String(tenantEntitlement.data()?.plan || 'free')
  );
}

function quotaRefId(tenantId: string, kind: 'refinement' | 'evaluation', period: 'daily' | 'monthly', key: string) {
  return id(tenantId, kind, period, key);
}

function allowancePeriod(data: Record<string, unknown> | undefined, limit: number, resetAt: Date) {
  const used = Number(data?.used) || 0;
  const reserved = Number(data?.reserved) || 0;
  return {
    limit,
    used,
    reserved,
    remaining: Math.max(limit - used - reserved, 0),
    resetAt: resetAt.toISOString(),
  };
}

export async function readFreeInferenceAllowance(
  tenantId: string,
  now = new Date(),
  plan: InferenceAllowancePlan = 'free'
): Promise<FreeInferenceAllowance> {
  const periods = quotaPeriodKeys(now);
  const firestore = getAdminFirestore();
  const refs = (['refinement', 'evaluation'] as const).flatMap((kind) => [
    firestore.doc(`freeInferenceQuotas/${quotaRefId(tenantId, kind, 'daily', periods.day)}`),
    firestore.doc(`freeInferenceQuotas/${quotaRefId(tenantId, kind, 'monthly', periods.month)}`),
  ]);
  const snapshots = await firestore.getAll(...refs);
  const refinementLimits = quotaLimits('refinement', plan);
  const evaluationLimits = quotaLimits('evaluation', plan);
  return {
    refinement: {
      daily: allowancePeriod(snapshots[0].data(), refinementLimits.daily, periods.dayResetAt),
      monthly: allowancePeriod(snapshots[1].data(), refinementLimits.monthly, periods.monthResetAt),
    },
    evaluation: {
      daily: allowancePeriod(snapshots[2].data(), evaluationLimits.daily, periods.dayResetAt),
      monthly: allowancePeriod(snapshots[3].data(), evaluationLimits.monthly, periods.monthResetAt),
    },
  };
}

export interface FreeQuotaReservation {
  id: string;
  task: FreeInferenceTask;
  units: number;
  status: 'reserved' | 'unavailable';
  dailyLimitReached: boolean;
  monthlyLimitReached: boolean;
}

export async function reclaimExpiredFreeReservations(tenantId: string, now = Date.now()) {
  const firestore = getAdminFirestore();
  const candidates = await firestore.collection('freeInferenceReservations').where('tenantId', '==', tenantId).limit(25).get();
  for (const candidate of candidates.docs) {
    const data = candidate.data();
    if (data.status !== 'reserved' || (data.expiresAt?.toMillis?.() ?? Number.POSITIVE_INFINITY) > now) continue;
    await firestore.runTransaction(async (transaction) => {
      const reservation = await transaction.get(candidate.ref);
      const current = reservation.data();
      if (current?.status !== 'reserved' || (current.expiresAt?.toMillis?.() ?? Number.POSITIVE_INFINITY) > now) return;
      const quotaRefs = [
        firestore.doc(`freeInferenceQuotas/${String(current.dailyQuotaId)}`),
        firestore.doc(`freeInferenceQuotas/${String(current.monthlyQuotaId)}`),
      ];
      const quotas = await Promise.all(quotaRefs.map((ref) => transaction.get(ref)));
      const units = Number(current.units) || 0;
      for (const quota of quotas) {
        transaction.set(quota.ref, {
          reserved: Math.max((Number(quota.data()?.reserved) || 0) - units, 0),
          updatedAt: Timestamp.fromMillis(now),
        }, { merge: true });
      }
      transaction.set(candidate.ref, { status: 'expired', updatedAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + 24 * 60 * 60 * 1000) }, { merge: true });
    });
  }
}

export async function reserveFreeQuota(input: {
  context: TenantContext;
  task: FreeInferenceTask;
  requestId: string;
  now?: Date;
  allowancePlan?: InferenceAllowancePlan;
}): Promise<FreeQuotaReservation> {
  const now = input.now ?? new Date();
  const periods = quotaPeriodKeys(now);
  const kind = taskAllowanceKind(input.task);
  const allowancePlan = input.allowancePlan ?? await resolveInferenceAllowancePlan(input.context);
  const limits = quotaLimits(kind, allowancePlan);
  const units = FREE_TASK_UNITS[input.task];
  const firestore = getAdminFirestore();
  const reservationRef = firestore.doc(`freeInferenceReservations/${input.requestId}`);
  const dailyRef = firestore.doc(`freeInferenceQuotas/${quotaRefId(input.context.tenantId, kind, 'daily', periods.day)}`);
  const monthlyRef = firestore.doc(`freeInferenceQuotas/${quotaRefId(input.context.tenantId, kind, 'monthly', periods.month)}`);

  await reclaimExpiredFreeReservations(input.context.tenantId, now.getTime());

  return firestore.runTransaction(async (transaction) => {
    const [existing, daily, monthly] = await Promise.all([
      transaction.get(reservationRef),
      transaction.get(dailyRef),
      transaction.get(monthlyRef),
    ]);
    if (existing.exists) {
      const data = existing.data();
      return {
        id: input.requestId,
        task: input.task,
        units,
        status: data?.status === 'reserved' ? 'reserved' : 'unavailable',
        dailyLimitReached: data?.dailyLimitReached === true,
        monthlyLimitReached: data?.monthlyLimitReached === true,
      };
    }
    const dailyUsed = Number(daily.data()?.used) || 0;
    const dailyReserved = Number(daily.data()?.reserved) || 0;
    const monthlyUsed = Number(monthly.data()?.used) || 0;
    const monthlyReserved = Number(monthly.data()?.reserved) || 0;
    const dailyLimitReached = dailyUsed + dailyReserved + units > limits.daily;
    const monthlyLimitReached = monthlyUsed + monthlyReserved + units > limits.monthly;
    const unavailable = dailyLimitReached || monthlyLimitReached;
    const common = {
      tenantId: input.context.tenantId,
      workspaceId: input.context.workspaceId,
      principalId: input.context.principalId,
      task: input.task,
      kind,
      units,
      updatedAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromMillis(now.getTime() + 10 * 60 * 1000),
    };
    transaction.create(reservationRef, {
      ...common,
      status: unavailable ? 'unavailable' : 'reserved',
      dailyLimitReached,
      monthlyLimitReached,
      dailyQuotaId: dailyRef.id,
      monthlyQuotaId: monthlyRef.id,
      createdAt: Timestamp.fromDate(now),
    });
    if (!unavailable) {
      transaction.set(dailyRef, {
        tenantId: input.context.tenantId,
        kind,
        period: 'daily',
        periodKey: periods.day,
        limit: limits.daily,
        used: dailyUsed,
        reserved: dailyReserved + units,
        resetAt: Timestamp.fromDate(periods.dayResetAt),
        expiresAt: Timestamp.fromMillis(periods.dayResetAt.getTime() + 45 * 24 * 60 * 60 * 1000),
        updatedAt: Timestamp.fromDate(now),
      }, { merge: true });
      transaction.set(monthlyRef, {
        tenantId: input.context.tenantId,
        kind,
        period: 'monthly',
        periodKey: periods.month,
        limit: limits.monthly,
        used: monthlyUsed,
        reserved: monthlyReserved + units,
        resetAt: Timestamp.fromDate(periods.monthResetAt),
        expiresAt: Timestamp.fromMillis(periods.monthResetAt.getTime() + 400 * 24 * 60 * 60 * 1000),
        updatedAt: Timestamp.fromDate(now),
      }, { merge: true });
    }
    return { id: input.requestId, task: input.task, units, status: unavailable ? 'unavailable' : 'reserved', dailyLimitReached, monthlyLimitReached };
  });
}

async function finishFreeQuota(reservationId: string, action: 'settled' | 'released') {
  const firestore = getAdminFirestore();
  const reservationRef = firestore.doc(`freeInferenceReservations/${reservationId}`);
  await firestore.runTransaction(async (transaction) => {
    const reservation = await transaction.get(reservationRef);
    const data = reservation.data();
    if (!reservation.exists || data?.status !== 'reserved') return;
    const dailyRef = firestore.doc(`freeInferenceQuotas/${String(data.dailyQuotaId)}`);
    const monthlyRef = firestore.doc(`freeInferenceQuotas/${String(data.monthlyQuotaId)}`);
    const [daily, monthly] = await Promise.all([transaction.get(dailyRef), transaction.get(monthlyRef)]);
    const units = Number(data.units) || 0;
    for (const snapshot of [daily, monthly]) {
      transaction.set(snapshot.ref, {
        reserved: Math.max((Number(snapshot.data()?.reserved) || 0) - units, 0),
        ...(action === 'settled' ? { used: (Number(snapshot.data()?.used) || 0) + units } : {}),
        updatedAt: Timestamp.now(),
      }, { merge: true });
    }
    transaction.set(reservationRef, {
      status: action,
      updatedAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
    }, { merge: true });
  });
}

export function settleFreeQuota(reservationId: string) {
  return finishFreeQuota(reservationId, 'settled');
}

export function releaseFreeQuota(reservationId: string) {
  return finishFreeQuota(reservationId, 'released');
}

function providerBudgetLimit(provider: OpenModelProvider) {
  return provider === 'openrouter'
    ? positiveNumber(process.env.CLARIFT_OPENROUTER_DAILY_BUDGET_USD, 4)
    : positiveNumber(process.env.CLARIFT_TOGETHER_DAILY_BUDGET_USD, 0.5);
}

export interface ProviderBudgetReservation {
  id: string;
  provider: OpenModelProvider;
  amountUsd: number;
}

export async function reclaimExpiredProviderBudgetReservations(provider: OpenModelProvider, now = Date.now()) {
  const firestore = getAdminFirestore();
  const candidates = await firestore.collection('providerBudgetReservations').where('provider', '==', provider).limit(50).get();
  for (const candidate of candidates.docs) {
    const data = candidate.data();
    if (data.status !== 'reserved' || (data.expiresAt?.toMillis?.() ?? Number.POSITIVE_INFINITY) > now) continue;
    await finishProviderBudget({
      id: candidate.id,
      provider,
      amountUsd: Number(data.estimatedCostUsd) || 0,
    }, null);
  }
}

export async function reserveProviderBudget(input: {
  requestId: string;
  attempt: number;
  provider: OpenModelProvider;
  estimatedCostUsd: number;
  now?: Date;
}): Promise<ProviderBudgetReservation | null> {
  const now = input.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const firestore = getAdminFirestore();
  const reservationId = id(input.requestId, input.provider, String(input.attempt));
  const reservationRef = firestore.doc(`providerBudgetReservations/${reservationId}`);
  const providerRef = firestore.doc(`providerBudgets/${input.provider}_${day}`);
  const overallRef = firestore.doc(`providerBudgets/all_${day}`);
  await reclaimExpiredProviderBudgetReservations(input.provider, now.getTime());
  return firestore.runTransaction(async (transaction) => {
    const [existing, providerBudget, overallBudget] = await Promise.all([
      transaction.get(reservationRef),
      transaction.get(providerRef),
      transaction.get(overallRef),
    ]);
    if (existing.exists && existing.data()?.status === 'reserved') {
      return { id: reservationId, provider: input.provider, amountUsd: Number(existing.data()?.estimatedCostUsd) || input.estimatedCostUsd };
    }
    const providerTotal = (Number(providerBudget.data()?.settledUsd) || 0) + (Number(providerBudget.data()?.reservedUsd) || 0);
    const overallTotal = (Number(overallBudget.data()?.settledUsd) || 0) + (Number(overallBudget.data()?.reservedUsd) || 0);
    if (providerTotal + input.estimatedCostUsd > providerBudgetLimit(input.provider) ||
      overallTotal + input.estimatedCostUsd > positiveNumber(process.env.CLARIFT_REMOTE_ADMISSION_BUDGET_USD, 4.5)) return null;
    const expiresAt = Timestamp.fromMillis(now.getTime() + 5 * 60 * 1000);
    const budgetExpiry = Timestamp.fromMillis(nextUtcDay(now).getTime() + 90 * 24 * 60 * 60 * 1000);
    transaction.create(reservationRef, {
      requestId: input.requestId,
      provider: input.provider,
      attempt: input.attempt,
      estimatedCostUsd: input.estimatedCostUsd,
      status: 'reserved',
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
      expiresAt,
    });
    transaction.set(providerRef, {
      provider: input.provider,
      day,
      limitUsd: providerBudgetLimit(input.provider),
      settledUsd: Number(providerBudget.data()?.settledUsd) || 0,
      reservedUsd: (Number(providerBudget.data()?.reservedUsd) || 0) + input.estimatedCostUsd,
      expiresAt: budgetExpiry,
      updatedAt: Timestamp.fromDate(now),
    }, { merge: true });
    transaction.set(overallRef, {
      provider: 'all',
      day,
      limitUsd: positiveNumber(process.env.CLARIFT_REMOTE_ADMISSION_BUDGET_USD, 4.5),
      settledUsd: Number(overallBudget.data()?.settledUsd) || 0,
      reservedUsd: (Number(overallBudget.data()?.reservedUsd) || 0) + input.estimatedCostUsd,
      expiresAt: budgetExpiry,
      updatedAt: Timestamp.fromDate(now),
    }, { merge: true });
    return { id: reservationId, provider: input.provider, amountUsd: input.estimatedCostUsd };
  });
}

async function finishProviderBudget(reservation: ProviderBudgetReservation, actualCostUsd: number | null) {
  const firestore = getAdminFirestore();
  const reservationRef = firestore.doc(`providerBudgetReservations/${reservation.id}`);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reservationRef);
    const data = snapshot.data();
    if (!snapshot.exists || data?.status !== 'reserved') return;
    const day = data.createdAt?.toDate?.()?.toISOString().slice(0, 10) || new Date().toISOString().slice(0, 10);
    const amount = actualCostUsd === null ? 0 : Math.max(actualCostUsd, 0);
    const budgetRefs = [
      firestore.doc(`providerBudgets/${reservation.provider}_${day}`),
      firestore.doc(`providerBudgets/all_${day}`),
    ];
    const budgets = await Promise.all(budgetRefs.map((budgetRef) => transaction.get(budgetRef)));
    for (const budget of budgets) {
      const budgetRef = budget.ref;
      transaction.set(budgetRef, {
        reservedUsd: Math.max((Number(budget.data()?.reservedUsd) || 0) - reservation.amountUsd, 0),
        settledUsd: (Number(budget.data()?.settledUsd) || 0) + amount,
        updatedAt: Timestamp.now(),
      }, { merge: true });
    }
    transaction.set(reservationRef, {
      status: actualCostUsd === null ? 'released' : 'settled',
      actualCostUsd: amount,
      updatedAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
    }, { merge: true });
  });
}

export function settleProviderBudget(reservation: ProviderBudgetReservation, actualCostUsd: number) {
  return finishProviderBudget(reservation, actualCostUsd);
}

export function releaseProviderBudget(reservation: ProviderBudgetReservation) {
  return finishProviderBudget(reservation, null);
}

export async function acquireFreeInferenceAdmission(context: TenantContext) {
  const slots: Array<{ bucket: string; key: string }> = [];
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < 2_000) {
    try {
      for (const input of [
        { bucket: 'free-global', key: 'managed', limit: positiveNumber(process.env.CLARIFT_FREE_GLOBAL_CONCURRENCY, 20) },
        { bucket: 'free-tenant', key: context.tenantId, limit: 1 },
        { bucket: 'free-principal', key: context.principalId, limit: 1 },
      ]) {
        slots.push(await acquireConcurrencySlot({ ...input, leaseMs: 45_000 }));
      }
      return slots;
    } catch (error) {
      lastError = error;
      await Promise.all(slots.splice(0).map((slot) => releaseConcurrencySlot(slot).catch(() => undefined)));
      await new Promise((resolve) => setTimeout(resolve, 150 + Math.floor(Math.random() * 200)));
    }
  }
  const error = lastError instanceof Error ? lastError : new Error('Managed inference is busy.');
  error.name = 'ConcurrencyLimitError';
  throw error;
}

export async function releaseFreeInferenceAdmission(slots: Array<{ bucket: string; key: string }>) {
  await Promise.all(slots.map((slot) => releaseConcurrencySlot(slot).catch(() => undefined)));
}

export function quotaFallbackStatus(reservation: FreeQuotaReservation, now = new Date()) {
  return chooseBasicModeStatus({
    dailyLimit: reservation.dailyLimitReached,
    monthlyLimit: reservation.monthlyLimitReached,
    dayResetAt: quotaPeriodKeys(now).dayResetAt,
    monthResetAt: quotaPeriodKeys(now).monthResetAt,
  });
}
