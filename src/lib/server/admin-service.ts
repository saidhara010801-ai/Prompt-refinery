import { Timestamp } from 'firebase-admin/firestore';
import type { NextRequest } from 'next/server';

import { getRuntimeReadiness } from './runtime-readiness';
import { getAdminFirestore } from './firebase-admin';
import {
  FieldPath,
  firestoreTimestampNow,
  getEffectiveUserEntitlement,
  hashRequestValue,
  normalizeUserProfile,
  requireAdmin,
  requireOwner,
  requireSupport,
  type AccountStatus,
  type CurrentUserContext,
  type EntitlementSource,
  type NormalizedUserProfile,
} from './user-access';

export const ADMIN_MAX_PAGE_SIZE = 25;
const DEFAULT_PAGE_SIZE = 10;
const SAFE_ENTITLEMENT_SOURCES = new Set<EntitlementSource>(['manual', 'team', 'beta', 'test']);

export interface AdminAuditInput {
  actor: CurrentUserContext | null;
  action: string;
  targetUid?: string | null;
  metadata?: Record<string, unknown>;
  request?: NextRequest | Request;
}

export interface AdminUserSummary {
  uid: string;
  email: string;
  name: string;
  role: string;
  subscriptionTier: string;
  subscriptionSource: string | null;
  subscriptionStatus: string | null;
  accountStatus: AccountStatus;
  stripeCustomerIdPresent: boolean;
  stripeSubscriptionIdPresent: boolean;
  savedPromptCount: number;
  managedRefinementsUsedToday: number;
}

export function clampAdminPageSize(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.trunc(value), 1), ADMIN_MAX_PAGE_SIZE);
}

export function redactAdminAuditMetadata(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/prompt|content|memory|key|apiKey|secret|token|bearer|cookie|authorization|providerResponse|response/i.test(key)) {
      redacted[key] = '[redacted]';
    } else if (typeof value === 'string') {
      redacted[key] = value.slice(0, 160);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      redacted[key] = value;
    } else {
      redacted[key] = '[metadata]';
    }
  }
  return redacted;
}

function toUserSummary(uid: string, profile: NormalizedUserProfile): AdminUserSummary {
  return {
    uid,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    subscriptionTier: profile.subscriptionTier,
    subscriptionSource: profile.subscriptionSource,
    subscriptionStatus: profile.subscriptionStatus,
    accountStatus: profile.accountStatus,
    stripeCustomerIdPresent: Boolean(profile.stripeCustomerId),
    stripeSubscriptionIdPresent: Boolean(profile.stripeSubscriptionId),
    savedPromptCount: profile.savedPromptCount,
    managedRefinementsUsedToday: profile.managedRefinementsUsedToday,
  };
}

function sanitizeSearchTerm(search: string): string {
  return search.trim().toLowerCase().slice(0, 160);
}

export async function writeAdminAuditLog(input: AdminAuditInput) {
  const firestore = getAdminFirestore();
  await firestore.collection('adminAuditLogs').add({
    actorUid: input.actor?.uid ?? null,
    actorRole: input.actor?.role ?? null,
    action: input.action,
    targetUid: input.targetUid ?? null,
    metadataRedacted: redactAdminAuditMetadata(input.metadata),
    ipHash: hashRequestValue(input.request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null),
    userAgentHash: hashRequestValue(input.request?.headers.get('user-agent') ?? null),
    createdAt: firestoreTimestampNow(),
  });
}

export async function auditUnauthorizedAdminAttempt(request: NextRequest | Request, action: string, error: unknown) {
  await writeAdminAuditLog({
    actor: null,
    action,
    metadata: {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    },
    request,
  }).catch(() => undefined);
}

