import { createHmac, randomBytes } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';

import { getAdminFirestore } from './firebase-admin';
import { consumeDistributedLimit } from './distributed-limits';
import { resolveTenantForUid } from './tenant-service';
import {
  AuthorizationError,
  assertActiveAccount,
  getEffectiveUserEntitlement,
  normalizeUserProfile,
  requireUser,
} from './user-access';

export const API_TOKEN_SCOPES = [
  'refinements:write',
  'evaluations:write',
  'conversions:write',
  'projects:read',
  'projects:write',
  'usage:read',
] as const;
export type ApiTokenScope = typeof API_TOKEN_SCOPES[number];

function apiKeyPepper() {
  const value = (process.env.CLARIFT_API_TOKEN_PEPPER || process.env.CLARIFT_API_KEY_PEPPER)?.trim();
  if (!value) throw new Error('Public API token security is not configured.');
  return value;
}

function hashApiKey(value: string) {
  return createHmac('sha256', apiKeyPepper()).update(value).digest('hex');
}

function assertPublicApiEnabled() {
  if (process.env.ENABLE_PUBLIC_API !== 'true') {
    throw new AuthorizationError('The Clarift developer API is not enabled.', 503, 'PublicApiDisabledError');
  }
}

function normalizeScopes(value: unknown): ApiTokenScope[] {
  if (!Array.isArray(value)) return ['refinements:write', 'evaluations:write', 'conversions:write'];
  return Array.from(new Set(value.filter((scope): scope is ApiTokenScope => API_TOKEN_SCOPES.includes(scope as ApiTokenScope))));
}

async function tenantAllowsDeveloperApi(tenantId: string, legacyPro: boolean) {
  const entitlement = await getAdminFirestore().doc(`tenantEntitlements/${tenantId}`).get();
  return legacyPro || (entitlement.data()?.developerApiAllowed === true && ['active', 'authenticated'].includes(String(entitlement.data()?.status || '')));
}

