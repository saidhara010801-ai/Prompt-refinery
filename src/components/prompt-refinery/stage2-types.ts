export type ProjectMemoryEntryKind = 'refinement' | 'response' | 'converter' | 'note' | 'evaluation';

export interface ProjectMemoryEntry {
  id: string;
  projectId: string;
  ownerUid: string;
  actorUid: string;
  userId?: string;
  kind: ProjectMemoryEntryKind;
  title: string;
  content: string;
  active: boolean;
  status?: 'active' | 'inactive';
  tokenEstimate: number;
  sourceRef?: string | null;
  source?: 'web' | 'api' | 'mcp' | 'system' | 'migration';
  agent?: string | null;
  requestId?: string | null;
  validFrom?: { seconds: number; nanoseconds: number };
  validTo?: { seconds: number; nanoseconds: number } | null;
  searchTerms?: string[];
  createdAt?: { seconds: number; nanoseconds: number };
  updatedAt?: { seconds: number; nanoseconds: number };
}

export interface ConversionDocumentResult {
  id: string;
  sourceName: string;
  mimeType: string;
  content: string;
  truncated: boolean;
  tokenCounts: {
    gemini: number;
    openai: number;
    deepseek: number;
    qwen: number;
  };
  warnings: string[];
  structure: {
    headings: number;
    tables: number;
    listItems: number;
  };
}

export interface ConversionBatchResult {
  documents: ConversionDocumentResult[];
  mergedContent: string;
  mergedTruncated: boolean;
}

export interface EvaluationRun {
  id: string;
  prompt: string;
  guidelines: string[];
  combinedScore: number;
  results: Array<{
    guideline: string;
    shouldInclude: boolean;
    reason: string;
    score: number;
    recommendations: string[];
    dimensionScores: Record<'clarity' | 'context' | 'structure' | 'specificity', number>;
  }>;
  createdAt?: { seconds: number; nanoseconds: number };
}
