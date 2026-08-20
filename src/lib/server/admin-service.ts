import type { UserRecord } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import type { NextRequest } from 'next/server';

import { getRuntimeReadiness } from './runtime-readiness';
import { getAdminAuth, getAdminFirestore } from './firebase-admin';
import { ensurePersonalTenant, personalTenantId } from './tenant-service';
import {
  firestoreTimestampNow,
  getEffectiveUserEntitlement,
  hashRequestValue,
  normalizeUserProfile,
  requireAdmin,
  requireOwner,
  requireSupport,
  type AccountStatus,
  AuthorizationError,
  type CurrentUserContext,
  type EntitlementSource,
  type NormalizedUserProfile,
} from './user-access';

export const ADMIN_MAX_PAGE_SIZE = 25;
const DEFAULT_PAGE_SIZE = 10;
const SAFE_ENTITLEMENT_SOURCES = new Set<EntitlementSource>(['manual', 'team', 'beta', 'test']);

export function assertOwnerAccountStatusChange(actorUid: string, targetUid: string, accountStatus: AccountStatus) {
  if (actorUid === targetUid && accountStatus !== 'active') {
    throw new AuthorizationError('The active owner cannot suspend, disable, or delete their own account.', 409, 'OwnerSelfLockoutError');
  }
}

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
  profileStatus: 'ready' | 'auth_only';
  freeManagedInferenceBeta: boolean;
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

function toUserSummary(uid: string, profile: NormalizedUserProfile, authUser?: UserRecord | null, profileExists = true): AdminUserSummary {
  return {
    uid,
    email: profile.email || authUser?.email?.toLowerCase() || '',
    name: profile.name || authUser?.displayName || '',
    role: profile.role,
    subscriptionTier: profile.subscriptionTier,
    subscriptionSource: profile.subscriptionSource,
    subscriptionStatus: profile.subscriptionStatus,
    accountStatus: authUser?.disabled ? 'disabled' : profile.accountStatus,
    stripeCustomerIdPresent: Boolean(profile.stripeCustomerId),
    stripeSubscriptionIdPresent: Boolean(profile.stripeSubscriptionId),
    savedPromptCount: profile.savedPromptCount,
    managedRefinementsUsedToday: profile.managedRefinementsUsedToday,
    profileStatus: profileExists ? 'ready' : 'auth_only',
    freeManagedInferenceBeta: false,
  };
}

async function toEffectiveUserSummary(
  uid: string,
  profile: NormalizedUserProfile,
  authUser?: UserRecord | null,
  profileExists = true
): Promise<AdminUserSummary> {
  const [entitlement, tenantEntitlement] = await Promise.all([
    getEffectiveUserEntitlement(uid),
    getAdminFirestore().doc(`tenantEntitlements/${personalTenantId(uid)}`).get(),
  ]);
  return {
    ...toUserSummary(uid, profile, authUser, profileExists),
    subscriptionTier: entitlement.tier,
    subscriptionSource: entitlement.source,
    freeManagedInferenceBeta: tenantEntitlement.data()?.freeManagedInferenceBeta === true,
  };
}

export function normalizeAdminUserSearch(search: string): { exact: string; emailPrefix: string } {
  const exact = search.trim().slice(0, 160);
  return { exact, emailPrefix: exact.toLowerCase() };
}

function isAuthUserLookupMiss(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return new Set(['auth/user-not-found', 'auth/invalid-uid', 'auth/invalid-email'])
    .has(String((error as { code?: unknown }).code));
}

async function findAuthUserByUid(uid: string): Promise<UserRecord | null> {
  try {
    return await getAdminAuth().getUser(uid);
  } catch (error) {
    if (isAuthUserLookupMiss(error)) return null;
    throw error;
  }
}

