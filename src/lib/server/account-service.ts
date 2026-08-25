import { Timestamp } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

import type { PromptTechnique } from '@/lib/constants';
import { PROJECT_TEMPLATES } from '@/lib/constants';
import { estimateTokenCounts, normalizedSearchTerms } from '@/lib/stage2-utils';
import {
  FREE_MANAGED_REFINEMENT_DAILY_LIMIT,
  FREE_SAVED_PROMPT_LIMIT,
  isFreeTechnique,
  type SubscriptionTier,
} from '@/lib/subscription';
import { getAdminFirestore } from './firebase-admin';
import {
  assertActiveAccount,
  getEffectiveUserEntitlement,
  normalizeUserProfile,
  verifyFirebaseIdToken,
  type AccountStatus,
  type NormalizedUserProfile,
  type SubscriptionSource,
} from './user-access';
import { ensurePersonalTenant } from './tenant-service';
import { migrateUserTenantData } from './tenant-migration';
import { registerNewUserSignup, retryPendingSignupNotification } from './signup-notification-service';
import {
  createProjectMemoryDocument,
  projectMemoryAuditDocument,
  updateProjectMemoryDocument,
} from './project-memory';

interface UserProfile {
  subscriptionTier?: SubscriptionTier;
  subscriptionSource?: SubscriptionSource;
  accountStatus?: AccountStatus;
  role?: string;
  savedPromptCount?: number;
  managedRefinementsDate?: string;
  managedRefinementsUsedToday?: number;
}

interface SavedPromptInput {
  name: string;
  originalPrompt: string;
  refinedPrompt: string;
  promptType: string;
  latestVersion: number;
  versionCount: number;
  versions: Array<{
    version: number;
    rawPrompt: string;
    refinedPrompt: string;
    promptType: string;
    createdAt: string;
  }>;
  folder?: string | null;
  tags?: string[];
}

interface ProjectSessionInput {
  rawPrompt: string;
  refinedPrompt: string;
  promptType: string;
  version: number;
  versions: Array<{
    version: number;
    rawPrompt: string;
    refinedPrompt: string;
    promptType: string;
    createdAt: string;
  }>;
}

