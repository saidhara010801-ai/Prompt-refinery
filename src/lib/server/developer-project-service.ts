import { Timestamp } from 'firebase-admin/firestore';

import { normalizedSearchTerms } from '@/lib/stage2-utils';
import type { PublicApiCaller } from './api-key-service';
import { getAdminFirestore } from './firebase-admin';
import {
  createProjectMemoryDocument,
  projectMemoryAuditDocument,
  updateProjectMemoryDocument,
  type ProjectMemoryKind,
  type ProjectMemoryProvenanceInput,
  type ProjectMemorySource,
} from './project-memory';
import { AuthorizationError } from './user-access';
import {
  addPreparedHybridGraphWrite,
  prepareHybridGraphWrite,
  setHybridGraphNodeActive,
} from './hybrid-memory-service';

function timestampIso(value: unknown): string | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date.toISOString() : null;
  }
  return value instanceof Date ? value.toISOString() : null;
}

function projectDto(id: string, data: Record<string, unknown>) {
  return {
    id,
    name: String(data.name ?? ''),
    description: String(data.description ?? ''),
    status: String(data.status ?? 'active'),
    defaultTechnique: String(data.defaultTechnique ?? 'Zero-shot'),
    defaultGuidelines: Array.isArray(data.defaultGuidelines) ? data.defaultGuidelines.map(String) : [],
    createdAt: timestampIso(data.createdAt),
    updatedAt: timestampIso(data.updatedAt),
    trashedAt: timestampIso(data.trashedAt),
  };
}

function memoryDto(id: string, data: Record<string, unknown>) {
  const provenance = data.provenance && typeof data.provenance === 'object'
    ? data.provenance as Record<string, unknown>
    : {};
  return {
    id,
    projectId: String(data.projectId ?? ''),
    kind: String(data.kind ?? 'note'),
    title: String(data.title ?? ''),
    content: String(data.content ?? ''),
    active: data.active !== false,
    status: String(data.status ?? (data.active === false ? 'inactive' : 'active')),
    tokenEstimate: Number(data.tokenEstimate) || 0,
    sourceRef: typeof data.sourceRef === 'string' ? data.sourceRef : null,
    validFrom: timestampIso(data.validFrom ?? data.createdAt),
    validTo: timestampIso(data.validTo),
    createdAt: timestampIso(data.createdAt),
    updatedAt: timestampIso(data.updatedAt),
    provenance: {
      source: String(provenance.source ?? data.source ?? 'system'),
      agent: typeof provenance.agent === 'string' ? provenance.agent : null,
      requestId: typeof provenance.requestId === 'string' ? provenance.requestId : null,
      userId: String(provenance.userId ?? data.userId ?? data.actorUid ?? ''),
      timestamp: timestampIso(provenance.timestamp ?? data.createdAt),
      consent: String(provenance.consent ?? 'workflow'),
    },
  };
}

function apiSource(request: Request): ProjectMemorySource {
  return request.headers.get('x-clarift-client')?.toLowerCase() === 'mcp' ? 'mcp' : 'api';
}

function provenanceFor(request: Request, caller: PublicApiCaller, requestId: string): ProjectMemoryProvenanceInput {
  const claimedAgent = request.headers.get('x-clarift-agent')?.trim().slice(0, 100);
  return {
    userId: caller.uid,
    source: apiSource(request),
    agent: claimedAgent ? `external:${claimedAgent}` : apiSource(request) === 'mcp' ? 'clarift-mcp' : 'clarift-api',
    requestId,
    consent: 'explicit',
  };
}

function requireWriteConsent(request: Request, consent: boolean | undefined) {
  const headerConsent = request.headers.get('x-clarift-write-consent')?.toLowerCase() === 'true';
  if (consent !== true && !headerConsent) {
    throw new AuthorizationError(
      'Explicit write consent is required. Set consent=true or X-Clarift-Write-Consent: true.',
      409,
      'MemoryWriteConsentRequiredError'
    );
  }
}

async function requireProject(caller: PublicApiCaller, projectId: string, includeTrashed = false) {
  const ref = getAdminFirestore().doc(`projects/${projectId}`);
  const snapshot = await ref.get();
  const data = snapshot.data();
  if (!snapshot.exists || data?.tenantId !== caller.context.tenantId || data?.workspaceId !== caller.context.workspaceId) {
    throw new AuthorizationError('Project not found.', 404, 'ProjectNotFoundError');
  }
  if (!includeTrashed && data?.status === 'trashed') {
    throw new AuthorizationError('Project not found.', 404, 'ProjectNotFoundError');
  }
  return { ref, snapshot, data: data ?? {} };
}

