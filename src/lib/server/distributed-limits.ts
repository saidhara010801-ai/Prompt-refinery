import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';

import { getAdminFirestore } from './firebase-admin';

function limitId(bucket: string, key: string) {
  return createHash('sha256').update(`${bucket}:${key}`).digest('hex');
}

export async function consumeDistributedLimit(input: {
  bucket: string;
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}) {
  const firestore = getAdminFirestore();
  const now = input.now ?? Date.now();
  const ref = firestore.doc(`requestRateLimits/${limitId(input.bucket, input.key)}`);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    const resetAtMs = data?.resetAt?.toMillis?.() ?? 0;
    const count = resetAtMs > now ? (Number(data?.count) || 0) + 1 : 1;
    const nextReset = resetAtMs > now ? resetAtMs : now + input.windowMs;
    transaction.set(ref, {
      bucket: input.bucket,
      keyHash: limitId(input.bucket, input.key),
      count,
      resetAt: Timestamp.fromMillis(nextReset),
      updatedAt: Timestamp.fromMillis(now),
    }, { merge: true });
    return {
      allowed: count <= input.limit,
      remaining: Math.max(input.limit - count, 0),
      retryAfterSeconds: Math.max(Math.ceil((nextReset - now) / 1000), 1),
    };
  });
}

export async function acquireConcurrencySlot(input: {
  bucket: string;
  key: string;
  limit: number;
  leaseMs?: number;
}) {
  const firestore = getAdminFirestore();
  const ref = firestore.doc(`requestConcurrency/${limitId(input.bucket, input.key)}`);
  const now = Date.now();
  const leaseMs = input.leaseMs ?? 2 * 60 * 1000;
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const expiresAt = snapshot.data()?.expiresAt?.toMillis?.() ?? 0;
    const active = expiresAt > now ? Number(snapshot.data()?.active) || 0 : 0;
    if (active >= input.limit) {
      const error = new Error('Too many managed tasks are already running. Try again shortly.');
      error.name = 'ConcurrencyLimitError';
      throw error;
    }
    transaction.set(ref, {
      bucket: input.bucket,
      keyHash: limitId(input.bucket, input.key),
      active: active + 1,
      expiresAt: Timestamp.fromMillis(now + leaseMs),
      updatedAt: Timestamp.fromMillis(now),
    }, { merge: true });
  });
  return { bucket: input.bucket, key: input.key };
}

export async function releaseConcurrencySlot(input: { bucket: string; key: string }) {
  const firestore = getAdminFirestore();
  const ref = firestore.doc(`requestConcurrency/${limitId(input.bucket, input.key)}`);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    transaction.set(ref, {
      active: Math.max((Number(snapshot.data()?.active) || 1) - 1, 0),
      updatedAt: Timestamp.now(),
    }, { merge: true });
  });
}