export class TierEnforcementError extends Error {
  constructor(message: string, name = 'ProFeatureRequiredError') {
    super(message);
    this.name = name;
  }
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function verifyUser(firebaseIdToken?: string): Promise<DecodedIdToken> {
  try {
    return await verifyFirebaseIdToken(firebaseIdToken);
  } catch (error) {
    throw new TierEnforcementError(
      error instanceof Error ? error.message : 'Your sign-in session could not be verified. Sign in again and retry.',
      'AuthenticationRequiredError'
    );
  }
}

async function ensureUserProfile(decodedToken: DecodedIdToken) {
  const firestore = getAdminFirestore();
  const userRef = firestore.doc(`users/${decodedToken.uid}`);
  const snapshot = await userRef.get();
  let createdProfile = false;

  if (!snapshot.exists) {
    const savedPromptsSnapshot = await firestore.collection(`users/${decodedToken.uid}/savedPrompts`).get();
    await firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(userRef);
      if (current.exists) return;
      transaction.create(userRef, {
        id: decodedToken.uid,
        email: decodedToken.email ?? '',
        name: decodedToken.name ?? '',
        role: 'user',
        subscriptionTier: 'free',
        subscriptionSource: null,
        accountStatus: 'active',
        savedPromptCount: savedPromptsSnapshot.size,
        managedRefinementsDate: todayUtc(),
        managedRefinementsUsedToday: 0,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      createdProfile = true;
    });
  } else {
    const profile = (snapshot.data() ?? {}) as UserProfile;
    const missingSavedPromptCount = profile.savedPromptCount === undefined;
    const savedPromptsSnapshot = missingSavedPromptCount
      ? await firestore.collection(`users/${decodedToken.uid}/savedPrompts`).get()
      : null;

    await userRef.set({
      subscriptionTier: profile.subscriptionTier ?? 'free',
      subscriptionSource: profile.subscriptionSource ?? null,
      accountStatus: profile.accountStatus ?? 'active',
      role: profile.role ?? 'user',
      savedPromptCount: savedPromptsSnapshot?.size ?? profile.savedPromptCount ?? 0,
      managedRefinementsDate: profile.managedRefinementsDate ?? todayUtc(),
      managedRefinementsUsedToday: profile.managedRefinementsUsedToday ?? 0,
      updatedAt: Timestamp.now(),
    }, { merge: true });
  }

  try {
    if (createdProfile) await registerNewUserSignup(decodedToken);
    else await retryPendingSignupNotification(decodedToken.uid);
  } catch {
    // Account creation and sign-in must remain available if notification delivery is unavailable.
  }

  return userRef;
}

export async function getVerifiedUserProfile(firebaseIdToken?: string) {
  const decodedToken = await verifyUser(firebaseIdToken);
  const userRef = await ensureUserProfile(decodedToken);
  await ensurePersonalTenant(decodedToken.uid);
  await migrateUserTenantData(decodedToken.uid);
  const snapshot = await userRef.get();
  const profile = normalizeUserProfile(decodedToken.uid, snapshot.data() as Record<string, unknown> | undefined);
  return {
    decodedToken,
    userRef,
    profile,
  };
}

async function assertProEntitlement(uid: string, message: string) {
  const entitlement = await getEffectiveUserEntitlement(uid);
  const context = await ensurePersonalTenant(uid);
  const tenantEntitlement = await getAdminFirestore().doc(`tenantEntitlements/${context.tenantId}`).get();
  const hasTenantIndividual = tenantEntitlement.data()?.plan === 'individual' &&
    ['active', 'authenticated'].includes(String(tenantEntitlement.data()?.status || ''));
  if (!entitlement.isPro && !hasTenantIndividual) {
    throw new TierEnforcementError(message);
  }
}

export function assertCanCreateCheckoutForProfile(profile: Pick<NormalizedUserProfile, 'accountStatus'>) {
  assertActiveAccount(profile, 'create checkout sessions');
}

export async function assertActiveAccountForCheckout(uid: string) {
  const firestore = getAdminFirestore();
  const snapshot = await firestore.doc(`users/${uid}`).get();
  const profile = normalizeUserProfile(uid, snapshot.data() as Record<string, unknown> | undefined);
  assertCanCreateCheckoutForProfile(profile);
  return profile;
}

export async function assertRefinementAccess(
  firebaseIdToken: string | undefined,
  technique: PromptTechnique,
  usesProjectMemory: boolean
) {
  const { decodedToken, profile } = await getVerifiedUserProfile(firebaseIdToken);
  assertActiveAccount(profile, 'call provider APIs');

  if (isFreeTechnique(technique) && !usesProjectMemory) {
    return;
  }

  await assertProEntitlement(
    decodedToken.uid,
    usesProjectMemory
      ? 'Projects and memory are available on Pro. Upgrade to refine with project context.'
      : `${technique} is a Pro refinement technique. Upgrade to unlock all eight techniques.`
  );
}

export async function assertProFeatureAccess(firebaseIdToken: string | undefined, message: string) {
  const { decodedToken, profile } = await getVerifiedUserProfile(firebaseIdToken);
  assertActiveAccount(profile, 'use Pro features');
  await assertProEntitlement(decodedToken.uid, message);
}

export async function reserveManagedRefinement(firebaseIdToken?: string) {
  const { decodedToken, userRef } = await getVerifiedUserProfile(firebaseIdToken);
  const firestore = getAdminFirestore();
  const usageDate = todayUtc();

  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    const profile = normalizeUserProfile(decodedToken.uid, snapshot.data() as Record<string, unknown> | undefined);
    assertActiveAccount(profile, 'use managed provider APIs');
    const usedToday = profile.managedRefinementsDate === usageDate
      ? profile.managedRefinementsUsedToday ?? 0
      : 0;
    const entitlement = await getEffectiveUserEntitlement(decodedToken.uid);

    if (!entitlement.isPro && usedToday >= FREE_MANAGED_REFINEMENT_DAILY_LIMIT) {
      throw new TierEnforcementError(
        `Free managed refinements are limited to ${FREE_MANAGED_REFINEMENT_DAILY_LIMIT} per day. Add your own API key or upgrade to Pro.`,
        'ManagedRateLimitError'
      );
    }

    transaction.set(userRef, {
      managedRefinementsDate: usageDate,
      managedRefinementsUsedToday: usedToday + 1,
      updatedAt: Timestamp.now(),
    }, { merge: true });
  });

  return { uid: decodedToken.uid, usageDate };
}

