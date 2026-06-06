import { createHash } from 'node:crypto';

import type { DecodedIdToken } from 'firebase-admin/auth';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import type { NextRequest } from 'next/server';

import { isProTier, type SubscriptionTier } from '@/lib/subscription';
import { getAdminAuth, getAdminFirestore } from './firebase-admin';

export type UserRole = 'user' | 'support' | 'admin' | 'owner';
export type AccountStatus = 'active' | 'disabled' | 'suspended' | 'deleted_pending';
export type SubscriptionSource = 'stripe' | 'manual' | 'team' | 'beta' | 'test' | 'owner' | null;
export type EntitlementSource = Exclude<SubscriptionSource, null>;

export interface NormalizedUserProfile {
  id: string;
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  subscriptionTier: SubscriptionTier;
  subscriptionSource: SubscriptionSource;
  subscriptionStatus: string | null;
  accountStatus: AccountStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  savedPromptCount: number;
  managedRefinementsDate: string | null;
  managedRefinementsUsedToday: number;
}

export interface EffectiveEntitlement {
  uid: string;
  tier: SubscriptionTier;
  isPro: boolean;
  source: SubscriptionSource;
  reason: string | null;
  expiresAt: Date | null;
}

export interface CurrentUserContext {
  decodedToken: DecodedIdToken;
  uid: string;
  email: string;
  role: UserRole;
  profile: NormalizedUserProfile;
  entitlement: EffectiveEntitlement;
}

