import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';

import { getAdminFirestore } from './firebase-admin';
import { resolveTenantForUid, resolveTenantFromToken } from './tenant-service';

function assertExtensionEnabled() {
  if (process.env.ENABLE_EXTENSION_ACCOUNT_LINKING !== 'true') {
    const error = new Error('Extension account linking is not enabled.');
    error.name = 'ExtensionDisabledError';
    throw error;
  }
}

const LINK_TTL_MS = 10 * 60 * 1000;
const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function accessToken() {
  return `clf_ext_${randomBytes(32).toString('base64url')}`;
}

function refreshToken() {
  return `clf_refresh_${randomBytes(40).toString('base64url')}`;
}

export async function startExtensionLink(origin: string) {
  assertExtensionEnabled();
  const deviceCode = `clf_link_${randomBytes(32).toString('base64url')}`;
  const userCode = randomBytes(4).toString('hex').toUpperCase();
  const expiresAt = Timestamp.fromMillis(Date.now() + LINK_TTL_MS);
  await getAdminFirestore().doc(`extensionLinkCodes/${hash(deviceCode)}`).create({
    codeHash: hash(deviceCode),
    userCode,
    status: 'pending',
    createdAt: Timestamp.now(),
    expiresAt,
  });
  return {
    deviceCode,
    userCode,
    verificationUrl: `${origin}/extension/link?code=${encodeURIComponent(deviceCode)}`,
    expiresIn: Math.floor(LINK_TTL_MS / 1000),
    interval: 2,
  };
}

export async function approveExtensionLink(firebaseIdToken: string, deviceCode: string) {
  assertExtensionEnabled();
  const context = await resolveTenantFromToken(firebaseIdToken);
  const ref = getAdminFirestore().doc(`extensionLinkCodes/${hash(deviceCode)}`);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.status !== 'pending' || snapshot.data()?.expiresAt?.toMillis?.() <= Date.now()) {
    const error = new Error('This extension link has expired. Start again from the extension.');
    error.name = 'ExtensionLinkExpiredError';
    throw error;
  }
  await ref.set({
    status: 'approved',
    approvedUid: context.principalId,
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    approvedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  }, { merge: true });
  return { approved: true, userCode: snapshot.data()?.userCode };
}

export async function exchangeExtensionLink(deviceCode: string) {
  assertExtensionEnabled();
  const firestore = getAdminFirestore();
  const linkRef = firestore.doc(`extensionLinkCodes/${hash(deviceCode)}`);
  const newAccessToken = accessToken();
  const newRefreshToken = refreshToken();
  const deviceId = randomUUID();
  const deviceRef = firestore.doc(`extensionDevices/${deviceId}`);
  const result = await firestore.runTransaction(async (transaction) => {
    const link = await transaction.get(linkRef);
    const data = link.data();
    if (!link.exists || data?.expiresAt?.toMillis?.() <= Date.now()) return { status: 'expired' as const };
    if (data?.status === 'pending') return { status: 'pending' as const };
    if (data?.status !== 'approved' || !data.approvedUid) return { status: 'used' as const };
    const now = Timestamp.now();
    transaction.create(deviceRef, {
      uid: data.approvedUid,
      tenantId: data.tenantId,
      workspaceId: data.workspaceId,
      accessTokenHash: hash(newAccessToken),
      refreshTokenHash: hash(newRefreshToken),
      accessExpiresAt: Timestamp.fromMillis(Date.now() + ACCESS_TTL_MS),
      refreshExpiresAt: Timestamp.fromMillis(Date.now() + REFRESH_TTL_MS),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
    });
    transaction.set(linkRef, { status: 'issued', deviceId, issuedAt: now, updatedAt: now }, { merge: true });
    return { status: 'issued' as const };
  });
  if (result.status !== 'issued') return result;
  return {
    status: 'issued' as const,
    deviceId,
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresIn: Math.floor(ACCESS_TTL_MS / 1000),
  };
}

export async function authenticateExtension(request: Request) {
  assertExtensionEnabled();
  const authorization = request.headers.get('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token.startsWith('clf_ext_')) {
    const error = new Error('Connect the extension to your Clarift account.');
    error.name = 'ExtensionAuthenticationError';
    throw error;
  }
  const snapshot = await getAdminFirestore().collection('extensionDevices').where('accessTokenHash', '==', hash(token)).limit(1).get();
  const device = snapshot.docs[0];
  const data = device?.data();
  if (!device || data?.status !== 'active' || data?.accessExpiresAt?.toMillis?.() <= Date.now()) {
    const error = new Error('The Clarift extension session expired.');
    error.name = 'ExtensionAuthenticationError';
    throw error;
  }
  const context = await resolveTenantForUid(String(data.uid), String(data.workspaceId || ''));
  if (context.tenantId !== data.tenantId) throw new Error('Extension tenant mismatch.');
  await device.ref.set({ lastUsedAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true });
  return { deviceId: device.id, context };
}

export async function refreshExtensionSession(token: string) {
  assertExtensionEnabled();
  if (!token.startsWith('clf_refresh_')) throw new Error('The extension refresh token is invalid.');
  const firestore = getAdminFirestore();
  const snapshot = await firestore.collection('extensionDevices').where('refreshTokenHash', '==', hash(token)).limit(1).get();
  const device = snapshot.docs[0];
  const data = device?.data();
  if (!device || data?.status !== 'active' || data?.refreshExpiresAt?.toMillis?.() <= Date.now()) throw new Error('Reconnect the extension to Clarift.');
  const nextAccess = accessToken();
  const nextRefresh = refreshToken();
  await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(device.ref);
    const currentData = current.data();
    if (
      currentData?.status !== 'active' ||
      currentData?.refreshTokenHash !== hash(token) ||
      currentData?.refreshExpiresAt?.toMillis?.() <= Date.now()
    ) throw new Error('Reconnect the extension to Clarift.');
    transaction.set(device.ref, {
      accessTokenHash: hash(nextAccess),
      refreshTokenHash: hash(nextRefresh),
      accessExpiresAt: Timestamp.fromMillis(Date.now() + ACCESS_TTL_MS),
      refreshExpiresAt: Timestamp.fromMillis(Date.now() + REFRESH_TTL_MS),
      updatedAt: Timestamp.now(),
    }, { merge: true });
  });
  return { deviceId: device.id, accessToken: nextAccess, refreshToken: nextRefresh, expiresIn: Math.floor(ACCESS_TTL_MS / 1000) };
}

export async function revokeExtensionSession(request: Request) {
  assertExtensionEnabled();
  const authenticated = await authenticateExtension(request);
  await getAdminFirestore().doc(`extensionDevices/${authenticated.deviceId}`).set({ status: 'revoked', revokedAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true });
  return { revoked: true };
}
