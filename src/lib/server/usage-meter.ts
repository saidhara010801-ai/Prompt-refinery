import { Timestamp } from 'firebase-admin/firestore';

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
  provider?: InferenceProviderName | 'markitdown' | 'none';
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
}

export async function recordTenantUsage(input: TenantUsageInput) {
  await getAdminFirestore().doc(`usageEvents/${input.requestId}`).set({
    ...input,
    model: input.model?.slice(0, 160) || null,
    inputTokens: Number.isFinite(input.inputTokens) ? input.inputTokens : null,
    outputTokens: Number.isFinite(input.outputTokens) ? input.outputTokens : null,
    providerCostUsd: Number.isFinite(input.providerCostUsd) ? input.providerCostUsd : null,
    errorCode: input.errorCode?.slice(0, 120) || null,
    itemCount: Number.isFinite(input.itemCount) ? input.itemCount : null,
    createdAt: Timestamp.now(),
  }, { merge: false });
}
