export type ClariftTechnique =
  | 'Zero-shot'
  | 'Few-shot'
  | 'Chain-of-thought'
  | 'Tree-of-thoughts'
  | 'Role / persona'
  | 'Prompt chaining'
  | 'ReAct'
  | 'Meta / reflection';

export type RefinementMode = 'quick_refine' | 'guided_fix' | 'full_council';
export type QualityTier = 'generative' | 'fallback';
export type ProjectMemoryKind = 'refinement' | 'response' | 'converter' | 'note' | 'evaluation';

export interface AllowancePeriod {
  limit: number;
  used: number;
  reserved: number;
  remaining: number;
  resetAt: string;
}

export interface InferenceAllowance {
  refinement?: { daily: AllowancePeriod; monthly: AllowancePeriod };
  evaluation?: { daily: AllowancePeriod; monthly: AllowancePeriod };
}

export interface InferenceMetadata {
  contractVersion: 2;
  requestId: string;
  creditsCharged: number;
  qualityTier: QualityTier;
  allowance: InferenceAllowance;
  basicMode?: {
    reason: 'daily_limit' | 'monthly_limit' | 'budget_limit' | 'request_size' | 'service_busy';
    resetScope: 'daily' | 'monthly' | null;
    resetAt: string | null;
  } | null;
}

export interface RefinementInput {
  prompt: string;
  technique?: ClariftTechnique;
  mode?: RefinementMode;
  projectMemory?: string;
  explanationMode?: boolean;
  maxCharacters?: number;
  idempotencyKey?: string;
}

export interface RefinementResult extends InferenceMetadata {
  refinedPrompt: string;
  refinements?: unknown[];
  [key: string]: unknown;
}

export interface EvaluationInput {
  prompt: string;
  guidelines: string[];
}

export interface EvaluationResult extends InferenceMetadata {
  combinedScore: number;
  results: unknown[];
  [key: string]: unknown;
}

export interface ConversionFile {
  name: string;
  type?: string;
  data: Blob | Uint8Array | ArrayBuffer;
}

export interface ConversionResult {
  documents: Array<{
    sourceName: string;
    content: string;
    truncated: boolean;
    tokenCounts: Record<string, number>;
    warnings: string[];
    structure: Record<string, number>;
  }>;
  mergedContent: string;
  mergedTruncated: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'trashed';
  defaultTechnique: string;
  defaultGuidelines: string[];
  createdAt: string | null;
  updatedAt: string | null;
  trashedAt: string | null;
}

export interface MemoryEntry {
  id: string;
  projectId: string;
  kind: ProjectMemoryKind;
  title: string;
  content: string;
  active: boolean;
  status: 'active' | 'inactive';
  tokenEstimate: number;
  sourceRef: string | null;
  validFrom: string | null;
  validTo: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  provenance: {
    source: 'web' | 'api' | 'mcp' | 'system' | 'migration';
    agent: string | null;
    requestId: string | null;
    userId: string;
    timestamp: string | null;
    consent: 'explicit' | 'workflow' | 'project-policy' | 'system';
  };
}

export interface UsageSummary {
  plan: string;
  planStatus: string;
  developer: { enabled: boolean; source: string | null; features: string[] };
  credits: { balance: number; reserved: number; available: number };
  allowance: InferenceAllowance;
}

export interface ActiveMemoryContext {
  projectId: string;
  context: string;
  tokenEstimate: number;
  maxTokens: number;
  retrieval: { vectorUsed: boolean; graphHops: number; temporalFilter: string; candidateCount: number };
  sources: Array<{
    nodeId: string;
    memoryEntryId: string;
    type: string;
    title: string;
    score: number;
    vectorScore: number;
    keywordScore: number;
    provenance: Record<string, unknown>;
  }>;
}

export interface ClariftClientOptions {
  apiKey: string;
  baseUrl?: string;
  clientName?: 'sdk' | 'cli' | 'mcp' | string;
  agentName?: string;
  fetch?: typeof globalThis.fetch;
}

export class ClariftApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly requestId: string | null
  ) {
    super(message);
    this.name = 'ClariftApiError';
  }
}