export async function releaseManagedRefinement(uid: string, usageDate: string) {
  const firestore = getAdminFirestore();
  const userRef = firestore.doc(`users/${uid}`);

  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    const profile = normalizeUserProfile(uid, snapshot.data() as Record<string, unknown> | undefined);
    if (profile.managedRefinementsDate !== usageDate) {
      return;
    }

    transaction.set(userRef, {
      managedRefinementsUsedToday: Math.max((profile.managedRefinementsUsedToday ?? 1) - 1, 0),
      updatedAt: Timestamp.now(),
    }, { merge: true });
  });
}

export async function savePromptForUser(firebaseIdToken: string | undefined, prompt: SavedPromptInput) {
  const { decodedToken, userRef } = await getVerifiedUserProfile(firebaseIdToken);
  const firestore = getAdminFirestore();
  const tenant = await ensurePersonalTenant(decodedToken.uid);
  const savedPromptRef = firestore.collection('savedPrompts').doc();

  await firestore.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userRef);
    const profile = normalizeUserProfile(decodedToken.uid, userSnapshot.data() as Record<string, unknown> | undefined);
    assertActiveAccount(profile, 'save prompts');
    const savedPromptCount = profile.savedPromptCount ?? 0;
    const entitlement = await getEffectiveUserEntitlement(decodedToken.uid);

    if (!entitlement.isPro && savedPromptCount >= FREE_SAVED_PROMPT_LIMIT) {
      throw new TierEnforcementError(
        `Free accounts can save up to ${FREE_SAVED_PROMPT_LIMIT} prompts. Delete an older prompt or upgrade to Pro.`,
        'SavedPromptLimitError'
      );
    }

    transaction.create(savedPromptRef, {
      ...prompt,
      folder: prompt.folder?.slice(0, 80) || null,
      tags: (prompt.tags ?? []).slice(0, 10),
      searchTerms: normalizedSearchTerms(prompt.name, prompt.originalPrompt, prompt.refinedPrompt, prompt.folder, ...(prompt.tags ?? [])),
      userId: decodedToken.uid,
      tenantId: tenant.tenantId,
      workspaceId: tenant.workspaceId,
      createdBy: decodedToken.uid,
      creationTimestamp: Timestamp.now(),
      saveTimestamp: Timestamp.now(),
    });
    transaction.set(userRef, {
      savedPromptCount: savedPromptCount + 1,
      updatedAt: Timestamp.now(),
    }, { merge: true });
  });

  return { id: savedPromptRef.id };
}

export async function deleteSavedPromptForUser(firebaseIdToken: string | undefined, promptId: string) {
  const { decodedToken, userRef } = await getVerifiedUserProfile(firebaseIdToken);
  const firestore = getAdminFirestore();
  const tenant = await ensurePersonalTenant(decodedToken.uid);
  const savedPromptRef = firestore.doc(`savedPrompts/${promptId}`);

  await firestore.runTransaction(async (transaction) => {
    const [userSnapshot, promptSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(savedPromptRef),
    ]);

    if (!promptSnapshot.exists) {
      return;
    }
    if (promptSnapshot.data()?.tenantId !== tenant.tenantId) throw new Error('The saved prompt is unavailable.');

    const profile = normalizeUserProfile(decodedToken.uid, userSnapshot.data() as Record<string, unknown> | undefined);
    assertActiveAccount(profile, 'delete saved prompts');
    transaction.delete(savedPromptRef);
    transaction.set(userRef, {
      savedPromptCount: Math.max((profile.savedPromptCount ?? 1) - 1, 0),
      updatedAt: Timestamp.now(),
    }, { merge: true });
  });
}

