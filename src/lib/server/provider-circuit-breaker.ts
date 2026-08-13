import { Timestamp } from 'firebase-admin/firestore';

import type { ProviderName } from './provider-key-service';
import { getAdminFirestore } from './firebase-admin';

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function acquireProviderCircuit(provider: ProviderName) {
  const firestore = getAdminFirestore();
  const ref = firestore.doc(`providerCircuits/${provider}`);
  const now = Date.now();
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    const retryAt = data?.retryAt?.toMillis?.() ?? 0;
    const probeExpiresAt = data?.probeExpiresAt?.toMillis?.() ?? 0;
    if (data?.state === 'open' && retryAt > now) {
      const error = new Error(`${provider} is temporarily unavailable. Try again shortly.`);
      error.name = 'ProviderCircuitOpenError';
      throw error;
    }
    if (data?.state === 'half_open' && probeExpiresAt > now) {
      const error = new Error(`${provider} is recovering. Try again shortly.`);
      error.name = 'ProviderCircuitOpenError';
      throw error;
    }
    if (data?.state === 'open' || data?.state === 'half_open') {
      transaction.set(ref, {
        provider,
        state: 'half_open',
        probeExpiresAt: Timestamp.fromMillis(now + 2 * 60 * 1000),
        updatedAt: Timestamp.fromMillis(now),
      }, { merge: true });
    }
  });
}

export async function recordProviderSuccess(provider: ProviderName) {
  await getAdminFirestore().doc(`providerCircuits/${provider}`).set({
    provider,
    state: 'closed',
    consecutiveFailures: 0,
    retryAt: null,
    probeExpiresAt: null,
    lastSuccessAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  }, { merge: true });
}

export async function recordProviderFailure(provider: ProviderName, errorCode: string) {
  const firestore = getAdminFirestore();
  const ref = firestore.doc(`providerCircuits/${provider}`);
  const threshold = positiveInteger(process.env.CLARIFT_PROVIDER_CIRCUIT_FAILURES, 5);
  const cooldownMs = positiveInteger(process.env.CLARIFT_PROVIDER_CIRCUIT_COOLDOWN_MS, 60_000);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const failures = (Number(snapshot.data()?.consecutiveFailures) || 0) + 1;
    const open = failures >= threshold || snapshot.data()?.state === 'half_open';
    const now = Date.now();
    transaction.set(ref, {
      provider,
      state: open ? 'open' : 'closed',
      consecutiveFailures: failures,
      retryAt: open ? Timestamp.fromMillis(now + cooldownMs) : null,
      probeExpiresAt: null,
      lastFailureCode: errorCode.slice(0, 120),
      lastFailureAt: Timestamp.fromMillis(now),
      updatedAt: Timestamp.fromMillis(now),
    }, { merge: true });
  });
}
