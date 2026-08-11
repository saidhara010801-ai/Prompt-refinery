import { createHash, createHmac, randomBytes } from 'node:crypto';

import { Timestamp, type WriteBatch } from 'firebase-admin/firestore';
import type { NextRequest } from 'next/server';

import { getAdminAuth, getAdminFirestore } from './firebase-admin';
import {
  AuthorizationError,
  getCurrentUserFromRequest,
  requireOwner,
} from './user-access';
import { writeAdminAuditLog } from './admin-service';

const REDEMPTION_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export type PromoCodeMode = 'single' | 'limited' | 'unlimited';

function promoPepper(): string {
  const value = process.env.PROMO_CODE_PEPPER?.trim();
  if (!value) throw new Error('Promo code security is not configured.');
  return value;
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

function hashPromoCode(code: string): string {
  return createHmac('sha256', promoPepper()).update(normalizeCode(code)).digest('hex');
}

function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

async function consumePromoAttempt(request: Request, uid: string) {
  const key = createHash('sha256').update(`${uid}:${clientIp(request)}`).digest('hex');
  const ref = getAdminFirestore().doc(`promoRateLimits/${key}`);
  const now = Date.now();
  await getAdminFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data() ?? {};
    const windowStartedAt = data.windowStartedAt instanceof Timestamp ? data.windowStartedAt.toMillis() : 0;
    const inWindow = now - windowStartedAt < ATTEMPT_WINDOW_MS;
    const attempts = inWindow ? Number(data.attempts ?? 0) : 0;
    if (attempts >= MAX_ATTEMPTS) {
      throw new AuthorizationError('Too many promo-code attempts. Wait 15 minutes and retry.', 429, 'PromoRateLimitError');
    }
    transaction.set(ref, {
      attempts: attempts + 1,
      windowStartedAt: Timestamp.fromMillis(inWindow ? windowStartedAt : now),
      expiresAt: Timestamp.fromMillis(now + ATTEMPT_WINDOW_MS),
    });
  });
}

export async function redeemPromoCode(request: NextRequest, code: string) {
  if (process.env.ENABLE_PROMO_CODES !== 'true') {
    throw new AuthorizationError('Promo redemption is not currently available.', 503, 'PromoDisabledError');
  }
  const actor = await getCurrentUserFromRequest(request);
  await consumePromoAttempt(request, actor.uid);
  const authUser = await getAdminAuth().getUser(actor.uid);
  const createdAt = new Date(authUser.metadata.creationTime).getTime();
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > REDEMPTION_WINDOW_MS) {
    throw new AuthorizationError('Promo codes can only be redeemed during new-account signup.', 403, 'PromoEligibilityError');
  }

  const codeHash = hashPromoCode(code);
  const firestore = getAdminFirestore();
  const codeQuery = await firestore.collection('promoCodes').where('codeHash', '==', codeHash).limit(1).get();
  const codeDocument = codeQuery.docs[0];
  if (!codeDocument) throw new AuthorizationError('This promo code is invalid.', 400, 'PromoInvalidError');

  const codeRef = codeDocument.ref;
  const redemptionRef = firestore.doc(`promoRedemptions/${codeDocument.id}-${actor.uid}`);
  const entitlementRef = firestore.doc(`adminEntitlements/${actor.uid}`);
  const userRef = firestore.doc(`users/${actor.uid}`);
  const now = Timestamp.now();

  await firestore.runTransaction(async (transaction) => {
    const [codeSnapshot, redemptionSnapshot, userSnapshot] = await Promise.all([
      transaction.get(codeRef),
      transaction.get(redemptionRef),
      transaction.get(userRef),
    ]);
    const promo = codeSnapshot.data() ?? {};
    if (redemptionSnapshot.exists && !redemptionSnapshot.data()?.revokedAt) return;
    if (!promo.active) throw new AuthorizationError('This promo code is no longer active.', 400, 'PromoInactiveError');
    const redemptionCount = Number(promo.redemptionCount ?? 0);
    const maxRedemptions = promo.maxRedemptions === null ? null : Number(promo.maxRedemptions ?? 0);
    if (maxRedemptions !== null && redemptionCount >= maxRedemptions) {
      throw new AuthorizationError('This promo code has reached its redemption limit.', 400, 'PromoExhaustedError');
    }
    const userData = userSnapshot.data() ?? {};
    const stripeActive = userData.subscriptionSource === 'stripe' && ['active', 'trialing'].includes(String(userData.subscriptionStatus));
    transaction.update(codeRef, { redemptionCount: redemptionCount + 1, updatedAt: now });
    transaction.set(redemptionRef, {
      codeId: codeDocument.id,
      uid: actor.uid,
      email: actor.email,
      status: 'active',
      redeemedAt: now,
      revokedAt: null,
      revokedByUid: null,
    });
    transaction.set(entitlementRef, {
      tier: 'pro',
      source: 'promo',
      reason: `Promo code ${String(promo.prefix ?? '')}`,
      codeId: codeDocument.id,
      grantedByUid: null,
      expiresAt: null,
      createdAt: now,
      revokedAt: null,
      revokedByUid: null,
      updatedAt: now,
    }, { merge: true });
    transaction.set(userRef, {
      id: actor.uid,
      email: actor.email,
      name: actor.profile.name,
      role: actor.role,
      accountStatus: 'active',
      subscriptionTier: 'pro',
      subscriptionSource: stripeActive ? 'stripe' : 'promo',
      createdAt: userData.createdAt ?? now,
      updatedAt: now,
    }, { merge: true });
  });

  await writeAdminAuditLog({ actor, action: 'promo.redeemed', targetUid: actor.uid, metadata: { codeId: codeDocument.id }, request });
  return { tier: 'pro', source: 'promo', label: 'Pro — Promo' };
}

