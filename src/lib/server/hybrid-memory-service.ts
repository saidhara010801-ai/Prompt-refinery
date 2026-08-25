import { createHash } from 'node:crypto';
import { Timestamp, type DocumentReference, type WriteBatch } from 'firebase-admin/firestore';

import { normalizedSearchTerms } from '@/lib/stage2-utils';
import type { PublicApiCaller } from './api-key-service';
import { getAdminFirestore } from './firebase-admin';
import type { ProjectMemoryKind, ProjectMemoryProvenanceInput } from './project-memory';
import { projectMemoryProvenance } from './project-memory';
import { AuthorizationError } from './user-access';

export const MEMORY_GRAPH_NODE_TYPES = [
  'Project',
  'Decision',
  'Constraint',
  'File',
  'AgentHandoff',
  'Review',
  'Skill',
  'EvaluationResult',
] as const;
export type MemoryGraphNodeType = typeof MEMORY_GRAPH_NODE_TYPES[number];

export const MEMORY_GRAPH_EDGE_TYPES = [
  'supersedes',
  'related_to',
  'authored_by',
  'reviewed_by',
  'depends_on',
  'contradicts',
  'implements',
] as const;
export type MemoryGraphEdgeType = typeof MEMORY_GRAPH_EDGE_TYPES[number];

interface RankedMemoryNode {
  id: string;
  type: MemoryGraphNodeType;
  title: string;
  content: string;
  tokenEstimate: number;
  searchTerms: string[];
  embedding?: number[] | null;
  updatedAtMs?: number;
  provenance?: Record<string, unknown>;
  memoryEntryId?: string;
}

function assertHybridMemoryEnabled() {
  if (process.env.ENABLE_HYBRID_MEMORY !== 'true') {
    throw new AuthorizationError('Hybrid semantic memory is not enabled.', 503, 'HybridMemoryDisabledError');
  }
}

function embeddingConfiguration() {
  const endpoint = process.env.CLARIFT_EMBEDDING_ENDPOINT?.trim();
  const model = process.env.CLARIFT_EMBEDDING_MODEL?.trim();
  const apiKey = process.env.CLARIFT_EMBEDDING_API_KEY?.trim();
  if (!endpoint || !model) {
    throw new AuthorizationError('Hybrid memory embeddings are not configured.', 503, 'HybridMemoryEmbeddingUnavailableError');
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new AuthorizationError('Hybrid memory embedding endpoint is invalid.', 503, 'HybridMemoryEmbeddingUnavailableError');
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new AuthorizationError('Hybrid memory embedding endpoint must use HTTPS.', 503, 'HybridMemoryEmbeddingUnavailableError');
  }
  return { endpoint, model, apiKey };
}

