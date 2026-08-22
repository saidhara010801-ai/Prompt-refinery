import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { getAdminFirestore } from './firebase-admin';
import type { ClariftTask } from './credit-service';
import type { InferenceMode, InferenceProviderName } from './provider-key-service';

export interface TenantUsageInput {
  requestId: string;
  tenantId: string;
  workspaceId: string;
  principalId: string;
  task: ClariftTask;
  inferenceMode: InferenceMode | 'system';
  provider?: InferenceProviderName | 'gemma' | 'together' | 'markitdown' | 'none';
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  providerCostUsd?: number | null;
  creditsCharged: number;
  status: 'succeeded' | 'failed';
  latencyMs: number;
  source: 'app' | 'api' | 'extension';
  errorCode?: string | null;
  itemCount?: number | null;
  qualityTier?: 'generative' | 'fallback' | null;
  fallbackReason?: string | null;
  attempts?: Array<{
    provider: string;
    model: string;
    status: string;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    errorCode?: string;
    httpStatus?: number;
  }>;
}

export async function recordTenantUsage(input: TenantUsageInput) {
  const firestore = getAdminFirestore();
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const eventRef = firestore.doc(`usageEvents/${input.requestId}`);
  const aggregateRef = firestore.doc(`usageDailyAggregates/${input.tenantId}_${day}`);
  const batch = firestore.batch();
  batch.set(eventRef, {
    ...input,
    model: input.model?.slice(0, 160) || null,
    inputTokens: Number.isFinite(input.inputTokens) ? input.inputTokens : null,
    outputTokens: Number.isFinite(input.outputTokens) ? input.outputTokens : null,
    providerCostUsd: Number.isFinite(input.providerCostUsd) ? input.providerCostUsd : null,
    errorCode: input.errorCode?.slice(0, 120) || null,
    fallbackReason: input.fallbackReason?.slice(0, 120) || null,
    attempts: (input.attempts ?? []).slice(0, 3).map((attempt) => ({
      provider: attempt.provider.slice(0, 40),
      model: attempt.model.slice(0, 160),
      status: attempt.status.slice(0, 40),
      inputTokens: Number.isFinite(attempt.inputTokens) ? attempt.inputTokens : null,
      outputTokens: Number.isFinite(attempt.outputTokens) ? attempt.outputTokens : null,
      costUsd: Number.isFinite(attempt.costUsd) ? attempt.costUsd : null,
      errorCode: attempt.errorCode?.slice(0, 120) || null,
      httpStatus: Number.isInteger(attempt.httpStatus) ? attempt.httpStatus : null,
    })),
    itemCount: Number.isFinite(input.itemCount) ? input.itemCount : null,
    createdAt: Timestamp.fromDate(now),
    expiresAt: Timestamp.fromMillis(now.getTime() + 90 * 24 * 60 * 60 * 1000),
  }, { merge: false });
  batch.set(aggregateRef, {
    tenantId: input.tenantId,
    day,
    requestCount: FieldValue.increment(1),
    successCount: FieldValue.increment(input.status === 'succeeded' ? 1 : 0),
    failureCount: FieldValue.increment(input.status === 'failed' ? 1 : 0),
    generativeCount: FieldValue.increment(input.qualityTier === 'generative' ? 1 : 0),
    fallbackCount: FieldValue.increment(input.qualityTier === 'fallback' ? 1 : 0),
    inputTokens: FieldValue.increment(Number.isFinite(input.inputTokens) ? Number(input.inputTokens) : 0),
    outputTokens: FieldValue.increment(Number.isFinite(input.outputTokens) ? Number(input.outputTokens) : 0),
    providerCostUsd: FieldValue.increment(Number.isFinite(input.providerCostUsd) ? Number(input.providerCostUsd) : 0),
    expiresAt: Timestamp.fromMillis(now.getTime() + 13 * 31 * 24 * 60 * 60 * 1000),
    updatedAt: Timestamp.fromDate(now),
  }, { merge: true });
  await batch.commit();
}