export async function createPromoCode(request: NextRequest, input: {
  mode: PromoCodeMode;
  maxRedemptions?: number | null;
  label?: string;
}) {
  const actor = await requireOwner(request);
  const secret = randomBytes(15).toString('hex').toUpperCase();
  const plaintext = `CLARIFT-${secret.match(/.{1,6}/g)?.join('-')}`;
  const ref = getAdminFirestore().collection('promoCodes').doc();
  const maxRedemptions = input.mode === 'single' ? 1 : input.mode === 'unlimited' ? null : Math.max(2, Math.min(input.maxRedemptions ?? 2, 10000));
  const now = Timestamp.now();
  await ref.create({
    codeHash: hashPromoCode(plaintext),
    prefix: plaintext.slice(0, 20),
    label: input.label?.trim().slice(0, 120) || null,
    mode: input.mode,
    maxRedemptions,
    redemptionCount: 0,
    active: true,
    createdByUid: actor.uid,
    createdAt: now,
    updatedAt: now,
    invalidatedAt: null,
    invalidatedByUid: null,
  });
  await writeAdminAuditLog({ actor, action: 'admin.promo_created', metadata: { codeId: ref.id, mode: input.mode, maxRedemptions }, request });
  return { id: ref.id, code: plaintext, mode: input.mode, maxRedemptions };
}

export async function listPromoCodes(request: NextRequest) {
  const actor = await requireOwner(request);
  const snapshot = await getAdminFirestore().collection('promoCodes').orderBy('createdAt', 'desc').limit(100).get();
  await writeAdminAuditLog({ actor, action: 'admin.promo_list', metadata: { resultCount: snapshot.size }, request });
  return snapshot.docs.map((document) => {
    const data = document.data();
    return {
      id: document.id,
      prefix: data.prefix,
      label: data.label ?? null,
      mode: data.mode,
      maxRedemptions: data.maxRedemptions ?? null,
      redemptionCount: data.redemptionCount ?? 0,
      active: Boolean(data.active),
      createdAt: data.createdAt?.toDate?.().toISOString?.() ?? null,
    };
  });
}

async function revokePromoEntitlement(uid: string, codeId: string, actorUid: string, batch: WriteBatch) {
  const firestore = getAdminFirestore();
  const [entitlement, user] = await Promise.all([
    firestore.doc(`adminEntitlements/${uid}`).get(),
    firestore.doc(`users/${uid}`).get(),
  ]);
  const now = Timestamp.now();
  if (entitlement.data()?.source === 'promo' && entitlement.data()?.codeId === codeId) {
    batch.set(entitlement.ref, { revokedAt: now, revokedByUid: actorUid, updatedAt: now }, { merge: true });
  }
  const userData = user.data() ?? {};
  if (userData.subscriptionSource === 'promo') {
    batch.set(user.ref, { subscriptionTier: 'free', subscriptionSource: null, updatedAt: now }, { merge: true });
  }
}

export async function invalidatePromoCode(request: NextRequest, codeId: string) {
  const actor = await requireOwner(request);
  const firestore = getAdminFirestore();
  const codeRef = firestore.doc(`promoCodes/${codeId}`);
  const now = Timestamp.now();
  await codeRef.set({ active: false, invalidatedAt: now, invalidatedByUid: actor.uid, updatedAt: now }, { merge: true });
  let revokedUsers = 0;
  while (true) {
    const redemptions = await firestore.collection('promoRedemptions')
      .where('codeId', '==', codeId)
      .where('status', '==', 'active')
      .limit(100)
      .get();
    if (redemptions.empty) break;
    const batch = firestore.batch();
    for (const redemption of redemptions.docs) {
      batch.set(redemption.ref, { status: 'revoked', revokedAt: now, revokedByUid: actor.uid }, { merge: true });
      await revokePromoEntitlement(String(redemption.data().uid), codeId, actor.uid, batch);
    }
    await batch.commit();
    revokedUsers += redemptions.size;
  }
  await writeAdminAuditLog({ actor, action: 'admin.promo_invalidated', metadata: { codeId, affectedUsers: revokedUsers }, request });
  return { codeId, revokedUsers };
}

export async function listPromoUsers(request: NextRequest) {
  const actor = await requireOwner(request);
  const snapshot = await getAdminFirestore().collection('promoRedemptions').where('status', '==', 'active').limit(250).get();
  await writeAdminAuditLog({ actor, action: 'admin.promo_users_list', metadata: { resultCount: snapshot.size }, request });
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}

export async function revokePromoUser(request: NextRequest, uid: string) {
  const actor = await requireOwner(request);
  const firestore = getAdminFirestore();
  const snapshot = await firestore.collection('promoRedemptions').where('uid', '==', uid).where('status', '==', 'active').limit(1).get();
  const redemption = snapshot.docs[0];
  if (!redemption) return { uid, revoked: false };
  const batch = firestore.batch();
  const now = Timestamp.now();
  batch.set(redemption.ref, { status: 'revoked', revokedAt: now, revokedByUid: actor.uid }, { merge: true });
  await revokePromoEntitlement(uid, String(redemption.data().codeId), actor.uid, batch);
  await batch.commit();
  await writeAdminAuditLog({ actor, action: 'admin.promo_user_revoked', targetUid: uid, metadata: { codeId: redemption.data().codeId }, request });
  return { uid, revoked: true };
}
