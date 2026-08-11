import { Timestamp } from 'firebase-admin/firestore';

import { estimateTokenCounts, normalizedSearchTerms } from '@/lib/stage2-utils';
import { getAdminAuth, getAdminFirestore } from './firebase-admin';
import { AuthorizationError, assertActiveAccount, requireUser, type CurrentUserContext } from './user-access';

export type ShareResourceType = 'project' | 'savedPrompt';
export type SharePermission = 'viewer' | 'editor';

function requireSharing(context: CurrentUserContext) {
  if (process.env.ENABLE_PROJECT_SHARING !== 'true') {
    throw new AuthorizationError('Collaboration and sharing are not currently enabled.', 503, 'SharingDisabledError');
  }
  assertActiveAccount(context.profile, 'share Clarift content');
  if (!context.entitlement.isPro) {
    const error = new Error('Collaboration and sharing are available on Pro.');
    error.name = 'ProFeatureRequiredError';
    throw error;
  }
}

function resourcePath(ownerUid: string, resourceType: ShareResourceType, resourceId: string) {
  return resourceType === 'project'
    ? `users/${ownerUid}/projects/${resourceId}`
    : `users/${ownerUid}/savedPrompts/${resourceId}`;
}

function cleanShare(document: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot) {
  const data = document.data() ?? {};
  return {
    id: document.id,
    resourceType: data.resourceType,
    resourceId: data.resourceId,
    resourceName: data.resourceName,
    ownerUid: data.ownerUid,
    ownerEmail: data.ownerEmail,
    recipientUid: data.recipientUid,
    recipientEmail: data.recipientEmail,
    permission: data.permission,
    status: data.status,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export async function createResourceShare(request: Request, input: { resourceType: ShareResourceType; resourceId: string; recipientEmail: string; permission: SharePermission }) {
  const context = await requireUser(request);
  requireSharing(context);
  const recipientEmail = input.recipientEmail.trim().toLowerCase();
  if (!recipientEmail || recipientEmail === context.email) throw new Error('Choose another Clarift account to share with.');

  let recipient;
  try {
    recipient = await getAdminAuth().getUserByEmail(recipientEmail);
  } catch {
    const error = new Error('No Clarift account was found for that email address.');
    error.name = 'ShareRecipientNotFoundError';
    throw error;
  }

  const firestore = getAdminFirestore();
  const resource = await firestore.doc(resourcePath(context.uid, input.resourceType, input.resourceId)).get();
  if (!resource.exists || (input.resourceType === 'project' && resource.data()?.status === 'trashed')) throw new Error('The selected item is unavailable.');

  const shareId = `${input.resourceType}_${context.uid}_${input.resourceId}_${recipient.uid}`;
  const shareRef = firestore.doc(`resourceShares/${shareId}`);
  const now = Timestamp.now();
  await shareRef.set({
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    resourceName: String(resource.data()?.name ?? 'Shared item').slice(0, 160),
    ownerUid: context.uid,
    ownerEmail: context.email,
    recipientUid: recipient.uid,
    recipientEmail,
    permission: input.permission,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }, { merge: true });
  return cleanShare(await shareRef.get());
}

export async function listResourceShares(request: Request, resourceType: ShareResourceType, resourceId: string) {
  const context = await requireUser(request);
  requireSharing(context);
  const snapshot = await getAdminFirestore().collection('resourceShares')
    .where('ownerUid', '==', context.uid)
    .limit(200)
    .get();
  return snapshot.docs
    .filter((document) => document.data().resourceType === resourceType && document.data().resourceId === resourceId && document.data().status === 'active')
    .map(cleanShare);
}

export async function revokeResourceShare(request: Request, shareId: string) {
  const context = await requireUser(request);
  requireSharing(context);
  const shareRef = getAdminFirestore().doc(`resourceShares/${shareId}`);
  const snapshot = await shareRef.get();
  if (!snapshot.exists || snapshot.data()?.ownerUid !== context.uid) throw new Error('This share could not be managed.');
  await shareRef.set({ status: 'revoked', updatedAt: Timestamp.now() }, { merge: true });
  return { revoked: true };
}

export async function listSharedWithMe(request: Request) {
  const context = await requireUser(request);
  requireSharing(context);
  const firestore = getAdminFirestore();
  const snapshot = await firestore.collection('resourceShares')
    .where('recipientUid', '==', context.uid)
    .limit(100)
    .get();

  const items = await Promise.all(snapshot.docs.filter((document) => document.data().status === 'active').map(async (document) => {
    const share = cleanShare(document);
    const resource = await firestore.doc(resourcePath(share.ownerUid, share.resourceType, share.resourceId)).get();
    if (!resource.exists || resource.data()?.status === 'trashed') return null;
    const data = resource.data() ?? {};
    if (share.resourceType === 'savedPrompt') {
      return { ...share, resource: { name: data.name, originalPrompt: data.originalPrompt, refinedPrompt: data.refinedPrompt, promptType: data.promptType } };
    }
    const memory = await resource.ref.collection('memoryEntries').orderBy('createdAt', 'desc').limit(50).get();
    return {
      ...share,
      resource: { name: data.name, description: data.description, memoryEntries: memory.docs.map((entry) => ({ id: entry.id, ...entry.data() })) },
    };
  }));
  return items.filter(Boolean);
}

export async function updateSharedContent(request: Request, shareId: string, input: { originalPrompt?: string; refinedPrompt?: string; title?: string; content?: string }) {
  const context = await requireUser(request);
  requireSharing(context);
  const firestore = getAdminFirestore();
  const share = await firestore.doc(`resourceShares/${shareId}`).get();
  const shareData = share.data();
  if (!share.exists || shareData?.status !== 'active' || shareData.recipientUid !== context.uid || shareData.permission !== 'editor') {
    const error = new Error('Editor access is required.');
    error.name = 'ShareEditorRequiredError';
    throw error;
  }

  if (shareData.resourceType === 'savedPrompt') {
    const originalPrompt = input.originalPrompt?.trim().slice(0, 60000);
    const refinedPrompt = input.refinedPrompt?.trim().slice(0, 60000);
    if (!originalPrompt && !refinedPrompt) throw new Error('Add prompt content before saving.');
    await firestore.doc(resourcePath(shareData.ownerUid, 'savedPrompt', shareData.resourceId)).set({
      ...(originalPrompt ? { originalPrompt } : {}),
      ...(refinedPrompt ? { refinedPrompt } : {}),
      updatedAt: Timestamp.now(),
    }, { merge: true });
    return { updated: true };
  }

  const title = input.title?.trim().slice(0, 160) || 'Collaborator note';
  const content = input.content?.trim().slice(0, 100000);
  if (!content) throw new Error('Add a memory note before saving.');
  const projectRef = firestore.doc(resourcePath(shareData.ownerUid, 'project', shareData.resourceId));
  const entryRef = projectRef.collection('memoryEntries').doc();
  const now = Timestamp.now();
  const batch = firestore.batch();
  batch.create(entryRef, {
    projectId: shareData.resourceId,
    ownerUid: shareData.ownerUid,
    actorUid: context.uid,
    kind: 'note',
    title,
    content,
    active: true,
    tokenEstimate: estimateTokenCounts(content).gemini,
    sourceRef: `share:${shareId}`,
    searchTerms: normalizedSearchTerms(title, content),
    createdAt: now,
    updatedAt: now,
  });
  batch.set(projectRef, { updatedAt: now }, { merge: true });
  await batch.commit();
  return { id: entryRef.id };
}
