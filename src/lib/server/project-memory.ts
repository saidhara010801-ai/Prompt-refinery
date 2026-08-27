import { Timestamp } from 'firebase-admin/firestore';

import { MAX_PROJECT_MEMORY_ENTRY_CHARACTERS } from '@/lib/input-limits';
import { estimateTokenCounts, normalizedSearchTerms } from '@/lib/stage2-utils';

export const PROJECT_MEMORY_KINDS = [
  'refinement',
  'response',
  'converter',
  'note',
  'evaluation',
] as const;

export type ProjectMemoryKind = typeof PROJECT_MEMORY_KINDS[number];
export type ProjectMemorySource = 'web' | 'api' | 'mcp' | 'system' | 'migration';
export type ProjectMemoryConsent = 'explicit' | 'workflow' | 'project-policy' | 'system';

export interface ProjectMemoryProvenanceInput {
  userId: string;
  source: ProjectMemorySource;
  agent?: string | null;
  requestId?: string | null;
  consent: ProjectMemoryConsent;
}

function boundedLabel(value: string | null | undefined, limit: number) {
  return value?.trim().slice(0, limit) || null;
}

export function projectMemoryProvenance(
  input: ProjectMemoryProvenanceInput,
  timestamp: Timestamp = Timestamp.now()
) {
  return {
    source: input.source,
    agent: boundedLabel(input.agent, 120),
    timestamp,
    requestId: boundedLabel(input.requestId, 200),
    userId: input.userId,
    consent: input.consent,
  };
}

export function createProjectMemoryDocument(input: {
  projectId: string;
  ownerUid: string;
  tenantId: string;
  workspaceId: string;
  kind: ProjectMemoryKind;
  title: string;
  content: string;
  sourceRef?: string | null;
  provenance: ProjectMemoryProvenanceInput;
  now?: Timestamp;
}) {
  const now = input.now ?? Timestamp.now();
  const title = input.title.trim().slice(0, 160);
  const content = input.content.slice(0, MAX_PROJECT_MEMORY_ENTRY_CHARACTERS);
  const provenance = projectMemoryProvenance(input.provenance, now);
  return {
    projectId: input.projectId,
    ownerUid: input.ownerUid,
    actorUid: input.provenance.userId,
    userId: input.provenance.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    kind: input.kind,
    title,
    content,
    active: true,
    status: 'active',
    tokenEstimate: estimateTokenCounts(content).gemini,
    sourceRef: boundedLabel(input.sourceRef, 200),
    source: input.provenance.source,
    agent: provenance.agent,
    requestId: provenance.requestId,
    provenance,
    lastMutation: provenance,
    searchTerms: normalizedSearchTerms(title, content),
    validFrom: now,
    validTo: null,
    inactiveAt: null,
    inactiveBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateProjectMemoryDocument(input: {
  current: Record<string, unknown>;
  title?: string;
  content?: string;
  active?: boolean;
  provenance: ProjectMemoryProvenanceInput;
  now?: Timestamp;
}) {
  const now = input.now ?? Timestamp.now();
  const title = (input.title ?? String(input.current.title ?? '')).trim().slice(0, 160);
  const content = (input.content ?? String(input.current.content ?? '')).slice(0, MAX_PROJECT_MEMORY_ENTRY_CHARACTERS);
  const wasActive = input.current.active !== false;
  const active = input.active ?? wasActive;
  const lifecycleChanged = active !== wasActive;
  return {
    title,
    content,
    active,
    status: active ? 'active' : 'inactive',
    tokenEstimate: estimateTokenCounts(content).gemini,
    searchTerms: normalizedSearchTerms(title, content),
    source: input.provenance.source,
    agent: boundedLabel(input.provenance.agent, 120),
    requestId: boundedLabel(input.provenance.requestId, 200),
    lastMutation: projectMemoryProvenance(input.provenance, now),
    validFrom: lifecycleChanged && active ? now : (input.current.validFrom ?? input.current.createdAt ?? now),
    validTo: active ? null : (lifecycleChanged ? now : (input.current.validTo ?? now)),
    inactiveAt: active ? null : (lifecycleChanged ? now : (input.current.inactiveAt ?? now)),
    inactiveBy: active ? null : (lifecycleChanged ? input.provenance.userId : (input.current.inactiveBy ?? input.provenance.userId)),
    updatedAt: now,
  };
}

export function projectMemoryAuditDocument(input: {
  tenantId: string;
  workspaceId: string;
  projectId: string;
  entryId: string;
  action: 'create' | 'update' | 'deactivate' | 'reactivate' | 'delete';
  provenance: ProjectMemoryProvenanceInput;
  now?: Timestamp;
}) {
  const now = input.now ?? Timestamp.now();
  return {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    entryId: input.entryId,
    action: input.action,
    ...projectMemoryProvenance(input.provenance, now),
    createdAt: now,
  };
}
