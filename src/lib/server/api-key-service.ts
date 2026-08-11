import { createHmac, randomBytes } from 'node:crypto';

import { Timestamp } from 'firebase-admin/firestore';

import { getAdminFirestore } from './firebase-admin';
import { consumeRequestLimit } from './request-rate-limit';
import { AuthorizationError, assertActiveAccount, getEffectiveUserEntitlement, normalizeUserProfile, requireUser } from './user-access';

function apiKeyPepper() {
  const value = process.env.CLARIFT_API_KEY_PEPPER?.trim();
  if (!value) throw new Error('Public API key security is not configured.');
  return value;
}

function hashApiKey(value: string) {
  return createHmac('sha256', apiKeyPepper()).update(value).digest('hex');
}

function assertPublicApiEnabled() {
  if (process.env.ENABLE_PUBLIC_API !== 'true') throw new AuthorizationError('The Clarift public API is not enabled.', 503, 'PublicApiDisabledError');
}

export async function createApiKey(request: Request, name: string) {
  assertPublicApiEnabled();
  const context = await requireUser(request);
  assertActiveAccount(context.profile, 'create API keys');
  if (!context.entitlement.isPro) throw new AuthorizationError('Public API access is available on Pro.', 403, 'ProFeatureRequiredError');
  const firestore = getAdminFirestore();
  const current = await firestore.collection('apiKeys').where('ownerUid', '==', context.uid).where('active', '==', true).limit(10).get();
  if (current.size >= 10) throw new AuthorizationError('Revoke an existing API key before creating another.', 400, 'ApiKeyLimitError');
  const plaintext = `clf_live_${randomBytes(24).toString('base64url')}`;
  const ref = firestore.collection('apiKeys').doc();
  const now = Timestamp.now();
  await ref.create({
    ownerUid: context.uid,
    name: name.trim().slice(0, 80) || 'API key',
    keyHash: hashApiKey(plaintext),
    prefix: plaintext.slice(0, 18),
    active: true,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    revokedAt: null,
  });
  return { id: ref.id, key: plaintext, prefix: plaintext.slice(0, 18), name: name.trim().slice(0, 80) || 'API key' };
}

export async function listApiKeys(request: Request) {
  const context = await requireUser(request);
  assertActiveAccount(context.profile, 'list API keys');
  if (!context.entitlement.isPro) throw new AuthorizationError('Public API access is available on Pro.', 403, 'ProFeatureRequiredError');
  const snapshot = await getAdminFirestore().collection('apiKeys').where('ownerUid', '==', context.uid).limit(50).get();
  return snapshot.docs.map((document) => {
    const data = document.data();
    return {
      id: document.id,
      name: data.name,
      prefix: data.prefix,
      active: Boolean(data.active),
      createdAt: data.createdAt?.toDate?.().toISOString?.() ?? null,
      lastUsedAt: data.lastUsedAt?.toDate?.().toISOString?.() ?? null,
    };
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function revokeApiKey(request: Request, keyId: string) {
  const context = await requireUser(request);
  const ref = getAdminFirestore().doc(`apiKeys/${keyId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.ownerUid !== context.uid) throw new AuthorizationError('API key not found.', 404, 'ApiKeyNotFoundError');
  await ref.set({ active: false, revokedAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true });
  return { revoked: true };
}

export async function authenticatePublicApi(request: Request) {
  assertPublicApiEnabled();
  const authorization = request.headers.get('authorization');
  const plaintext = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!plaintext.startsWith('clf_live_')) throw new AuthorizationError('A valid Clarift API key is required.', 401, 'ApiAuthenticationError');
  const snapshot = await getAdminFirestore().collection('apiKeys').where('keyHash', '==', hashApiKey(plaintext)).limit(1).get();
  const keyDocument = snapshot.docs[0];
  if (!keyDocument || !keyDocument.data().active) throw new AuthorizationError('This Clarift API key is invalid or revoked.', 401, 'ApiAuthenticationError');
  const ownerUid = String(keyDocument.data().ownerUid);
  const userSnapshot = await getAdminFirestore().doc(`users/${ownerUid}`).get();
  assertActiveAccount(normalizeUserProfile(ownerUid, userSnapshot.data() as Record<string, unknown> | undefined), 'use the Clarift API');
  const entitlement = await getEffectiveUserEntitlement(ownerUid);
  if (!entitlement.isPro) throw new AuthorizationError('This Clarift API key requires an active Pro plan.', 403, 'ProFeatureRequiredError');
  const rate = consumeRequestLimit({
    bucket: 'public-api',
    key: keyDocument.id,
    limit: Math.max(1, Number(process.env.PUBLIC_API_RATE_LIMIT_PER_MINUTE) || 30),
    windowMs: 60 * 1000,
  });
  if (!rate.allowed) throw new AuthorizationError('Clarift API rate limit exceeded. Retry shortly.', 429, 'ApiRateLimitError');
  await keyDocument.ref.set({ lastUsedAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true });
  return { uid: ownerUid, keyId: keyDocument.id, entitlement };
}

export function getCallerProvider(request: Request) {
  const provider = request.headers.get('x-ai-provider') === 'openrouter' ? 'openrouter' : 'gemini';
  const providerApiKey = request.headers.get('x-provider-api-key')?.trim() ?? '';
  if (!providerApiKey) throw new AuthorizationError('X-Provider-API-Key is required.', 400, 'ProviderApiKeyRequiredError');
  return { provider, providerApiKey } as const;
}