export async function deleteProjectForUser(firebaseIdToken: string | undefined, projectId: string) {
  const { decodedToken, profile } = await getVerifiedUserProfile(firebaseIdToken);
  assertActiveAccount(profile, 'manage project context');
  await assertProEntitlement(decodedToken.uid, 'Projects and memory are available on Pro. Upgrade to manage project context.');

  const purgeAt = new Date();
  purgeAt.setUTCDate(purgeAt.getUTCDate() + 30);
  const tenant = await ensurePersonalTenant(decodedToken.uid);
  const ref = getAdminFirestore().doc(`projects/${projectId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.tenantId !== tenant.tenantId) throw new Error('The selected project is unavailable.');
  await ref.set({
    status: 'trashed',
    trashedAt: Timestamp.now(),
    purgeAt: Timestamp.fromDate(purgeAt),
    updatedAt: Timestamp.now(),
  }, { merge: true });
}

export async function updateSavedPromptMetadataForUser(
  firebaseIdToken: string | undefined,
  promptId: string,
  metadata: { name: string; folder?: string | null; tags: string[] }
) {
  const { decodedToken, profile } = await getVerifiedUserProfile(firebaseIdToken);
  assertActiveAccount(profile, 'organize saved prompts');
  const tenant = await ensurePersonalTenant(decodedToken.uid);
  const ref = getAdminFirestore().doc(`savedPrompts/${promptId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.tenantId !== tenant.tenantId) throw new Error('The saved prompt no longer exists.');
  const data = snapshot.data() ?? {};
  const name = metadata.name.trim().slice(0, 160);
  const folder = metadata.folder?.trim().slice(0, 80) || null;
  const tags = Array.from(new Set(metadata.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))).slice(0, 10);
  await ref.set({
    name,
    folder,
    tags,
    searchTerms: normalizedSearchTerms(name, String(data.originalPrompt ?? ''), String(data.refinedPrompt ?? ''), folder, ...tags),
    updatedAt: Timestamp.now(),
  }, { merge: true });
}

export async function saveEvaluationRunForUser(
  firebaseIdToken: string | undefined,
  input: {
    prompt: string;
    guidelines: string[];
    combinedScore: number;
    results: unknown[];
  }
) {
  const { decodedToken, profile } = await getVerifiedUserProfile(firebaseIdToken);
  assertActiveAccount(profile, 'save evaluation history');
  const tenant = await ensurePersonalTenant(decodedToken.uid);
  const ref = getAdminFirestore().collection('evaluations').doc();
  await ref.create({
    ...input,
    userId: decodedToken.uid,
    tenantId: tenant.tenantId,
    workspaceId: tenant.workspaceId,
    createdBy: decodedToken.uid,
    promptFingerprint: normalizedSearchTerms(input.prompt).slice(0, 20).join('-'),
    createdAt: Timestamp.now(),
  });
  return { id: ref.id };
}