async function findAuthUserByEmail(email: string): Promise<UserRecord | null> {
  try {
    return await getAdminAuth().getUserByEmail(email);
  } catch (error) {
    if (isAuthUserLookupMiss(error)) return null;
    throw error;
  }
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
  const { exact, emailPrefix } = normalizeAdminUserSearch(search);

  let users: AdminUserSummary[] = [];
  let nextPageToken: string | null = null;
  if (exact) {
    const isEmailSearch = exact.includes('@');
    const authUser = isEmailSearch
      ? await findAuthUserByEmail(emailPrefix)
      : await findAuthUserByUid(exact);
    const targetUid = authUser?.uid ?? exact;
    const exactProfile = await firestore.doc(`users/${targetUid}`).get();

    if (exactProfile.exists || authUser) {
      users = [await toEffectiveUserSummary(
        targetUid,
        normalizeUserProfile(targetUid, exactProfile.data() as Record<string, unknown> | undefined),
        authUser,
        exactProfile.exists
      )];
    } else {
      let query = firestore
        .collection('users')
        .orderBy('email')
        .startAt(emailPrefix)
        .endAt(`${emailPrefix}\uf8ff`)
        .limit(limit);

      if (pageToken) {
        const cursorDoc = await firestore.doc(`users/${pageToken}`).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snapshot = await query.get();
      users = await Promise.all(snapshot.docs.map((doc) => toEffectiveUserSummary(doc.id, normalizeUserProfile(doc.id, doc.data()))));
      nextPageToken = snapshot.docs.length === limit ? snapshot.docs.at(-1)?.id ?? null : null;
    }
  }

  await writeAdminAuditLog({
    actor,
    action: 'admin.user_search',
    metadata: { searchProvided: Boolean(exact), searchKind: exact.includes('@') ? 'email' : 'uid', resultCount: users.length, limit },
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
  assertOwnerAccountStatusChange(actor.uid, targetUid, accountStatus);
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
  const authUser = await findAuthUserByUid(uid);
  const user = await toEffectiveUserSummary(
    uid,
    normalizeUserProfile(uid, snapshot.data() as Record<string, unknown> | undefined),
    authUser,
    snapshot.exists
  );
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
    service: 'clarift',
    ready: readiness.ready,
    checks: readiness.checks,
    featureFlags: {
      adminCenter: process.env.ENABLE_ADMIN_CENTER === 'true',
      discountAdmin: process.env.ENABLE_DISCOUNT_ADMIN === 'true',
      fileConversion: process.env.ENABLE_FILE_CONVERSION === 'true',
      stripeCheckout: process.env.ENABLE_STRIPE_CHECKOUT === 'true',
      supportAccessRequests: process.env.ENABLE_SUPPORT_ACCESS_REQUESTS === 'true',
      managedOpenRouter: process.env.ENABLE_MANAGED_OPENROUTER === 'true',
      freeManagedInference: process.env.ENABLE_FREE_MANAGED_INFERENCE === 'true',
    },
  };
}

export async function setFreeInferenceBeta(request: NextRequest, targetUid: string, enabled: boolean) {
  const actor = await requireOwner(request);
  const authUser = await findAuthUserByUid(targetUid);
  if (!authUser) {
    throw new AuthorizationError('The Firebase Authentication user was not found.', 404, 'AdminTargetNotFoundError');
  }

  const firestore = getAdminFirestore();
  const userRef = firestore.doc(`users/${targetUid}`);
  const user = await userRef.get();
  const profile = normalizeUserProfile(targetUid, user.data() as Record<string, unknown> | undefined);
  const now = Timestamp.now();
  await userRef.set({
    id: targetUid,
    uid: targetUid,
    email: authUser.email?.toLowerCase() ?? profile.email,
    name: authUser.displayName || profile.name,
    accountStatus: authUser.disabled ? 'disabled' : profile.accountStatus,
    ...(!user.exists ? { createdAt: now } : {}),
    updatedAt: now,
  }, { merge: true });

  const tenant = await ensurePersonalTenant(targetUid);
  const tenantId = tenant.tenantId;
  await getAdminFirestore().doc(`tenantEntitlements/${tenantId}`).set({
    freeManagedInferenceBeta: enabled,
    updatedAt: now,
  }, { merge: true });
  await writeAdminAuditLog({
    actor,
    action: 'admin.free_inference_beta_change',
    targetUid,
    metadata: { enabled },
    request,
  });
  return { uid: targetUid, tenantId, enabled };
}

export async function readFreeInferenceHealth(request: NextRequest) {
  const actor = await requireSupport(request);
  const firestore = getAdminFirestore();
  const since = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
  const day = new Date().toISOString().slice(0, 10);
  const [events, circuits, openRouterBudget, togetherBudget, overallBudget] = await Promise.all([
    firestore.collection('usageEvents').where('createdAt', '>=', since).limit(1000).get(),
    firestore.collection('providerCircuits').limit(50).get(),
    firestore.doc(`providerBudgets/openrouter_${day}`).get(),
    firestore.doc(`providerBudgets/together_${day}`).get(),
    firestore.doc(`providerBudgets/all_${day}`).get(),
  ]);
  const records = events.docs.map((doc) => doc.data());
  const latencies = records.map((record) => Number(record.latencyMs) || 0).filter(Boolean).sort((a, b) => a - b);
  const percentile = (fraction: number) => latencies.length ? latencies[Math.min(Math.ceil(latencies.length * fraction) - 1, latencies.length - 1)] : null;
  const attempts = records.flatMap((record) => Array.isArray(record.attempts) ? record.attempts : []);
  const malformed = attempts.filter((attempt) => attempt?.status === 'malformed').length;
  const attemptIssueCounts = new Map<string, { provider: string; model: string; status: string; errorCode: string; httpStatus: number | null; count: number }>();
  for (const attempt of attempts.filter((item) => item?.status !== 'succeeded')) {
    const issue = {
      provider: String(attempt?.provider || 'unknown'),
      model: String(attempt?.model || 'unknown'),
      status: String(attempt?.status || 'unknown'),
      errorCode: String(attempt?.errorCode || 'UnknownError'),
      httpStatus: Number.isInteger(attempt?.httpStatus) ? Number(attempt.httpStatus) : null,
    };
    const key = JSON.stringify(issue);
    const existing = attemptIssueCounts.get(key);
    attemptIssueCounts.set(key, { ...issue, count: (existing?.count ?? 0) + 1 });
  }
  const result = {
    windowHours: 24,
    requests: records.length,
    succeeded: records.filter((record) => record.status === 'succeeded').length,
    failed: records.filter((record) => record.status === 'failed').length,
    generative: records.filter((record) => record.qualityTier === 'generative').length,
    fallback: records.filter((record) => record.qualityTier === 'fallback').length,
    malformedAttempts: malformed,
    attemptIssues: Array.from(attemptIssueCounts.values()).sort((a, b) => b.count - a.count).slice(0, 12),
    latencyMs: { p50: percentile(0.5), p95: percentile(0.95) },
    budgets: {
      openrouter: openRouterBudget.data() ?? null,
      together: togetherBudget.data() ?? null,
      overall: overallBudget.data() ?? null,
    },
    circuits: circuits.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
  };
  await writeAdminAuditLog({ actor, action: 'admin.free_inference_health_read', metadata: { requests: records.length }, request });
  return result;
}

interface BetaEvidenceEvent {
  task?: unknown;
  source?: unknown;
  provider?: unknown;
  qualityTier?: unknown;
  status?: unknown;
  latencyMs?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
  providerCostUsd?: unknown;
  errorCode?: unknown;
  createdAt?: unknown;
}

function incrementCounter(target: Record<string, number>, value: unknown, fallback = 'unknown') {
  const key = typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : fallback;
  target[key] = (target[key] ?? 0) + 1;
}

function numericTotal(records: BetaEvidenceEvent[], field: keyof BetaEvidenceEvent) {
  return records.reduce((total, record) => {
    const value = Number(record[field]);
    return total + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
}

function evidenceEventDate(value: unknown): Date | null {
  const date = value instanceof Timestamp
    ? value.toDate()
    : typeof (value as { toDate?: unknown } | null)?.toDate === 'function'
      ? (value as { toDate: () => Date }).toDate()
      : value instanceof Date
        ? value
        : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function aggregateBetaEvidence(input: {
  events: BetaEvidenceEvent[];
  betaTenantCount: number;
  from: Date;
  to: Date;
  truncated?: boolean;
}) {
  const events = input.events;
  const latencies = events
    .map((record) => Number(record.latencyMs))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const percentile = (fraction: number) => latencies.length
    ? latencies[Math.min(Math.ceil(latencies.length * fraction) - 1, latencies.length - 1)]
    : null;
  const byTask: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byProvider: Record<string, number> = {};
  const byQualityTier: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byErrorCode: Record<string, number> = {};
  const daily = new Map<string, { day: string; requests: number; succeeded: number; generative: number; fallback: number; failed: number }>();

  for (const event of events) {
    incrementCounter(byTask, event.task);
    incrementCounter(bySource, event.source);
    incrementCounter(byProvider, event.provider);
    incrementCounter(byQualityTier, event.qualityTier);
    incrementCounter(byStatus, event.status);
    if (event.status === 'failed' || event.errorCode) incrementCounter(byErrorCode, event.errorCode, 'unclassified');

    const date = evidenceEventDate(event.createdAt);
    if (!date) continue;
    const day = date.toISOString().slice(0, 10);
    const bucket = daily.get(day) ?? { day, requests: 0, succeeded: 0, generative: 0, fallback: 0, failed: 0 };
    bucket.requests += 1;
    bucket.succeeded += event.status === 'succeeded' ? 1 : 0;
    bucket.failed += event.status === 'failed' ? 1 : 0;
    bucket.generative += event.qualityTier === 'generative' ? 1 : 0;
    bucket.fallback += event.qualityTier === 'fallback' ? 1 : 0;
    daily.set(day, bucket);
  }

  return {
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    period: { from: input.from.toISOString(), to: input.to.toISOString() },
    privacy: {
      contentFree: true,
      identifiersIncluded: false,
      note: 'Aggregates exclude tester email, UID, tenant ID, principal ID, prompts, outputs, attachments, credentials, and provider response content.',
    },
    cohort: { enabledBetaTenants: input.betaTenantCount },
    totals: {
      requests: events.length,
      succeeded: byStatus.succeeded ?? 0,
      failed: byStatus.failed ?? 0,
      generative: byQualityTier.generative ?? 0,
      fallback: byQualityTier.fallback ?? 0,
      inputTokens: numericTotal(events, 'inputTokens'),
      outputTokens: numericTotal(events, 'outputTokens'),
      providerCostUsd: Math.round(numericTotal(events, 'providerCostUsd') * 1_000_000) / 1_000_000,
    },
    latencyMs: { p50: percentile(0.5), p95: percentile(0.95) },
    breakdowns: { byTask, bySource, byProvider, byQualityTier, byStatus, byErrorCode },
    daily: Array.from(daily.values()).sort((a, b) => a.day.localeCompare(b.day)),
    truncated: input.truncated === true,
  };
}

export async function readBetaEvidenceReport(request: NextRequest, windowDays = 30) {
  const actor = await requireOwner(request);
  const firestore = getAdminFirestore();
  const days = Math.min(Math.max(Math.trunc(windowDays) || 30, 1), 90);
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const entitlementSnapshot = await firestore
    .collection('tenantEntitlements')
    .where('freeManagedInferenceBeta', '==', true)
    .limit(100)
    .get();
  const tenantIds = entitlementSnapshot.docs.map((document) => document.id);
  const eventSnapshots = await Promise.all(Array.from({ length: Math.ceil(tenantIds.length / 30) }, (_, index) => {
    const tenantChunk = tenantIds.slice(index * 30, index * 30 + 30);
    return firestore
      .collection('usageEvents')
      .where('tenantId', 'in', tenantChunk)
      .where('createdAt', '>=', Timestamp.fromDate(from))
      .orderBy('createdAt', 'desc')
      .limit(5000)
      .get();
  }));
  const eventDocuments = eventSnapshots.flatMap((snapshot) => snapshot.docs);
  const report = aggregateBetaEvidence({
    events: eventDocuments.map((document) => document.data()),
    betaTenantCount: tenantIds.length,
    from,
    to,
    truncated: entitlementSnapshot.size === 100 || eventSnapshots.some((snapshot) => snapshot.size === 5000),
  });
  await writeAdminAuditLog({
    actor,
    action: 'admin.beta_evidence_report_read',
    metadata: { betaTenantCount: tenantIds.length, requests: eventDocuments.length, windowDays: days, truncated: report.truncated },
    request,
  });
  return report;
}
