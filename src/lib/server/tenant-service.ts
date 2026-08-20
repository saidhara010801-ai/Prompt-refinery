import { Timestamp } from 'firebase-admin/firestore';

import { getAdminFirestore } from './firebase-admin';
import {
  assertActiveAccount,
  getEffectiveUserEntitlement,
  normalizeUserProfile,
  verifyFirebaseIdToken,
} from './user-access';
import { isProTier } from '@/lib/subscription';
import { personalMembershipId, personalTenantId, personalWorkspaceId } from '@/lib/tenant-ids';

export { personalMembershipId, personalTenantId, personalWorkspaceId } from '@/lib/tenant-ids';

export type TenantRole = 'owner' | 'admin' | 'member' | 'viewer' | 'billing';

export interface TenantContext {
  principalId: string;
  tenantId: string;
  workspaceId: string;
  role: TenantRole;
  tenantType: 'personal';
}

export interface TenantAccountSummary extends TenantContext {
  balance: number;
  reserved: number;
  available: number;
  plan: string;
  planStatus: string;
  planSource: string | null;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function ensurePersonalTenant(uid: string): Promise<TenantContext> {
  const firestore = getAdminFirestore();
  const tenantId = personalTenantId(uid);
  const workspaceId = personalWorkspaceId(uid);
  const tenantRef = firestore.doc(`tenants/${tenantId}`);
  const workspaceRef = firestore.doc(`workspaces/${workspaceId}`);
  const membershipRef = firestore.doc(`tenantMembers/${personalMembershipId(uid)}`);
  const walletRef = firestore.doc(`creditWallets/${tenantId}`);
  const entitlementRef = firestore.doc(`tenantEntitlements/${tenantId}`);
  const trialLedgerRef = firestore.doc(`creditLedger/trial_${tenantId}`);
  const userRef = firestore.doc(`users/${uid}`);
  const now = Timestamp.now();
  const trialCredits = positiveInteger(process.env.CLARIFT_TRIAL_CREDITS, 10);

  await firestore.runTransaction(async (transaction) => {
    const [tenant, workspace, membership, wallet, entitlement, trialLedger, user] = await Promise.all([
      transaction.get(tenantRef),
      transaction.get(workspaceRef),
      transaction.get(membershipRef),
      transaction.get(walletRef),
      transaction.get(entitlementRef),
      transaction.get(trialLedgerRef),
      transaction.get(userRef),
    ]);
    const profile = normalizeUserProfile(uid, user.data() as Record<string, unknown> | undefined);
    assertActiveAccount(profile, 'use Clarift');

    if (!tenant.exists) {
      transaction.create(tenantRef, {
        type: 'personal',
        name: profile.name?.trim() ? `${profile.name.trim()}'s workspace` : 'Personal workspace',
        ownerId: uid,
        status: 'active',
        defaultWorkspaceId: workspaceId,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (!workspace.exists) {
      transaction.create(workspaceRef, {
        tenantId,
        name: 'Personal',
        createdBy: uid,
        status: 'active',
        settings: {},
        createdAt: now,
        updatedAt: now,
      });
    }
    if (!membership.exists) {
      transaction.create(membershipRef, {
        tenantId,
        userId: uid,
        role: 'owner',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
    }
    if (!wallet.exists) {
      transaction.create(walletRef, {
        tenantId,
        balance: trialCredits,
        reserved: 0,
        lifetimeGranted: trialCredits,
        lifetimeSpent: 0,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (!trialLedger.exists) {
      transaction.create(trialLedgerRef, {
        tenantId,
        type: 'trial_grant',
        amount: trialCredits,
        balanceDelta: trialCredits,
        sourceId: `trial_${tenantId}`,
        createdBy: 'system',
        createdAt: now,
      });
    }
    if (!entitlement.exists) {
      const migratedPro = isProTier(profile.subscriptionTier);
      transaction.create(entitlementRef, {
        tenantId,
        plan: migratedPro ? 'individual' : 'free',
        status: profile.subscriptionStatus || 'active',
        managedInference: true,
        byokAllowed: true,
        developerApiAllowed: migratedPro,
        source: migratedPro ? (profile.subscriptionSource || 'legacy') : 'trial',
        createdAt: now,
        updatedAt: now,
      });
    }

    transaction.set(userRef, {
      id: uid,
      activeTenantId: tenantId,
      activeWorkspaceId: workspaceId,
      tenantMigrationVersion: 1,
      updatedAt: now,
    }, { merge: true });
  });

  return { principalId: uid, tenantId, workspaceId, role: 'owner', tenantType: 'personal' };
}

export async function resolveTenantForUid(uid: string, requestedWorkspaceId?: string | null): Promise<TenantContext> {
  const context = await ensurePersonalTenant(uid);
  if (!requestedWorkspaceId || requestedWorkspaceId === context.workspaceId) return context;

  const [membership, workspace] = await Promise.all([
    getAdminFirestore().doc(`tenantMembers/${context.tenantId}_${uid}`).get(),
    getAdminFirestore().doc(`workspaces/${requestedWorkspaceId}`).get(),
  ]);
  if (membership.data()?.status !== 'active' || workspace.data()?.tenantId !== context.tenantId || workspace.data()?.status !== 'active') {
    const error = new Error('The requested workspace is unavailable.');
    error.name = 'WorkspaceAccessError';
    throw error;
  }
  return { ...context, workspaceId: requestedWorkspaceId };
}

export async function resolveTenantFromToken(firebaseIdToken: string, requestedWorkspaceId?: string | null) {
  const decoded = await verifyFirebaseIdToken(firebaseIdToken);
  return resolveTenantForUid(decoded.uid, requestedWorkspaceId);
}

export async function getTenantAccountSummary(firebaseIdToken: string): Promise<TenantAccountSummary> {
  const decoded = await verifyFirebaseIdToken(firebaseIdToken);
  const context = await resolveTenantForUid(decoded.uid);
  const [wallet, tenantEntitlement, userEntitlement] = await Promise.all([
    getAdminFirestore().doc(`creditWallets/${context.tenantId}`).get(),
    getAdminFirestore().doc(`tenantEntitlements/${context.tenantId}`).get(),
    getEffectiveUserEntitlement(decoded.uid),
  ]);
  const balance = Number(wallet.data()?.balance) || 0;
  const reserved = Number(wallet.data()?.reserved) || 0;
  const tenantPlan = String(tenantEntitlement.data()?.plan || 'free');
  const effectivePlan = tenantPlan === 'free' && userEntitlement.isPro
    ? 'individual'
    : tenantPlan || userEntitlement.tier || 'free';
  return {
    ...context,
    balance,
    reserved,
    available: Math.max(balance - reserved, 0),
    plan: effectivePlan,
    planStatus: String(tenantEntitlement.data()?.status || 'active'),
    planSource: userEntitlement.isPro
      ? userEntitlement.source
      : typeof tenantEntitlement.data()?.source === 'string'
        ? String(tenantEntitlement.data()?.source)
        : null,
  };
}

export async function assertTenantResource(uid: string, tenantId: string, workspaceId: string) {
  const context = await resolveTenantForUid(uid, workspaceId);
  if (context.tenantId !== tenantId) {
    const error = new Error('This resource belongs to another workspace.');
    error.name = 'TenantIsolationError';
    throw error;
  }
  return context;
}