export async function restoreProjectForUser(firebaseIdToken: string | undefined, projectId: string) {
  const { decodedToken, profile } = await getVerifiedUserProfile(firebaseIdToken);
  assertActiveAccount(profile, 'restore projects');
  await assertProEntitlement(decodedToken.uid, 'Projects and memory are available on Pro.');
  const tenant = await ensurePersonalTenant(decodedToken.uid);
  const ref = getAdminFirestore().doc(`projects/${projectId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.tenantId !== tenant.tenantId) throw new Error('The selected project is unavailable.');
  await ref.set({
    status: 'active',
    trashedAt: null,
    purgeAt: null,
    updatedAt: Timestamp.now(),
  }, { merge: true });
}

export async function permanentlyDeleteProjectForUser(firebaseIdToken: string | undefined, projectId: string) {
  const { decodedToken, profile } = await getVerifiedUserProfile(firebaseIdToken);
  assertActiveAccount(profile, 'permanently delete projects');
  await assertProEntitlement(decodedToken.uid, 'Projects and memory are available on Pro.');
  const firestore = getAdminFirestore();
  const tenant = await ensurePersonalTenant(decodedToken.uid);
  const projectRef = firestore.doc(`projects/${projectId}`);
  const snapshot = await projectRef.get();
  if (!snapshot.exists || snapshot.data()?.tenantId !== tenant.tenantId || snapshot.data()?.status !== 'trashed') {
    throw new Error('Move the project to Trash before deleting it permanently.');
  }
  await firestore.recursiveDelete(projectRef);
}

export async function createProjectForUser(
  firebaseIdToken: string | undefined,
  project: { name: string; description: string; templateId?: string | null }
) {
  const { decodedToken, profile } = await getVerifiedUserProfile(firebaseIdToken);
  assertActiveAccount(profile, 'create projects');
  await assertProEntitlement(decodedToken.uid, 'Projects and memory are available on Pro. Upgrade to create a project.');

  const firestore = getAdminFirestore();
  const tenant = await ensurePersonalTenant(decodedToken.uid);
  const projectRef = firestore.collection('projects').doc();
  const now = Timestamp.now();
  const template = PROJECT_TEMPLATES.find((candidate) => candidate.id === project.templateId);
  await projectRef.create({
    userId: decodedToken.uid,
    tenantId: tenant.tenantId,
    workspaceId: tenant.workspaceId,
    createdBy: decodedToken.uid,
    name: project.name,
    description: project.description,
    templateId: template?.id ?? null,
    defaultTechnique: template?.promptType ?? 'Zero-shot',
    defaultGuidelines: template?.guidelines ?? [],
    status: 'active',
    trashedAt: null,
    purgeAt: null,
    searchTerms: normalizedSearchTerms(project.name, project.description),
    createdAt: now,
    updatedAt: now,
  });

  return {
    id: projectRef.id,
    defaultTechnique: template?.promptType ?? 'Zero-shot',
    defaultGuidelines: template?.guidelines ?? [],
  };
}

export async function createProjectMemoryEntryForUser(
  firebaseIdToken: string | undefined,
  projectId: string,
  entry: {
    kind: 'refinement' | 'response' | 'converter' | 'note' | 'evaluation';
    title: string;
    content: string;
    sourceRef?: string | null;
  }
) {
  const { decodedToken, profile } = await getVerifiedUserProfile(firebaseIdToken);
  assertActiveAccount(profile, 'update project memory');
  await assertProEntitlement(decodedToken.uid, 'Projects and memory are available on Pro.');
  const firestore = getAdminFirestore();
  const tenant = await ensurePersonalTenant(decodedToken.uid);
  const projectRef = firestore.doc(`projects/${projectId}`);
  const projectSnapshot = await projectRef.get();
  if (!projectSnapshot.exists || projectSnapshot.data()?.tenantId !== tenant.tenantId || projectSnapshot.data()?.status === 'trashed') {
    throw new Error('The selected project is unavailable.');
  }

  const entryRef = projectRef.collection('memoryEntries').doc();
  const now = Timestamp.now();
  const content = entry.content.slice(0, 100000);
  const provenance = {
    userId: decodedToken.uid,
    source: 'web' as const,
    agent: 'clarift-web',
    consent: 'explicit' as const,
  };
  const batch = firestore.batch();
  batch.create(entryRef, createProjectMemoryDocument({
    projectId,
    ownerUid: decodedToken.uid,
    tenantId: tenant.tenantId,
    workspaceId: tenant.workspaceId,
    kind: entry.kind,
    title: entry.title,
    content,
    sourceRef: entry.sourceRef,
    provenance,
    now,
  }));
  batch.create(firestore.collection('projectMemoryAudit').doc(), projectMemoryAuditDocument({
    tenantId: tenant.tenantId,
    workspaceId: tenant.workspaceId,
    projectId,
    entryId: entryRef.id,
    action: 'create',
    provenance,
    now,
  }));
  batch.update(projectRef, { updatedAt: now });
  await batch.commit();
  return { id: entryRef.id };
}

export async function updateProjectMemoryEntryForUser(
  firebaseIdToken: string | undefined,
  projectId: string,
  entryId: string,
  updates: { title?: string; content?: string; active?: boolean }
) {
  const { decodedToken, profile } = await getVerifiedUserProfile(firebaseIdToken);
  assertActiveAccount(profile, 'edit project memory');
  await assertProEntitlement(decodedToken.uid, 'Projects and memory are available on Pro.');
  const firestore = getAdminFirestore();
  const tenant = await ensurePersonalTenant(decodedToken.uid);
  const projectRef = firestore.doc(`projects/${projectId}`);
  const projectSnapshot = await projectRef.get();
  if (!projectSnapshot.exists || projectSnapshot.data()?.tenantId !== tenant.tenantId) throw new Error('The selected project is unavailable.');
  const entryRef = projectRef.collection('memoryEntries').doc(entryId);
  const snapshot = await entryRef.get();
  if (!snapshot.exists) throw new Error('The selected memory entry no longer exists.');
  const current = snapshot.data() ?? {};
  const now = Timestamp.now();
  const provenance = {
    userId: decodedToken.uid,
    source: 'web' as const,
    agent: 'clarift-web',
    consent: 'explicit' as const,
  };
  const nextActive = updates.active ?? (current.active !== false);
  const action = updates.active === undefined || nextActive === (current.active !== false)
    ? 'update'
    : nextActive ? 'reactivate' : 'deactivate';
  const batch = firestore.batch();
  batch.set(entryRef, updateProjectMemoryDocument({
    current,
    title: updates.title,
    content: updates.content,
    active: updates.active,
    provenance,
    now,
  }), { merge: true });
  batch.create(firestore.collection('projectMemoryAudit').doc(), projectMemoryAuditDocument({
    tenantId: tenant.tenantId,
    workspaceId: tenant.workspaceId,
    projectId,
    entryId,
    action,
    provenance,
    now,
  }));
  batch.update(projectRef, { updatedAt: now });
  await batch.commit();
}

export async function deleteProjectMemoryEntryForUser(
  firebaseIdToken: string | undefined,
  projectId: string,
  entryId: string
) {
  const { decodedToken, profile } = await getVerifiedUserProfile(firebaseIdToken);
  assertActiveAccount(profile, 'delete project memory');
  await assertProEntitlement(decodedToken.uid, 'Projects and memory are available on Pro.');
  const tenant = await ensurePersonalTenant(decodedToken.uid);
  const projectRef = getAdminFirestore().doc(`projects/${projectId}`);
  const project = await projectRef.get();
  if (!project.exists || project.data()?.tenantId !== tenant.tenantId) throw new Error('The selected project is unavailable.');
  const firestore = getAdminFirestore();
  const entryRef = projectRef.collection('memoryEntries').doc(entryId);
  const entry = await entryRef.get();
  if (!entry.exists) return;
  const now = Timestamp.now();
  const provenance = {
    userId: decodedToken.uid,
    source: 'web' as const,
    agent: 'clarift-web',
    consent: 'explicit' as const,
  };
  const batch = firestore.batch();
  batch.delete(entryRef);
  batch.create(firestore.collection('projectMemoryAudit').doc(), projectMemoryAuditDocument({
    tenantId: tenant.tenantId,
    workspaceId: tenant.workspaceId,
    projectId,
    entryId,
    action: 'delete',
    provenance,
    now,
  }));
  batch.update(projectRef, { updatedAt: now });
  await batch.commit();
}

export async function searchProjectMemoryForUser(firebaseIdToken: string | undefined, search: string) {
  const { decodedToken, profile } = await getVerifiedUserProfile(firebaseIdToken);
  assertActiveAccount(profile, 'search project memory');
  await assertProEntitlement(decodedToken.uid, 'Cross-project search is available on Pro.');
  const tenant = await ensurePersonalTenant(decodedToken.uid);
  const terms = normalizedSearchTerms(search).slice(0, 8);
  if (terms.length === 0) return [];
  const snapshot = await getAdminFirestore()
    .collectionGroup('memoryEntries')
    .where('tenantId', '==', tenant.tenantId)
    .where('searchTerms', 'array-contains', terms[0])
    .limit(100)
    .get();
  type SearchableMemoryEntry = {
    id: string;
    projectId?: unknown;
    title?: unknown;
    kind?: unknown;
    content?: unknown;
    searchTerms?: unknown;
    active?: unknown;
  };
  return snapshot.docs
    .map((document): SearchableMemoryEntry => ({
      ...(document.data() as Omit<SearchableMemoryEntry, 'id'>),
      id: document.id,
    }))
    .filter((entry) => {
      const searchTerms = Array.isArray(entry.searchTerms) ? entry.searchTerms.map(String) : [];
      return entry.active !== false && terms.every((term) => searchTerms.includes(term));
    })
    .slice(0, 50)
    .map((entry) => ({
      id: String(entry.id),
      projectId: String(entry.projectId ?? ''),
      title: String(entry.title ?? 'Memory entry'),
      kind: String(entry.kind ?? 'note'),
      snippet: String(entry.content ?? '').slice(0, 240),
    }));
}

export async function addProjectSessionForUser(
  firebaseIdToken: string | undefined,
  projectId: string,
  session: ProjectSessionInput
) {
  const { decodedToken, profile } = await getVerifiedUserProfile(firebaseIdToken);
  assertActiveAccount(profile, 'store project sessions');
  await assertProEntitlement(decodedToken.uid, 'Projects and memory are available on Pro. Upgrade to store project sessions.');

  const firestore = getAdminFirestore();
  const tenant = await ensurePersonalTenant(decodedToken.uid);
  const projectRef = firestore.doc(`projects/${projectId}`);
  const projectSnapshot = await projectRef.get();
  if (!projectSnapshot.exists || projectSnapshot.data()?.tenantId !== tenant.tenantId) {
    throw new Error('The selected project no longer exists.');
  }

  const sessionRef = projectRef.collection('projectSessions').doc();
  const memoryRef = projectRef.collection('memoryEntries').doc();
  const now = Timestamp.now();
  const provenance = {
    userId: decodedToken.uid,
    source: 'web' as const,
    agent: 'clarift-web',
    requestId: sessionRef.id,
    consent: 'workflow' as const,
  };
  const batch = firestore.batch();
  batch.create(sessionRef, {
    ...session,
    projectId,
    tenantId: tenant.tenantId,
    workspaceId: tenant.workspaceId,
    createdBy: decodedToken.uid,
    timestamp: now,
  });
  batch.create(memoryRef, createProjectMemoryDocument({
    projectId,
    ownerUid: decodedToken.uid,
    tenantId: tenant.tenantId,
    workspaceId: tenant.workspaceId,
    kind: 'refinement',
    title: session.rawPrompt.slice(0, 160),
    content: `Raw prompt:\n${session.rawPrompt}\n\nRefined prompt:\n${session.refinedPrompt}`.slice(0, 100000),
    sourceRef: sessionRef.id,
    provenance,
    now,
  }));
  batch.create(firestore.collection('projectMemoryAudit').doc(), projectMemoryAuditDocument({
    tenantId: tenant.tenantId,
    workspaceId: tenant.workspaceId,
    projectId,
    entryId: memoryRef.id,
    action: 'create',
    provenance,
    now,
  }));
  batch.update(projectRef, { updatedAt: now });
  await batch.commit();

  return { id: sessionRef.id };
}

export async function updateProjectSessionResponseForUser(
  firebaseIdToken: string | undefined,
  projectId: string,
  sessionId: string,
  llmResponse: string
) {
  const { decodedToken, profile } = await getVerifiedUserProfile(firebaseIdToken);
  assertActiveAccount(profile, 'update project memory');
  await assertProEntitlement(decodedToken.uid, 'Projects and memory are available on Pro. Upgrade to update project memory.');

  const firestore = getAdminFirestore();
  const tenant = await ensurePersonalTenant(decodedToken.uid);
  const projectRef = firestore.doc(`projects/${projectId}`);
  const projectSnapshot = await projectRef.get();
  if (!projectSnapshot.exists || projectSnapshot.data()?.tenantId !== tenant.tenantId) throw new Error('The selected project is unavailable.');
  const sessionRef = projectRef.collection('projectSessions').doc(sessionId);
  const sessionSnapshot = await sessionRef.get();
  if (!sessionSnapshot.exists) {
    throw new Error('The selected project session no longer exists.');
  }

  const memoryRef = projectRef.collection('memoryEntries').doc(`response-${sessionId}`);
  const memorySnapshot = await memoryRef.get();
  const batch = firestore.batch();
  const now = Timestamp.now();
  batch.update(sessionRef, { llmResponse, updatedAt: now });
  const provenance = {
    userId: decodedToken.uid,
    source: 'web' as const,
    agent: 'clarift-web',
    requestId: sessionId,
    consent: 'workflow' as const,
  };
  if (memorySnapshot.exists) {
    batch.set(memoryRef, updateProjectMemoryDocument({
      current: memorySnapshot.data() ?? {},
      title: 'Response note',
      content: llmResponse,
      active: true,
      provenance,
      now,
    }), { merge: true });
  } else {
    batch.create(memoryRef, createProjectMemoryDocument({
      projectId,
      ownerUid: decodedToken.uid,
      tenantId: tenant.tenantId,
      workspaceId: tenant.workspaceId,
      kind: 'response',
      title: 'Response note',
      content: llmResponse,
      sourceRef: sessionId,
      provenance,
      now,
    }));
  }
  batch.create(firestore.collection('projectMemoryAudit').doc(), projectMemoryAuditDocument({
    tenantId: tenant.tenantId,
    workspaceId: tenant.workspaceId,
    projectId,
    entryId: memoryRef.id,
    action: memorySnapshot.exists ? 'update' : 'create',
    provenance,
    now,
  }));
  batch.update(projectRef, { updatedAt: now });
  await batch.commit();
}