export async function listDeveloperProjects(caller: PublicApiCaller, includeTrashed = false) {
  const snapshot = await getAdminFirestore().collection('projects')
    .where('tenantId', '==', caller.context.tenantId)
    .where('workspaceId', '==', caller.context.workspaceId)
    .orderBy('updatedAt', 'desc')
    .limit(100)
    .get();
  return snapshot.docs
    .filter((document) => includeTrashed || document.data().status !== 'trashed')
    .map((document) => projectDto(document.id, document.data()));
}

export async function createDeveloperProject(caller: PublicApiCaller, input: { name: string; description?: string }) {
  const firestore = getAdminFirestore();
  const ref = firestore.collection('projects').doc();
  const now = Timestamp.now();
  await ref.create({
    userId: caller.uid,
    tenantId: caller.context.tenantId,
    workspaceId: caller.context.workspaceId,
    createdBy: caller.uid,
    name: input.name.trim().slice(0, 120),
    description: input.description?.trim().slice(0, 2000) ?? '',
    templateId: null,
    defaultTechnique: 'Zero-shot',
    defaultGuidelines: [],
    status: 'active',
    trashedAt: null,
    purgeAt: null,
    searchTerms: normalizedSearchTerms(input.name, input.description),
    createdAt: now,
    updatedAt: now,
  });
  return projectDto(ref.id, (await ref.get()).data() ?? {});
}

export async function getDeveloperProject(caller: PublicApiCaller, projectId: string) {
  const project = await requireProject(caller, projectId, true);
  return projectDto(projectId, project.data);
}

export async function updateDeveloperProject(
  caller: PublicApiCaller,
  projectId: string,
  input: { name?: string; description?: string; status?: 'active' | 'trashed' }
) {
  const project = await requireProject(caller, projectId, true);
  const now = Timestamp.now();
  const name = input.name?.trim().slice(0, 120) ?? String(project.data.name ?? '');
  const description = input.description?.trim().slice(0, 2000) ?? String(project.data.description ?? '');
  const next: Record<string, unknown> = {
    name,
    description,
    searchTerms: normalizedSearchTerms(name, description),
    updatedAt: now,
  };
  if (input.status) {
    next.status = input.status;
    next.trashedAt = input.status === 'trashed' ? now : null;
    next.purgeAt = input.status === 'trashed'
      ? Timestamp.fromMillis(now.toMillis() + 30 * 24 * 60 * 60 * 1000)
      : null;
  }
  await project.ref.set(next, { merge: true });
  return projectDto(projectId, (await project.ref.get()).data() ?? {});
}

export async function listDeveloperMemory(
  caller: PublicApiCaller,
  projectId: string,
  options: { activeOnly?: boolean; limit?: number } = {}
) {
  const project = await requireProject(caller, projectId);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const snapshot = await project.ref.collection('memoryEntries').orderBy('createdAt', 'desc').limit(limit).get();
  return snapshot.docs
    .filter((document) => !options.activeOnly || document.data().active !== false)
    .map((document) => memoryDto(document.id, document.data()));
}

export async function searchDeveloperMemory(
  caller: PublicApiCaller,
  input: { query: string; projectId?: string; activeOnly?: boolean; limit?: number }
) {
  if (input.projectId) await requireProject(caller, input.projectId);
  const terms = normalizedSearchTerms(input.query).slice(0, 8);
  if (!terms.length) return [];
  const snapshot = await getAdminFirestore().collectionGroup('memoryEntries')
    .where('tenantId', '==', caller.context.tenantId)
    .where('searchTerms', 'array-contains', terms[0])
    .limit(200)
    .get();
  return snapshot.docs
    .filter((document) => {
      const data = document.data();
      const searchTerms = Array.isArray(data.searchTerms) ? data.searchTerms.map(String) : [];
      return data.workspaceId === caller.context.workspaceId &&
        (!input.projectId || data.projectId === input.projectId) &&
        (!input.activeOnly || data.active !== false) &&
        terms.every((term) => searchTerms.includes(term));
    })
    .slice(0, Math.min(Math.max(input.limit ?? 20, 1), 50))
    .map((document) => memoryDto(document.id, document.data()));
}

