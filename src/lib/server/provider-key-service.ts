import { Timestamp } from 'firebase-admin/firestore';

import { createOpenRouterChatCompletion } from '@/ai/flows/openrouter-client';
import { getAdminFirestore } from './firebase-admin';
import { decryptSecret, encryptSecret, type EncryptedSecret } from './encryption-service';
import { resolveTenantFromToken, type TenantContext } from './tenant-service';

export type ProviderName = 'gemini' | 'openrouter';
export type InferenceMode = 'managed' | 'byok';

function assertByokEnabled() {
  if (process.env.ENABLE_BYOK !== 'true') {
    const error = new Error('Encrypted BYOK is not enabled in this environment.');
    error.name = 'ByokDisabledError';
    throw error;
  }
}

function keyId(tenantId: string, provider: ProviderName) {
  return `${tenantId}_${provider}`;
}

function associatedData(tenantId: string, provider: ProviderName) {
  return `clarift:provider-key:${tenantId}:${provider}:v1`;
}

export function providerKeyHint(value: string) {
  return value.length <= 4 ? '****' : `****${value.slice(-4)}`;
}

async function validateGeminiKey(apiKey: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Gemini rejected this provider key.');
  } finally {
    clearTimeout(timeout);
  }
}

async function validateOpenRouterKey(apiKey: string) {
  await createOpenRouterChatCompletion({
    apiKey,
    model: process.env.CLARIFT_OPENROUTER_VALIDATION_MODEL || 'google/gemini-3.5-flash-lite',
    messages: [{ role: 'user', content: 'Reply with OK.' }],
    temperature: 0,
    jsonMode: false,
  });
}

export async function validateProviderKey(provider: ProviderName, apiKey: string) {
  if (provider === 'gemini') await validateGeminiKey(apiKey);
  else await validateOpenRouterKey(apiKey);
}

export async function saveProviderKey(firebaseIdToken: string, provider: ProviderName, apiKey: string) {
  assertByokEnabled();
  const context = await resolveTenantFromToken(firebaseIdToken);
  await validateProviderKey(provider, apiKey);
  const encrypted = encryptSecret(apiKey, associatedData(context.tenantId, provider));
  const now = Timestamp.now();
  await getAdminFirestore().doc(`tenantProviderKeys/${keyId(context.tenantId, provider)}`).set({
    tenantId: context.tenantId,
    scope: 'tenant',
    ownerId: context.principalId,
    provider,
    ...encrypted,
    keyHint: providerKeyHint(apiKey),
    status: 'active',
    createdAt: now,
    updatedAt: now,
    lastValidatedAt: now,
  }, { merge: true });
  return { provider, configured: true, keyHint: providerKeyHint(apiKey), lastValidatedAt: now.toDate().toISOString() };
}

export async function listProviderKeyStatuses(firebaseIdToken: string) {
  assertByokEnabled();
  const context = await resolveTenantFromToken(firebaseIdToken);
  const snapshot = await getAdminFirestore().collection('tenantProviderKeys')
    .where('tenantId', '==', context.tenantId)
    .where('status', '==', 'active')
    .limit(5)
    .get();
  return snapshot.docs.map((document) => {
    const data = document.data();
    return {
      provider: data.provider as ProviderName,
      configured: true,
      keyHint: String(data.keyHint || '****'),
      lastValidatedAt: data.lastValidatedAt?.toDate?.().toISOString?.() ?? null,
    };
  });
}

export async function revokeProviderKey(firebaseIdToken: string, provider: ProviderName) {
  assertByokEnabled();
  const context = await resolveTenantFromToken(firebaseIdToken);
  await getAdminFirestore().doc(`tenantProviderKeys/${keyId(context.tenantId, provider)}`).set({
    status: 'revoked',
    ciphertext: null,
    nonce: null,
    authTag: null,
    revokedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  }, { merge: true });
  return { provider, configured: false };
}

async function readByokKey(context: TenantContext, provider: ProviderName) {
  const snapshot = await getAdminFirestore().doc(`tenantProviderKeys/${keyId(context.tenantId, provider)}`).get();
  const data = snapshot.data();
  if (!snapshot.exists || data?.status !== 'active' || !data.ciphertext || !data.nonce || !data.authTag) {
    const error = new Error(`No validated ${provider === 'gemini' ? 'Gemini' : 'OpenRouter'} key is configured in Advanced settings.`);
    error.name = 'ProviderKeyMissingError';
    throw error;
  }
  return decryptSecret({
    ciphertext: String(data.ciphertext),
    nonce: String(data.nonce),
    authTag: String(data.authTag),
    encryptionVersion: 1,
  } satisfies EncryptedSecret, associatedData(context.tenantId, provider));
}

export async function resolveProviderCredential(input: {
  context: TenantContext;
  mode: InferenceMode;
  preferredProvider?: ProviderName;
}) {
  const provider = input.preferredProvider || (process.env.CLARIFT_MANAGED_PRIMARY_PROVIDER === 'openrouter' ? 'openrouter' : 'gemini');
  if (input.mode === 'byok') {
    assertByokEnabled();
    return { provider, apiKey: await readByokKey(input.context, provider), mode: input.mode } as const;
  }
  if (process.env.ENABLE_MANAGED_INFERENCE !== 'true') {
    const error = new Error('Clarift managed inference is temporarily unavailable.');
    error.name = 'ManagedProviderUnavailableError';
    throw error;
  }
  if (provider === 'openrouter' && process.env.ENABLE_MANAGED_OPENROUTER !== 'true') {
    const error = new Error('Managed OpenRouter inference is not enabled.');
    error.name = 'ManagedProviderUnavailableError';
    throw error;
  }
  const apiKey = provider === 'openrouter'
    ? process.env.CLARIFT_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY
    : process.env.CLARIFT_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey?.trim()) {
    const error = new Error('Clarift managed inference is temporarily unavailable.');
    error.name = 'ManagedProviderUnavailableError';
    throw error;
  }
  return { provider, apiKey: apiKey.trim(), mode: input.mode } as const;
}
