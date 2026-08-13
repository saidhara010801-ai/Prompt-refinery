import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';

import type { ProviderName } from './provider-key-service';
import type { OpenModelProvider } from './open-model-client';
import { getAdminFirestore } from './firebase-admin';

type CircuitProvider = ProviderName | OpenModelProvider;

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function circuitId(provider: CircuitProvider, model?: string) {
  if (!model) return provider;
  return `${provider}_${createHash('sha256').update(model).digest('hex').slice(0, 16)}`;
}

export async function acquireProviderCircuit(provider: CircuitProvider, model?: string) {
  const firestore = getAdminFirestore();
  const ref = firestore.doc(`providerCircuits/${circuitId(provider, model)}`);
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
        model: model || null,
        state: 'half_open',
        probeExpiresAt: Timestamp.fromMillis(now + 30_000),
        updatedAt: Timestamp.fromMillis(now),
      }, { merge: true });
    }
  });
}

export async function recordProviderSuccess(provider: CircuitProvider, model?: string) {
  await getAdminFirestore().doc(`providerCircuits/${circuitId(provider, model)}`).set({
    provider,
    model: model || null,
    state: 'closed',
    consecutiveFailures: 0,
    cooldownLevel: 0,
    retryAt: null,
    probeExpiresAt: null,
    lastSuccessAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  }, { merge: true });
}

export async function recordProviderFailure(
  provider: CircuitProvider,
  errorCode: string,
  options: { model?: string; requestId?: string; status?: number } = {}
) {
  const firestore = getAdminFirestore();
  const ref = firestore.doc(`providerCircuits/${circuitId(provider, options.model)}`);
  const threshold = positiveInteger(process.env.CLARIFT_PROVIDER_CIRCUIT_FAILURES, 5);
  const cooldownMs = positiveInteger(process.env.CLARIFT_PROVIDER_CIRCUIT_COOLDOWN_MS, 60_000);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const now = Date.now();
    const data = snapshot.data();
    const lastFailureAt = data?.lastFailureAt?.toMillis?.() ?? 0;
    const sameRequest = options.requestId && data?.lastFailureRequestId === options.requestId;
    const priorFailures = now - lastFailureAt <= 2 * 60 * 1000 ? Number(data?.consecutiveFailures) || 0 : 0;
    const failures = sameRequest ? priorFailures : priorFailures + 1;
    const immediate = options.status === 401 || options.status === 402 || options.status === 403 || options.status === 404;
    const open = immediate || failures >= threshold || data?.state === 'half_open';
    const cooldownLevel = open ? Math.min((Number(data?.cooldownLevel) || 0) + 1, 4) : Number(data?.cooldownLevel) || 0;
    const transientCooldown = data?.state === 'half_open'
      ? Math.min(cooldownMs * (2 ** cooldownLevel), 15 * 60 * 1000)
      : cooldownMs;
    const selectedCooldown = immediate ? 15 * 60 * 1000 : transientCooldown;
    transaction.set(ref, {
      provider,
      model: options.model || null,
      state: open ? 'open' : 'closed',
      consecutiveFailures: failures,
      cooldownLevel,
      retryAt: open ? Timestamp.fromMillis(now + selectedCooldown) : null,
      probeExpiresAt: null,
      lastFailureCode: errorCode.slice(0, 120),
      lastFailureRequestId: options.requestId || null,
      lastFailureAt: Timestamp.fromMillis(now),
      updatedAt: Timestamp.fromMillis(now),
    }, { merge: true });
  });
}
