import { Timestamp } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

import type { PromptTechnique } from '@/lib/constants';
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

  if (!snapshot.exists) {
    const savedPromptsSnapshot = await firestore.collection(`users/${decodedToken.uid}/savedPrompts`).get();
    await userRef.set({
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

  return userRef;
}

export async function getVerifiedUserProfile(firebaseIdToken?: string) {
  const decodedToken = await verifyUser(firebaseIdToken);
  const userRef = await ensureUserProfile(decodedToken);
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
  if (!entitlement.isPro) {
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
  const savedPromptRef = firestore.collection(`users/${decodedToken.uid}/savedPrompts`).doc();

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
      userId: decodedToken.uid,
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
  const savedPromptRef = firestore.doc(`users/${decodedToken.uid}/savedPrompts/${promptId}`);

  await firestore.runTransaction(async (transaction) => {
    const [userSnapshot, promptSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(savedPromptRef),
    ]);

    if (!promptSnapshot.exists) {
      return;
    }

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

  const firestore = getAdminFirestore();
  await firestore.recursiveDelete(firestore.doc(`users/${decodedToken.uid}/projects/${projectId}`));
}

export async function createProjectForUser(
  firebaseIdToken: string | undefined,
  project: { name: string; description: string }
) {
  const { decodedToken, profile } = await getVerifiedUserProfile(firebaseIdToken);
  assertActiveAccount(profile, 'create projects');
  await assertProEntitlement(decodedToken.uid, 'Projects and memory are available on Pro. Upgrade to create a project.');

  const firestore = getAdminFirestore();
  const projectRef = firestore.collection(`users/${decodedToken.uid}/projects`).doc();
  const now = Timestamp.now();
  await projectRef.create({
    userId: decodedToken.uid,
    name: project.name,
    description: project.description,
    createdAt: now,
    updatedAt: now,
  });

  return { id: projectRef.id };
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
  const projectRef = firestore.doc(`users/${decodedToken.uid}/projects/${projectId}`);
  const projectSnapshot = await projectRef.get();
  if (!projectSnapshot.exists) {
    throw new Error('The selected project no longer exists.');
  }

  const sessionRef = projectRef.collection('projectSessions').doc();
  const now = Timestamp.now();
  const batch = firestore.batch();
  batch.create(sessionRef, {
    ...session,
    projectId,
    timestamp: now,
  });
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
  const projectRef = firestore.doc(`users/${decodedToken.uid}/projects/${projectId}`);
  const sessionRef = projectRef.collection('projectSessions').doc(sessionId);
  const sessionSnapshot = await sessionRef.get();
  if (!sessionSnapshot.exists) {
    throw new Error('The selected project session no longer exists.');
  }

  const batch = firestore.batch();
  batch.update(sessionRef, { llmResponse });
  batch.update(projectRef, { updatedAt: Timestamp.now() });
  await batch.commit();
}