export class AuthorizationError extends Error {
  constructor(message: string, public readonly status = 403, name = 'AuthorizationError') {
    super(message);
    this.name = name;
  }
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeRole(value: unknown): UserRole {
  return value === 'support' || value === 'admin' || value === 'owner' ? value : 'user';
}

function normalizeTier(value: unknown): SubscriptionTier {
  return value === 'pro' || value === 'pro-max' ? value : 'free';
}

function normalizeStatus(value: unknown): AccountStatus {
  return value === 'disabled' || value === 'suspended' || value === 'deleted_pending' ? value : 'active';
}

function normalizeSource(value: unknown): SubscriptionSource {
  return value === 'stripe' || value === 'manual' || value === 'team' || value === 'beta' || value === 'test' || value === 'owner'
    ? value
    : null;
}

function splitEnvList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function envContains(value: string | undefined, needle: string): boolean {
  const normalizedNeedle = needle.toLowerCase();
  return splitEnvList(value).some((item) => item.toLowerCase() === normalizedNeedle);
}

function timestampToDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date : null;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function normalizeUserProfile(uid: string, data: Record<string, unknown> | undefined | null): NormalizedUserProfile {
  const profile = data ?? {};
  return {
    id: asString(profile.id, uid),
    uid,
    email: asString(profile.email).toLowerCase(),
    name: asString(profile.name),
    role: normalizeRole(profile.role),
    subscriptionTier: normalizeTier(profile.subscriptionTier),
    subscriptionSource: normalizeSource(profile.subscriptionSource),
    subscriptionStatus: asString(profile.subscriptionStatus) || null,
    accountStatus: normalizeStatus(profile.accountStatus),
    stripeCustomerId: asString(profile.stripeCustomerId) || null,
    stripeSubscriptionId: asString(profile.stripeSubscriptionId) || null,
    savedPromptCount: asNumber(profile.savedPromptCount),
    managedRefinementsDate: asString(profile.managedRefinementsDate) || null,
    managedRefinementsUsedToday: asNumber(profile.managedRefinementsUsedToday),
  };
}

export function getBootstrapRole(decodedToken: Pick<DecodedIdToken, 'uid' | 'email'>, storedRole: UserRole = 'user'): UserRole {
  const email = (decodedToken.email ?? '').toLowerCase();
  if (envContains(process.env.OWNER_UIDS, decodedToken.uid) || (email && envContains(process.env.OWNER_EMAILS, email))) {
    return 'owner';
  }
  if (storedRole === 'owner') {
    return 'owner';
  }
  if (envContains(process.env.ADMIN_EMAILS, email) || storedRole === 'admin') {
    return 'admin';
  }
  if (envContains(process.env.SUPPORT_EMAILS, email) || storedRole === 'support') {
    return 'support';
  }
  return 'user';
}

export function isAccountBlocked(status: AccountStatus): boolean {
  return status === 'disabled' || status === 'suspended' || status === 'deleted_pending';
}

export function assertActiveAccount(profile: Pick<NormalizedUserProfile, 'accountStatus'>, action: string) {
  if (isAccountBlocked(profile.accountStatus)) {
    throw new AuthorizationError(`This account is ${profile.accountStatus}. It cannot ${action}.`, 403, 'AccountStatusBlockedError');
  }
}

export function evaluateEntitlement(
  uid: string,
  profile: Pick<NormalizedUserProfile, 'role' | 'subscriptionTier' | 'subscriptionSource' | 'subscriptionStatus'>,
  grant: Record<string, unknown> | undefined | null,
  now = new Date()
): EffectiveEntitlement {
  const grantTier = normalizeTier(grant?.tier);
  const grantSource = normalizeSource(grant?.source);
  const expiresAt = timestampToDate(grant?.expiresAt);
  const revokedAt = timestampToDate(grant?.revokedAt);
  const activeGrant = grantTier !== 'free' &&
    grantSource !== 'stripe' &&
    grantSource !== null &&
    !revokedAt &&
    (!expiresAt || expiresAt.getTime() > now.getTime());

  if (profile.role === 'owner') {
    return { uid, tier: 'pro', isPro: true, source: 'owner', reason: 'Owner role entitlement', expiresAt: null };
  }

  if (activeGrant && isProTier(grantTier)) {
    return {
      uid,
      tier: grantTier,
      isPro: true,
      source: grantSource,
      reason: asString(grant?.reason) || null,
      expiresAt,
    };
  }

  const stripeActive = profile.subscriptionSource === 'stripe' ||
    profile.subscriptionStatus === 'active' ||
    profile.subscriptionStatus === 'trialing' ||
    (isProTier(profile.subscriptionTier) && !profile.subscriptionSource);

  if (stripeActive && isProTier(profile.subscriptionTier)) {
    return { uid, tier: profile.subscriptionTier, isPro: true, source: 'stripe', reason: 'Active Stripe subscription', expiresAt: null };
  }

  return { uid, tier: 'free', isPro: false, source: null, reason: null, expiresAt: null };
}

export function getBearerTokenFromRequest(request: Request): string | undefined {
  const authorization = request.headers.get('authorization');
  return authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
}

export async function verifyFirebaseIdToken(firebaseIdToken?: string): Promise<DecodedIdToken> {
  if (!firebaseIdToken) {
    throw new AuthorizationError('Sign in to continue.', 401, 'AuthenticationRequiredError');
  }

  try {
    return await getAdminAuth().verifyIdToken(firebaseIdToken);
  } catch {
    throw new AuthorizationError('Your sign-in session could not be verified. Sign in again and retry.', 401, 'AuthenticationRequiredError');
  }
}

export async function getEffectiveUserRole(uid: string): Promise<UserRole> {
  const firestore = getAdminFirestore();
  const snapshot = await firestore.doc(`users/${uid}`).get();
  const profile = normalizeUserProfile(uid, snapshot.data() as Record<string, unknown> | undefined);
  let email = profile.email;
  if (!email) {
    try {
      email = (await getAdminAuth().getUser(uid)).email?.toLowerCase() ?? '';
    } catch {
      email = '';
    }
  }
  return getBootstrapRole({ uid, email } as DecodedIdToken, profile.role);
}

export async function getEffectiveUserEntitlement(uid: string): Promise<EffectiveEntitlement> {
  const firestore = getAdminFirestore();
  const [userSnapshot, grantSnapshot] = await Promise.all([
    firestore.doc(`users/${uid}`).get(),
    firestore.doc(`adminEntitlements/${uid}`).get(),
  ]);
  const profile = normalizeUserProfile(uid, userSnapshot.data() as Record<string, unknown> | undefined);
  const role = await getEffectiveUserRole(uid);
  return evaluateEntitlement(uid, { ...profile, role }, grantSnapshot.data() as Record<string, unknown> | undefined);
}

export async function getCurrentUserFromRequest(request: NextRequest | Request): Promise<CurrentUserContext> {
  const decodedToken = await verifyFirebaseIdToken(getBearerTokenFromRequest(request));
  const firestore = getAdminFirestore();
  const userSnapshot = await firestore.doc(`users/${decodedToken.uid}`).get();
  const storedProfile = normalizeUserProfile(decodedToken.uid, userSnapshot.data() as Record<string, unknown> | undefined);
  const role = getBootstrapRole(decodedToken, storedProfile.role);
  const profile = {
    ...storedProfile,
    role,
    email: storedProfile.email || (decodedToken.email ?? '').toLowerCase(),
    name: storedProfile.name || decodedToken.name || '',
  };
  const grantSnapshot = await firestore.doc(`adminEntitlements/${decodedToken.uid}`).get();
  const entitlement = evaluateEntitlement(decodedToken.uid, profile, grantSnapshot.data() as Record<string, unknown> | undefined);

  return {
    decodedToken,
    uid: decodedToken.uid,
    email: profile.email,
    role,
    profile,
    entitlement,
  };
}

function roleRank(role: UserRole): number {
  return role === 'owner' ? 4 : role === 'admin' ? 3 : role === 'support' ? 2 : 1;
}

export function canAccessRole(role: UserRole, requiredRole: UserRole): boolean {
  return roleRank(role) >= roleRank(requiredRole);
}

export function isMockAuthAllowed(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.NODE_ENV !== 'production' && environment.ENABLE_MOCK_AUTH === 'true';
}

export async function requireUser(request: NextRequest | Request): Promise<CurrentUserContext> {
  return getCurrentUserFromRequest(request);
}

export async function requireSupport(request: NextRequest | Request): Promise<CurrentUserContext> {
  const context = await requireUser(request);
  if (!canAccessRole(context.role, 'support')) {
    throw new AuthorizationError('Support access is required.', 403, 'SupportRequiredError');
  }
  return context;
}

export async function requireAdmin(request: NextRequest | Request): Promise<CurrentUserContext> {
  const context = await requireUser(request);
  if (!canAccessRole(context.role, 'admin')) {
    throw new AuthorizationError('Admin access is required.', 403, 'AdminRequiredError');
  }
  return context;
}

export async function requireOwner(request: NextRequest | Request): Promise<CurrentUserContext> {
  const context = await requireUser(request);
  if (context.role !== 'owner') {
    throw new AuthorizationError('Owner access is required.', 403, 'OwnerRequiredError');
  }
  return context;
}

export function hashRequestValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

export function firestoreTimestampNow() {
  return Timestamp.now();
}

export { FieldPath };