async function embedText(text: string) {
  const config = embeddingConfiguration();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1_000, Number(process.env.CLARIFT_EMBEDDING_TIMEOUT_MS) || 10_000));
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: config.model, input: text.slice(0, 100000) }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Embedding request failed with HTTP ${response.status}.`);
    const payload = await response.json() as { data?: Array<{ embedding?: unknown }> };
    const embedding = payload.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || !embedding.length || embedding.length > 8192 || !embedding.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      throw new Error('Embedding response did not contain a finite vector.');
    }
    return embedding as number[];
  } catch (error) {
    const safe = new AuthorizationError('Hybrid memory embedding failed. No semantic memory mutation was written.', 503, 'HybridMemoryEmbeddingError');
    safe.cause = error;
    throw safe;
  } finally {
    clearTimeout(timeout);
  }
}

export function distillMemoryNodeType(kind: ProjectMemoryKind, title: string, content: string): MemoryGraphNodeType {
  const text = `${title} ${content}`.toLowerCase();
  if (kind === 'evaluation') return 'EvaluationResult';
  if (kind === 'converter' || /\b(file|path|module|document)\b/.test(text)) return 'File';
  if (/\b(handoff|continue from|next agent)\b/.test(text)) return 'AgentHandoff';
  if (/\b(skill|skill\.md)\b/.test(text)) return 'Skill';
  if (/\b(review|critique|adversarial)\b/.test(text)) return 'Review';
  if (/\b(constraint|must not|never|requirement|guardrail)\b/.test(text)) return 'Constraint';
  return 'Decision';
}

function cosineSimilarity(left: number[] | null | undefined, right: number[] | null | undefined) {
  if (!left?.length || !right?.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : 0;
}

export function rankHybridMemoryNodes(nodes: RankedMemoryNode[], query: string, queryEmbedding: number[], nowMs = Date.now()) {
  const terms = normalizedSearchTerms(query).slice(0, 12);
  return nodes.map((node) => {
    const searchable = new Set(node.searchTerms);
    const keywordScore = terms.length ? terms.filter((term) => searchable.has(term)).length / terms.length : 0;
    const vectorScore = Math.max(0, cosineSimilarity(queryEmbedding, node.embedding));
    const ageDays = Math.max(0, nowMs - (node.updatedAtMs ?? nowMs)) / (24 * 60 * 60 * 1000);
    const recencyScore = 1 / (1 + ageDays / 30);
    return { ...node, score: vectorScore * 0.7 + keywordScore * 0.25 + recencyScore * 0.05, vectorScore, keywordScore };
  }).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

function timestampMillis(value: unknown) {
  return value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function'
    ? Number(value.toMillis())
    : undefined;
}

function safeProvenance(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

async function requireProject(caller: PublicApiCaller, projectId: string) {
  const ref = getAdminFirestore().doc(`projects/${projectId}`);
  const snapshot = await ref.get();
  const data = snapshot.data();
  if (!snapshot.exists || data?.tenantId !== caller.context.tenantId || data?.workspaceId !== caller.context.workspaceId || data?.status === 'trashed') {
    throw new AuthorizationError('Project not found.', 404, 'ProjectNotFoundError');
  }
  return { ref, data: data ?? {} };
}

export async function prepareHybridGraphWrite(input: {
  projectRef: DocumentReference;
  projectId: string;
  projectName: string;
  entryId: string;
  kind: ProjectMemoryKind;
  title: string;
  content: string;
  tokenEstimate: number;
  tenantId: string;
  workspaceId: string;
  provenance: ProjectMemoryProvenanceInput;
  now: Timestamp;
  createdAt?: Timestamp;
  active?: boolean;
}) {
  if (process.env.ENABLE_HYBRID_MEMORY !== 'true') return null;
  const embedding = await embedText(`${input.title}\n${input.content}`);
  const provenance = projectMemoryProvenance(input.provenance, input.now);
  const projectNodeRef = input.projectRef.collection('memoryGraphNodes').doc('project');
  const entryNodeRef = input.projectRef.collection('memoryGraphNodes').doc(input.entryId);
  const edgeRef = input.projectRef.collection('memoryGraphEdges').doc(`${input.entryId}_related_to_project`);
  return {
    projectNodeRef,
    projectNode: {
      projectId: input.projectId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      type: 'Project',
      title: input.projectName.slice(0, 160),
      content: '',
      active: true,
      validFrom: input.now,
      validTo: null,
      updatedAt: input.now,
    },
    entryNodeRef,
    entryNode: {
      projectId: input.projectId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      memoryEntryId: input.entryId,
      type: distillMemoryNodeType(input.kind, input.title, input.content),
      title: input.title.slice(0, 160),
      content: input.content.slice(0, 100000),
      tokenEstimate: input.tokenEstimate,
      searchTerms: normalizedSearchTerms(input.title, input.content),
      embedding,
      embeddingModelHash: createHash('sha256').update(embeddingConfiguration().model).digest('hex').slice(0, 16),
      active: input.active !== false,
      validFrom: input.createdAt ?? input.now,
      validTo: input.active === false ? input.now : null,
      provenance,
      createdAt: input.createdAt ?? input.now,
      updatedAt: input.now,
    },
    edgeRef,
    edge: {
      projectId: input.projectId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      fromNodeId: input.entryId,
      toNodeId: 'project',
      type: 'related_to',
      active: input.active !== false,
      validFrom: input.createdAt ?? input.now,
      validTo: input.active === false ? input.now : null,
      provenance,
      createdAt: input.createdAt ?? input.now,
      updatedAt: input.now,
    },
  };
}

export function addPreparedHybridGraphWrite(batch: WriteBatch, prepared: NonNullable<Awaited<ReturnType<typeof prepareHybridGraphWrite>>>) {
  batch.set(prepared.projectNodeRef, prepared.projectNode, { merge: true });
  batch.set(prepared.entryNodeRef, prepared.entryNode, { merge: true });
  batch.set(prepared.edgeRef, prepared.edge, { merge: true });
}

export function setHybridGraphNodeActive(
  batch: WriteBatch,
  projectRef: DocumentReference,
  entryId: string,
  active: boolean,
  provenance: ProjectMemoryProvenanceInput,
  now: Timestamp
) {
  if (process.env.ENABLE_HYBRID_MEMORY !== 'true') return;
  const mutation = projectMemoryProvenance(provenance, now);
  batch.set(projectRef.collection('memoryGraphNodes').doc(entryId), {
    active,
    validTo: active ? null : now,
    lastMutation: mutation,
    updatedAt: now,
  }, { merge: true });
  batch.set(projectRef.collection('memoryGraphEdges').doc(`${entryId}_related_to_project`), {
    active,
    validTo: active ? null : now,
    lastMutation: mutation,
    updatedAt: now,
  }, { merge: true });
}

export async function getActiveHybridMemoryContext(
  caller: PublicApiCaller,
  input: { projectId: string; query: string; maxTokens?: number; topK?: number }
) {
  assertHybridMemoryEnabled();
  const project = await requireProject(caller, input.projectId);
  const queryEmbedding = await embedText(input.query);
  const [nodeSnapshot, edgeSnapshot] = await Promise.all([
    project.ref.collection('memoryGraphNodes').where('active', '==', true).limit(200).get(),
    project.ref.collection('memoryGraphEdges').where('active', '==', true).limit(300).get(),
  ]);
  const nodes: RankedMemoryNode[] = nodeSnapshot.docs
    .filter((document) => document.id !== 'project')
    .map((document) => {
      const data = document.data();
      return {
        id: document.id,
        type: MEMORY_GRAPH_NODE_TYPES.includes(data.type) ? data.type : 'Decision',
        title: String(data.title ?? ''),
        content: String(data.content ?? ''),
        tokenEstimate: Number(data.tokenEstimate) || Math.ceil(String(data.content ?? '').length / 4),
        searchTerms: Array.isArray(data.searchTerms) ? data.searchTerms.map(String) : [],
        embedding: Array.isArray(data.embedding) ? data.embedding.map(Number) : null,
        updatedAtMs: timestampMillis(data.updatedAt),
        provenance: safeProvenance(data.provenance),
        memoryEntryId: String(data.memoryEntryId ?? document.id),
      };
    });
  const ranked = rankHybridMemoryNodes(nodes, input.query, queryEmbedding);
  const topIds = new Set(ranked.slice(0, Math.min(Math.max(input.topK ?? 8, 1), 20)).map((node) => node.id));
  for (const edge of edgeSnapshot.docs) {
    const data = edge.data();
    if (topIds.has(String(data.fromNodeId)) || topIds.has(String(data.toNodeId))) {
      topIds.add(String(data.fromNodeId));
      topIds.add(String(data.toNodeId));
    }
  }
  const selected = ranked.filter((node) => topIds.has(node.id));
  const maxTokens = Math.min(Math.max(input.maxTokens ?? 3_000, 200), 12_000);
  const included = [] as typeof selected;
  let usedTokens = 0;
  for (const node of selected) {
    if (usedTokens + node.tokenEstimate > maxTokens && included.length) continue;
    included.push(node);
    usedTokens += Math.min(node.tokenEstimate, maxTokens - usedTokens);
    if (usedTokens >= maxTokens) break;
  }
  const context = included.map((node) => `[${node.type}] ${node.title}\n${node.content}`).join('\n\n').slice(0, maxTokens * 4);
  return {
    projectId: input.projectId,
    context,
    tokenEstimate: Math.ceil(context.length / 4),
    maxTokens,
    retrieval: { vectorUsed: true, graphHops: 1, temporalFilter: 'active', candidateCount: nodes.length },
    sources: included.map((node) => ({
      nodeId: node.id,
      memoryEntryId: node.memoryEntryId,
      type: node.type,
      title: node.title,
      score: Math.round(node.score * 10000) / 10000,
      vectorScore: Math.round(node.vectorScore * 10000) / 10000,
      keywordScore: Math.round(node.keywordScore * 10000) / 10000,
      provenance: node.provenance,
    })),
  };
}