export async function createDeveloperMemory(
  request: Request,
  caller: PublicApiCaller,
  projectId: string,
  input: { kind: ProjectMemoryKind; title: string; content: string; sourceRef?: string | null; consent?: boolean }
) {
  requireWriteConsent(request, input.consent);
  const project = await requireProject(caller, projectId);
  const firestore = getAdminFirestore();
  const entryRef = project.ref.collection('memoryEntries').doc();
  const now = Timestamp.now();
  const requestId = request.headers.get('x-request-id')?.trim().slice(0, 200) || `api-${entryRef.id}`;
  const provenance = provenanceFor(request, caller, requestId);
  const memoryDocument = createProjectMemoryDocument({
    projectId,
    ownerUid: caller.uid,
    tenantId: caller.context.tenantId,
    workspaceId: caller.context.workspaceId,
    kind: input.kind,
    title: input.title,
    content: input.content,
    sourceRef: input.sourceRef,
    provenance,
    now,
  });
  const preparedGraph = await prepareHybridGraphWrite({
    projectRef: project.ref,
    projectId,
    projectName: String(project.data.name ?? 'Project'),
    entryId: entryRef.id,
    kind: input.kind,
    title: memoryDocument.title,
    content: memoryDocument.content,
    tokenEstimate: memoryDocument.tokenEstimate,
    tenantId: caller.context.tenantId,
    workspaceId: caller.context.workspaceId,
    provenance,
    now,
  });
  const batch = firestore.batch();
  batch.create(entryRef, memoryDocument);
  if (preparedGraph) addPreparedHybridGraphWrite(batch, preparedGraph);
  batch.create(firestore.collection('projectMemoryAudit').doc(), projectMemoryAuditDocument({
    tenantId: caller.context.tenantId,
    workspaceId: caller.context.workspaceId,
    projectId,
    entryId: entryRef.id,
    action: 'create',
    provenance,
    now,
  }));
  batch.update(project.ref, { updatedAt: now });
  await batch.commit();
  return memoryDto(entryRef.id, (await entryRef.get()).data() ?? {});
}

export async function updateDeveloperMemory(
  request: Request,
  caller: PublicApiCaller,
  projectId: string,
  entryId: string,
  input: { title?: string; content?: string; active?: boolean; consent?: boolean }
) {
  requireWriteConsent(request, input.consent);
  const project = await requireProject(caller, projectId);
  const entryRef = project.ref.collection('memoryEntries').doc(entryId);
  const snapshot = await entryRef.get();
  if (!snapshot.exists) throw new AuthorizationError('Memory entry not found.', 404, 'MemoryEntryNotFoundError');
  const current = snapshot.data() ?? {};
  const now = Timestamp.now();
  const requestId = request.headers.get('x-request-id')?.trim().slice(0, 200) || `api-${entryId}-${now.toMillis()}`;
  const provenance = provenanceFor(request, caller, requestId);
  const active = input.active ?? (current.active !== false);
  const action = input.active === undefined || active === (current.active !== false)
    ? 'update'
    : active ? 'reactivate' : 'deactivate';
  const firestore = getAdminFirestore();
  const memoryUpdates = updateProjectMemoryDocument({
    current,
    title: input.title,
    content: input.content,
    active: input.active,
    provenance,
    now,
  });
  const preparedGraph = await prepareHybridGraphWrite({
    projectRef: project.ref,
    projectId,
    projectName: String(project.data.name ?? 'Project'),
    entryId,
    kind: String(current.kind ?? 'note') as ProjectMemoryKind,
    title: memoryUpdates.title,
    content: memoryUpdates.content,
    tokenEstimate: memoryUpdates.tokenEstimate,
    tenantId: caller.context.tenantId,
    workspaceId: caller.context.workspaceId,
    provenance,
    now,
    createdAt: current.createdAt instanceof Timestamp ? current.createdAt : now,
    active,
  });
  const batch = firestore.batch();
  batch.set(entryRef, memoryUpdates, { merge: true });
  if (preparedGraph) addPreparedHybridGraphWrite(batch, preparedGraph);
  batch.create(firestore.collection('projectMemoryAudit').doc(), projectMemoryAuditDocument({
    tenantId: caller.context.tenantId,
    workspaceId: caller.context.workspaceId,
    projectId,
    entryId,
    action,
    provenance,
    now,
  }));
  batch.update(project.ref, { updatedAt: now });
  await batch.commit();
  return memoryDto(entryId, (await entryRef.get()).data() ?? {});
}

export async function deleteDeveloperMemory(
  request: Request,
  caller: PublicApiCaller,
  projectId: string,
  entryId: string,
  consent?: boolean
) {
  requireWriteConsent(request, consent);
  const project = await requireProject(caller, projectId);
  const entryRef = project.ref.collection('memoryEntries').doc(entryId);
  if (!(await entryRef.get()).exists) throw new AuthorizationError('Memory entry not found.', 404, 'MemoryEntryNotFoundError');
  const firestore = getAdminFirestore();
  const now = Timestamp.now();
  const requestId = request.headers.get('x-request-id')?.trim().slice(0, 200) || `api-${entryId}-${now.toMillis()}`;
  const provenance = provenanceFor(request, caller, requestId);
  const batch = firestore.batch();
  batch.delete(entryRef);
  setHybridGraphNodeActive(batch, project.ref, entryId, false, provenance, now);
  batch.create(firestore.collection('projectMemoryAudit').doc(), projectMemoryAuditDocument({
    tenantId: caller.context.tenantId,
    workspaceId: caller.context.workspaceId,
    projectId,
    entryId,
    action: 'delete',
    provenance,
    now,
  }));
  batch.update(project.ref, { updatedAt: now });
  await batch.commit();
  return { deleted: true, id: entryId };
}