export async function createApiKey(request: Request, input: {
  name: string;
  scopes?: ApiTokenScope[];
  expiresInDays?: number | null;
}) {
  assertPublicApiEnabled();
  const user = await requireUser(request);
  assertActiveAccount(user.profile, 'create API tokens');
  const context = await resolveTenantForUid(user.uid);
  if (!await tenantAllowsDeveloperApi(context.tenantId, user.entitlement.isPro)) {
    throw new AuthorizationError('Developer API access is unavailable for this workspace.', 403, 'ProFeatureRequiredError');
  }
  const firestore = getAdminFirestore();
  const current = await firestore.collection('apiKeys')
    .where('tenantId', '==', context.tenantId)
    .where('active', '==', true)
    .limit(10)
    .get();
  if (current.size >= 10) throw new AuthorizationError('Revoke an existing API token before creating another.', 400, 'ApiKeyLimitError');
  const plaintext = `clf_live_${randomBytes(32).toString('base64url')}`;
  const ref = firestore.collection('apiKeys').doc();
  const now = Timestamp.now();
  const expiresInDays = input.expiresInDays && input.expiresInDays > 0 ? Math.min(input.expiresInDays, 365) : null;
  const scopes = normalizeScopes(input.scopes);
  if (!scopes.length) throw new AuthorizationError('Select at least one API token scope.', 400, 'ApiValidationError');
  await ref.create({
    ownerUid: user.uid,
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    name: input.name.trim().slice(0, 80) || 'API token',
    keyHash: hashApiKey(plaintext),
    prefix: plaintext.slice(0, 18),
    scopes,
    active: true,
    expiresAt: expiresInDays ? Timestamp.fromMillis(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null,
    createdBy: user.uid,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    revokedAt: null,
  });
  return {
    id: ref.id,
    key: plaintext,
    prefix: plaintext.slice(0, 18),
    name: input.name.trim().slice(0, 80) || 'API token',
    scopes,
  };
}

export async function listApiKeys(request: Request) {
  const user = await requireUser(request);
  assertActiveAccount(user.profile, 'list API tokens');
  const context = await resolveTenantForUid(user.uid);
  if (!await tenantAllowsDeveloperApi(context.tenantId, user.entitlement.isPro)) {
    throw new AuthorizationError('Developer API access is available on an active Individual plan.', 403, 'ProFeatureRequiredError');
  }
  const snapshot = await getAdminFirestore().collection('apiKeys')
    .where('tenantId', '==', context.tenantId)
    .limit(50)
    .get();
  return snapshot.docs.map((document) => {
    const data = document.data();
    return {
      id: document.id,
      name: data.name,
      prefix: data.prefix,
      scopes: normalizeScopes(data.scopes),
      active: Boolean(data.active),
      createdAt: data.createdAt?.toDate?.().toISOString?.() ?? null,
      expiresAt: data.expiresAt?.toDate?.().toISOString?.() ?? null,
      lastUsedAt: data.lastUsedAt?.toDate?.().toISOString?.() ?? null,
    };
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function revokeApiKey(request: Request, keyId: string) {
  const user = await requireUser(request);
  const context = await resolveTenantForUid(user.uid);
  const ref = getAdminFirestore().doc(`apiKeys/${keyId}`);
  const snapshot = await ref.get();
  const data = snapshot.data();
  const ownsLegacy = data?.ownerUid === user.uid && !data?.tenantId;
  if (!snapshot.exists || (data?.tenantId !== context.tenantId && !ownsLegacy)) {
    throw new AuthorizationError('API token not found.', 404, 'ApiKeyNotFoundError');
  }
  await ref.set({ active: false, revokedAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true });
  return { revoked: true };
}

export async function authenticatePublicApi(request: Request, requiredScope: ApiTokenScope) {
  assertPublicApiEnabled();
  const authorization = request.headers.get('authorization');
  const plaintext = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!plaintext.startsWith('clf_live_')) throw new AuthorizationError('A valid Clarift API token is required.', 401, 'ApiAuthenticationError');
  const snapshot = await getAdminFirestore().collection('apiKeys').where('keyHash', '==', hashApiKey(plaintext)).limit(1).get();
  const keyDocument = snapshot.docs[0];
  const keyData = keyDocument?.data();
  if (!keyDocument || !keyData?.active) throw new AuthorizationError('This Clarift API token is invalid or revoked.', 401, 'ApiAuthenticationError');
  if (keyData.expiresAt?.toMillis?.() && keyData.expiresAt.toMillis() <= Date.now()) {
    throw new AuthorizationError('This Clarift API token has expired.', 401, 'ApiAuthenticationError');
  }
  const ownerUid = String(keyData.ownerUid);
  const userSnapshot = await getAdminFirestore().doc(`users/${ownerUid}`).get();
  assertActiveAccount(normalizeUserProfile(ownerUid, userSnapshot.data() as Record<string, unknown> | undefined), 'use the Clarift API');
  const entitlement = await getEffectiveUserEntitlement(ownerUid);
  const context = await resolveTenantForUid(ownerUid, keyData.workspaceId || null);
  if (!await tenantAllowsDeveloperApi(context.tenantId, entitlement.isPro)) {
    throw new AuthorizationError('This Clarift API token requires an active Individual plan.', 403, 'ProFeatureRequiredError');
  }
  if (keyData.tenantId && keyData.tenantId !== context.tenantId) throw new AuthorizationError('This token is not valid for the active tenant.', 403, 'TenantIsolationError');
  const scopes = normalizeScopes(keyData.scopes);
  const legacyToken = !keyData.tenantId && !Array.isArray(keyData.scopes);
  if (!legacyToken && !scopes.includes(requiredScope)) throw new AuthorizationError('This API token does not have the required scope.', 403, 'ApiScopeError');
  const rate = await consumeDistributedLimit({
    bucket: 'public-api',
    key: keyDocument.id,
    limit: Math.max(1, Number(process.env.PUBLIC_API_RATE_LIMIT_PER_MINUTE) || 30),
    windowMs: 60_000,
  });
  if (!rate.allowed) throw new AuthorizationError('Clarift API rate limit exceeded. Retry shortly.', 429, 'ApiRateLimitError');
  await keyDocument.ref.set({
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    scopes: legacyToken ? ['refinements:write', 'evaluations:write', 'conversions:write'] : scopes,
    lastUsedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  }, { merge: true });
  return { uid: ownerUid, keyId: keyDocument.id, entitlement, context, scopes };
}