function requestId() {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `sdk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class ClariftClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly clientName: string;
  private readonly agentName?: string;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(options: ClariftClientOptions) {
    if (!options.apiKey?.startsWith('clf_live_')) throw new Error('A Clarift API token is required.');
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://clarift.dpdns.org/api/v1').replace(/\/$/, '');
    this.clientName = options.clientName ?? 'sdk';
    this.agentName = options.agentName;
    this.fetcher = options.fetch ?? globalThis.fetch;
    if (!this.fetcher) throw new Error('A Fetch API implementation is required.');
  }

  private async request<T>(path: string, init: RequestInit = {}, consent = false): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.apiKey}`);
    headers.set('X-Clarift-Client', this.clientName);
    headers.set('X-Request-Id', headers.get('X-Request-Id') ?? requestId());
    if (this.agentName) headers.set('X-Clarift-Agent', this.agentName);
    if (consent) headers.set('X-Clarift-Write-Consent', 'true');
    if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    const response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers });
    const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
    if (!response.ok) {
      throw new ClariftApiError(
        payload?.error?.message ?? `Clarift API request failed with HTTP ${response.status}.`,
        response.status,
        payload?.error?.code ?? 'ClariftApiError',
        response.headers.get('x-request-id')
      );
    }
    return payload as T;
  }

  refine(input: RefinementInput) {
    return this.request<RefinementResult>('/refinements', { method: 'POST', body: JSON.stringify(input) });
  }

  evaluate(input: EvaluationInput) {
    return this.request<EvaluationResult>('/evaluations', { method: 'POST', body: JSON.stringify(input) });
  }

  convert(files: ConversionFile[]) {
    const form = new FormData();
    for (const file of files) {
      const blob = file.data instanceof Blob ? file.data : new Blob([file.data], { type: file.type });
      form.append('files', blob, file.name);
    }
    return this.request<ConversionResult>('/conversions', { method: 'POST', body: form });
  }

  async listProjects(includeTrashed = false) {
    return (await this.request<{ projects: Project[] }>(`/projects?includeTrashed=${includeTrashed}`)).projects;
  }

  createProject(input: { name: string; description?: string }) {
    return this.request<Project>('/projects', { method: 'POST', body: JSON.stringify(input) });
  }

  getProject(projectId: string) {
    return this.request<Project>(`/projects/${encodeURIComponent(projectId)}`);
  }

  updateProject(projectId: string, input: { name?: string; description?: string; status?: 'active' | 'trashed' }) {
    return this.request<Project>(`/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: JSON.stringify(input) });
  }

  trashProject(projectId: string) {
    return this.request<Project>(`/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
  }

  async listMemory(projectId: string, options: { activeOnly?: boolean; limit?: number } = {}) {
    const search = new URLSearchParams();
    if (options.activeOnly !== undefined) search.set('activeOnly', String(options.activeOnly));
    if (options.limit !== undefined) search.set('limit', String(options.limit));
    const suffix = search.size ? `?${search}` : '';
    return (await this.request<{ entries: MemoryEntry[] }>(`/projects/${encodeURIComponent(projectId)}/memory${suffix}`)).entries;
  }

  async searchMemory(input: { query: string; projectId?: string; activeOnly?: boolean; limit?: number }) {
    return (await this.request<{ entries: MemoryEntry[] }>('/memory/search', { method: 'POST', body: JSON.stringify(input) })).entries;
  }

  getActiveMemoryContext(input: { projectId: string; query: string; maxTokens?: number; topK?: number }) {
    return this.request<ActiveMemoryContext>('/memory/context', { method: 'POST', body: JSON.stringify(input) });
  }

  createMemory(projectId: string, input: { kind?: ProjectMemoryKind; title: string; content: string; sourceRef?: string | null; consent: true }) {
    return this.request<MemoryEntry>(`/projects/${encodeURIComponent(projectId)}/memory`, { method: 'POST', body: JSON.stringify(input) }, input.consent);
  }

  updateMemory(projectId: string, entryId: string, input: { title?: string; content?: string; active?: boolean; consent: true }) {
    return this.request<MemoryEntry>(`/projects/${encodeURIComponent(projectId)}/memory/${encodeURIComponent(entryId)}`, { method: 'PATCH', body: JSON.stringify(input) }, input.consent);
  }

  deleteMemory(projectId: string, entryId: string, consent: true) {
    return this.request<{ deleted: boolean; id: string }>(`/projects/${encodeURIComponent(projectId)}/memory/${encodeURIComponent(entryId)}`, { method: 'DELETE' }, consent);
  }

  getUsage() {
    return this.request<UsageSummary>('/usage');
  }
}