export async function searchAdminUsers(request: NextRequest, search: string, pageSize?: number, pageToken?: string | null) {
  const actor = await requireAdmin(request);
  const firestore = getAdminFirestore();
  const limit = clampAdminPageSize(pageSize);
  const term = sanitizeSearchTerm(search);

  let users: AdminUserSummary[] = [];
  let nextPageToken: string | null = null;
  if (term) {
    const byUid = await firestore.doc(`users/${term}`).get();
    if (byUid.exists) {
      users = [toUserSummary(byUid.id, normalizeUserProfile(byUid.id, byUid.data() as Record<string, unknown> | undefined))];
    } else {
      let query = firestore
        .collection('users')
        .orderBy('email')
        .startAt(term)
        .endAt(`${term}\uf8ff`)
        .limit(limit);

      if (pageToken) {
        const cursorDoc = await firestore.doc(`users/${pageToken}`).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snapshot = await query.get();
      users = snapshot.docs.map((doc) => toUserSummary(doc.id, normalizeUserProfile(doc.id, doc.data())));
      nextPageToken = snapshot.docs.length === limit ? snapshot.docs.at(-1)?.id ?? null : null;
    }
  }

  await writeAdminAuditLog({
    actor,
    action: 'admin.user_search',
    metadata: { searchProvided: Boolean(term), resultCount: users.length, limit },
    request,
  });

  return { users, pageSize: limit, nextPageToken };
}

export async function readAdminEntitlement(request: NextRequest, uid: string) {
  const actor = await requireAdmin(request);
  const entitlement = await getEffectiveUserEntitlement(uid);
  await writeAdminAuditLog({
    actor,
    action: 'admin.entitlement_read',
    targetUid: uid,
    metadata: { tier: entitlement.tier, source: entitlement.source, isPro: entitlement.isPro },
    request,
  });
  return entitlement;
}

export async function grantPro(request: NextRequest, targetUid: string, source: EntitlementSource, reason: string, expiresAt?: Date | null) {
  const actor = await requireOwner(request);
  if (!SAFE_ENTITLEMENT_SOURCES.has(source)) {
    throw new Error('Only manual, team, beta, or test grants can be created from admin APIs.');
  }

  const firestore = getAdminFirestore();
  const now = firestoreTimestampNow();
  await firestore.doc(`adminEntitlements/${targetUid}`).set({
    tier: 'pro',
    source,
    reason: reason.slice(0, 240),
    grantedByUid: actor.uid,
    expiresAt: expiresAt ? Timestamp.fromDate(expiresAt) : null,
    createdAt: now,
    revokedAt: null,
    revokedByUid: null,
    updatedAt: now,
  }, { merge: true });

  await writeAdminAuditLog({
    actor,
    action: 'admin.pro_grant',
    targetUid,
    metadata: { source, expiresAt: expiresAt?.toISOString() ?? null },
    request,
  });

  return readAdminEntitlement(request, targetUid);
}

export async function revokePro(request: NextRequest, targetUid: string) {
  const actor = await requireOwner(request);
  const now = firestoreTimestampNow();
  await getAdminFirestore().doc(`adminEntitlements/${targetUid}`).set({
    revokedAt: now,
    revokedByUid: actor.uid,
    updatedAt: now,
  }, { merge: true });

  await writeAdminAuditLog({
    actor,
    action: 'admin.pro_revoke',
    targetUid,
    metadata: { revokesStripe: false },
    request,
  });

  return readAdminEntitlement(request, targetUid);
}

export async function updateAccountStatus(request: NextRequest, targetUid: string, accountStatus: Exclude<AccountStatus, 'deleted_pending'> | 'deleted_pending') {
  const actor = await requireOwner(request);
  const firestore = getAdminFirestore();
  await firestore.doc(`users/${targetUid}`).set({
    accountStatus,
    updatedAt: firestoreTimestampNow(),
  }, { merge: true });

  await writeAdminAuditLog({
    actor,
    action: accountStatus === 'active' ? 'admin.account_reactivate' : 'admin.account_status_change',
    targetUid,
    metadata: { accountStatus },
    request,
  });

  return readAdminUserByUid(request, targetUid);
}

export async function readAdminUserByUid(request: NextRequest, uid: string) {
  const actor = await requireAdmin(request);
  const snapshot = await getAdminFirestore().doc(`users/${uid}`).get();
  const user = toUserSummary(uid, normalizeUserProfile(uid, snapshot.data() as Record<string, unknown> | undefined));
  await writeAdminAuditLog({
    actor,
    action: 'admin.user_read',
    targetUid: uid,
    metadata: { exists: snapshot.exists },
    request,
  });
  return user;
}

export async function readAuditLogs(request: NextRequest, pageSize?: number, cursor?: string | null) {
  const actor = await requireAdmin(request);
  const limit = clampAdminPageSize(pageSize);
  let query = getAdminFirestore()
    .collection('adminAuditLogs')
    .orderBy('createdAt', 'desc')
    .orderBy(FieldPath.documentId())
    .limit(limit);

  if (cursor) {
    const cursorDoc = await getAdminFirestore().doc(`adminAuditLogs/${cursor}`).get();
    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc);
    }
  }

  const snapshot = await query.get();
  await writeAdminAuditLog({
    actor,
    action: 'admin.audit_log_read',
    metadata: { resultCount: snapshot.size, limit },
    request,
  });

  return {
    logs: snapshot.docs.map((doc) => ({
      id: doc.id,
      actorUid: doc.data().actorUid ?? null,
      actorRole: doc.data().actorRole ?? null,
      action: doc.data().action ?? '',
      targetUid: doc.data().targetUid ?? null,
      metadataRedacted: doc.data().metadataRedacted ?? {},
      createdAt: doc.data().createdAt?.toDate?.()?.toISOString?.() ?? null,
      ipHash: doc.data().ipHash ?? null,
      userAgentHash: doc.data().userAgentHash ?? null,
    })),
    nextPageToken: snapshot.docs.length === limit ? snapshot.docs.at(-1)?.id ?? null : null,
    pageSize: limit,
  };
}

export async function readSafeSystemHealth(request: NextRequest) {
  const actor = await requireSupport(request);
  const readiness = getRuntimeReadiness(process.env);
  await writeAdminAuditLog({
    actor,
    action: 'admin.system_health_read',
    metadata: { ready: readiness.ready },
    request,
  });
  return {
    service: 'prompt-refinery',
    ready: readiness.ready,
    checks: readiness.checks,
    featureFlags: {
      adminCenter: process.env.ENABLE_ADMIN_CENTER === 'true',
      discountAdmin: process.env.ENABLE_DISCOUNT_ADMIN === 'true',
      fileConversion: process.env.ENABLE_FILE_CONVERSION === 'true',
      stripeCheckout: process.env.ENABLE_STRIPE_CHECKOUT === 'true',
      supportAccessRequests: process.env.ENABLE_SUPPORT_ACCESS_REQUESTS === 'true',
      managedOpenRouter: process.env.ENABLE_MANAGED_OPENROUTER === 'true',
    },
  };
}
