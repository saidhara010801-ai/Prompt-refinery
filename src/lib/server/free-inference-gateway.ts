import { createHash, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';

import {
  chooseBasicModeStatus,
  estimateSerializedTokens,
  priceForMaximumAttempt,
  type BasicModeStatus,
  type FreeInferenceTask,
  type InferenceQualityTier,
} from '@/lib/free-inference';
import { acquireProviderCircuit, recordProviderFailure, recordProviderSuccess } from './provider-circuit-breaker';
import {
  acquireFreeInferenceAdmission,
  quotaFallbackStatus,
  readFreeInferenceAllowance,
  releaseFreeInferenceAdmission,
  releaseFreeQuota,
  releaseProviderBudget,
  reserveFreeQuota,
  reserveProviderBudget,
  resolveInferenceAllowancePlan,
  settleFreeQuota,
  settleProviderBudget,
} from './free-inference-control';
import { getAdminFirestore } from './firebase-admin';
import {
  OpenModelProviderError,
  ProviderSchemaError,
  createOpenModelCompletion,
  parseProviderJson,
  type OpenModelProvider,
  type OpenModelUsage,
} from './open-model-client';
import {
  freeRemoteDeadlineMs,
  getFreeProviderOrder,
  getOpenModelProviderConfig,
  type OpenModelProviderConfig,
} from './open-model-provider-config';
import type { TenantContext } from './tenant-service';
import { recordTenantUsage } from './usage-meter';
import { getEffectiveUserRole } from './user-access';

export type FreeGatewaySource = 'app' | 'api' | 'extension';

interface FreeGatewayRequest<T> {
  context: TenantContext;
  task: FreeInferenceTask;
  idempotencyKey: string;
  source: FreeGatewaySource;
  prepared: {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    schema: { name: string; schema: Record<string, unknown> };
    outputSchema: z.ZodType<T>;
    repairMessage?: string;
    maxTokens: number;
    inputTokenLimit: number;
  };
  fallback: () => Promise<T> | T;
}

export interface FreeGatewayResult<T> {
  result: T;
  requestId: string;
  creditsCharged: 0;
  provider: OpenModelProvider | 'local';
  qualityTier: InferenceQualityTier;
  allowance: Awaited<ReturnType<typeof readFreeInferenceAllowance>>;
  basicMode?: BasicModeStatus;
}

interface AttemptRecord {
  provider: OpenModelProvider;
  model: string;
  status: 'succeeded' | 'failed' | 'malformed' | 'skipped';
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  errorCode?: string;
  httpStatus?: number;
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function idempotencyId(tenantId: string, key: string) {
  return createHash('sha256').update(`${tenantId}:${key}`).digest('hex');
}

function errorCode(error: unknown) {
  if (error instanceof OpenModelProviderError && error.status) return `ProviderHttp${error.status}`;
  return error instanceof Error ? error.name.slice(0, 120) : 'UnknownError';
}

function providerStatus(error: unknown) {
  return error instanceof OpenModelProviderError ? error.status : undefined;
}

function calculateCost(provider: OpenModelProvider, usage: OpenModelUsage) {
  if (usage.costUsd !== null && Number.isFinite(usage.costUsd)) return usage.costUsd;
  if (usage.inputTokens === null && usage.outputTokens === null) return null;
  return priceForMaximumAttempt({
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    ...providerRates(provider),
  });
}

function estimateAttempt(provider: OpenModelProvider, inputTokenLimit: number, maxTokens: number) {
  return priceForMaximumAttempt({
    inputTokens: inputTokenLimit,
    outputTokens: maxTokens,
    ...providerRates(provider),
  });
}

function providerRates(provider: OpenModelProvider) {
  if (provider === 'openrouter') return {
    inputUsdPerMillion: positiveNumber(process.env.CLARIFT_OPENROUTER_INPUT_USD_PER_MILLION, 0.17),
    outputUsdPerMillion: positiveNumber(process.env.CLARIFT_OPENROUTER_OUTPUT_USD_PER_MILLION, 0.6),
  };
  if (provider === 'together') return {
    inputUsdPerMillion: positiveNumber(process.env.CLARIFT_TOGETHER_INPUT_USD_PER_MILLION, 0.2),
    outputUsdPerMillion: positiveNumber(process.env.CLARIFT_TOGETHER_OUTPUT_USD_PER_MILLION, 0.5),
  };
  return {
    inputUsdPerMillion: positiveNumber(process.env.CLARIFT_GEMMA_INPUT_USD_PER_MILLION, 0.05),
    outputUsdPerMillion: positiveNumber(process.env.CLARIFT_GEMMA_OUTPUT_USD_PER_MILLION, 0.1),
  };
}

export function freeManagedInferenceRoleBypassesRollout(role: string | null | undefined) {
  return role === 'owner' || role === 'admin';
}

async function claimIdempotency<T>(request: FreeGatewayRequest<T>, requestId: string) {
  const firestore = getAdminFirestore();
  const ref = firestore.doc(`gatewayRequests/${idempotencyId(request.context.tenantId, request.idempotencyKey)}`);
  const now = Date.now();
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    if (snapshot.exists && (data?.tenantId !== request.context.tenantId || data?.task !== request.task)) {
      throw new Error('An idempotency key cannot be reused for another tenant or task.');
    }
    if (data?.status === 'succeeded') {
      const error = new Error('This request was already completed.');
      error.name = 'IdempotencyReplayError';
      throw error;
    }
    const expiresAt = data?.expiresAt?.toMillis?.() ?? 0;
    if (data?.status === 'running' && expiresAt > now) {
      const error = new Error('A request with this idempotency key is already in progress.');
      error.name = 'IdempotencyInProgressError';
      throw error;
    }
    transaction.set(ref, {
      tenantId: request.context.tenantId,
      workspaceId: request.context.workspaceId,
      principalId: request.context.principalId,
      task: request.task,
      source: request.source,
      requestId,
      status: 'running',
      attempt: (Number(data?.attempt) || 0) + 1,
      createdAt: data?.createdAt || Timestamp.fromMillis(now),
      updatedAt: Timestamp.fromMillis(now),
      expiresAt: Timestamp.fromMillis(now + 10 * 60 * 1000),
    }, { merge: true });
  });
  return ref;
}

export async function tenantUsesFreeManagedInference(context: TenantContext) {
  if (process.env.ENABLE_FREE_MANAGED_INFERENCE !== 'true') return false;
  const entitlement = await getAdminFirestore().doc(`tenantEntitlements/${context.tenantId}`).get();
  if (entitlement.data()?.freeManagedInferenceBeta === true) return true;
  const role = await getEffectiveUserRole(context.principalId);
  if (freeManagedInferenceRoleBypassesRollout(role)) return true;
  const percent = Math.min(Math.max(Number(process.env.CLARIFT_FREE_INFERENCE_ROLLOUT_PERCENT) || 0, 0), 100);
  if (percent <= 0) return false;
  const bucket = Number.parseInt(createHash('sha256').update(context.tenantId).digest('hex').slice(0, 8), 16) % 100;
  return bucket < percent;
}

export async function executeFreeGatewayTask<T>(request: FreeGatewayRequest<T>): Promise<FreeGatewayResult<T>> {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const allowancePlan = await resolveInferenceAllowancePlan(request.context);
  const idempotencyRef = await claimIdempotency(request, requestId);
  const attempts: AttemptRecord[] = [];
  let quotaReservation: Awaited<ReturnType<typeof reserveFreeQuota>> | null = null;
  let admission: Awaited<ReturnType<typeof acquireFreeInferenceAdmission>> = [];
  let provider: OpenModelProvider | 'local' = 'local';
  let qualityTier: InferenceQualityTier = 'fallback';
  let basicMode: BasicModeStatus | undefined;
  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  const finishFallback = async (status: BasicModeStatus) => {
    basicMode = status;
    const result = await request.fallback();
    if (quotaReservation?.status === 'reserved') await releaseFreeQuota(quotaReservation.id);
    const allowance = await readFreeInferenceAllowance(request.context.tenantId, new Date(), allowancePlan);
    await idempotencyRef.set({ status: 'succeeded', provider: 'local', qualityTier: 'fallback', creditsCharged: 0, completedAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true });
    await recordTenantUsage({
      requestId,
      tenantId: request.context.tenantId,
      workspaceId: request.context.workspaceId,
      principalId: request.context.principalId,
      task: request.task,
      inferenceMode: 'managed',
      provider: 'local',
      inputTokens: totalInputTokens || null,
      outputTokens: totalOutputTokens || null,
      providerCostUsd: totalCost || null,
      creditsCharged: 0,
      status: 'succeeded',
      latencyMs: Date.now() - startedAt,
      source: request.source,
      qualityTier: 'fallback',
      fallbackReason: status.reason,
      attempts,
    });
    return { result, requestId, creditsCharged: 0 as const, provider: 'local' as const, qualityTier: 'fallback' as const, allowance, basicMode: status };
  };

  try {
    const serializedTokens = estimateSerializedTokens({ messages: request.prepared.messages, schema: request.prepared.schema.schema });
    if (serializedTokens > request.prepared.inputTokenLimit) return await finishFallback(chooseBasicModeStatus({ requestTooLarge: true }));

    quotaReservation = await reserveFreeQuota({ context: request.context, task: request.task, requestId, allowancePlan });
    if (quotaReservation.status === 'unavailable') return await finishFallback(quotaFallbackStatus(quotaReservation));

    try {
      admission = await acquireFreeInferenceAdmission(request.context);
    } catch {
      return await finishFallback(chooseBasicModeStatus({}));
    }

    const deadline = startedAt + freeRemoteDeadlineMs(request.source);
    let attemptNumber = 0;
    let budgetBlocked = false;

    const runAttempt = async (config: OpenModelProviderConfig, timeoutCap: number, repair: boolean): Promise<T | null> => {
      attemptNumber += 1;
      const { provider: attemptProvider, model, apiKey } = config;
      const remaining = deadline - Date.now();
      if (!apiKey || remaining < 1_000) {
        attempts.push({ provider: attemptProvider, model, status: 'skipped', inputTokens: null, outputTokens: null, costUsd: null, errorCode: !apiKey ? 'ProviderKeyMissingError' : 'RemoteDeadlineExceeded' });
        return null;
      }
      try {
        await acquireProviderCircuit(attemptProvider, model);
      } catch (error) {
        attempts.push({ provider: attemptProvider, model, status: 'skipped', inputTokens: null, outputTokens: null, costUsd: null, errorCode: errorCode(error) });
        return null;
      }
      const budget = await reserveProviderBudget({
        requestId,
        attempt: attemptNumber,
        provider: attemptProvider,
        estimatedCostUsd: estimateAttempt(attemptProvider, request.prepared.inputTokenLimit, request.prepared.maxTokens),
      });
      if (!budget) {
        budgetBlocked = true;
        attempts.push({ provider: attemptProvider, model, status: 'skipped', inputTokens: null, outputTokens: null, costUsd: null, errorCode: 'ProviderBudgetLimitError' });
        return null;
      }
      let budgetFinished = false;
      try {
        const completion = await createOpenModelCompletion({
          provider: attemptProvider,
          apiKey,
          model,
          messages: repair
            ? [...request.prepared.messages, { role: 'user', content: request.prepared.repairMessage || 'The previous response was invalid. Return only a complete JSON object that exactly matches the supplied schema.' }]
            : request.prepared.messages,
          maxTokens: request.prepared.maxTokens,
          timeoutMs: Math.max(1_000, Math.min(timeoutCap, remaining)),
          responseSchema: request.prepared.schema,
          providerSort: attemptProvider === 'openrouter' ? 'throughput' : undefined,
          reasoningEffort: attemptProvider === 'openrouter' ? 'none' : undefined,
          endpointUrl: config.endpointUrl,
          cloudRunAudience: config.cloudRunAudience,
        });
        const cost = calculateCost(attemptProvider, completion.usage) ?? budget.amountUsd;
        await settleProviderBudget(budget, cost);
        budgetFinished = true;
        totalCost += cost;
        totalInputTokens += completion.usage.inputTokens ?? 0;
        totalOutputTokens += completion.usage.outputTokens ?? 0;
        try {
          const parsed = parseProviderJson(completion.content, request.prepared.outputSchema);
          attempts.push({ provider: attemptProvider, model, status: 'succeeded', ...completion.usage, costUsd: cost });
          await recordProviderSuccess(attemptProvider, model).catch(() => undefined);
          provider = attemptProvider;
          return parsed;
        } catch (error) {
          attempts.push({ provider: attemptProvider, model, status: 'malformed', ...completion.usage, costUsd: cost, errorCode: errorCode(error) });
          throw error;
        }
      } catch (error) {
        if (!budgetFinished) await releaseProviderBudget(budget).catch(() => undefined);
        attempts.push(...(attempts.at(-1)?.provider === attemptProvider && attempts.at(-1)?.status === 'malformed' ? [] : [{
          provider: attemptProvider,
          model,
          status: 'failed' as const,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          errorCode: errorCode(error),
          ...(providerStatus(error) ? { httpStatus: providerStatus(error) } : {}),
        }]));
        throw error;
      }
    };

    let result: T | null = null;
    for (const attemptProvider of getFreeProviderOrder()) {
      const config = getOpenModelProviderConfig(attemptProvider, request.source);
      if (!config) {
        attempts.push({
          provider: attemptProvider,
          model: attemptProvider === 'gemma'
            ? process.env.GEMMA_MODEL_ID || 'google/gemma-4-E4B-it'
            : attemptProvider === 'together'
              ? process.env.CLARIFT_FREE_TOGETHER_MODEL || 'google/gemma-4-31B-it'
              : process.env.CLARIFT_FREE_OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it',
          status: 'skipped',
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          errorCode: 'ProviderConfigurationMissing',
        });
        continue;
      }
      let finalError: unknown = null;
      try {
        result = await runAttempt(config, config.timeoutMs, false);
      } catch (error) {
        finalError = error;
        const remaining = deadline - Date.now();
        const repairTimeout = Math.min(25_000, remaining - 8_000);
        if (error instanceof ProviderSchemaError && repairTimeout >= 8_000) {
          try {
            result = await runAttempt(config, repairTimeout, true);
            finalError = null;
          } catch (repairError) {
            finalError = repairError;
          }
        }
      }
      if (result) break;
      if (finalError) {
        await recordProviderFailure(attemptProvider, errorCode(finalError), {
          model: config.model,
          requestId,
          status: providerStatus(finalError),
        }).catch(() => undefined);
      }
      if (deadline - Date.now() < 4_000) break;
    }
    if (!result) return await finishFallback(chooseBasicModeStatus({ budgetLimit: budgetBlocked }));

    qualityTier = 'generative';
    await settleFreeQuota(quotaReservation.id);
    const allowance = await readFreeInferenceAllowance(request.context.tenantId, new Date(), allowancePlan);
    await idempotencyRef.set({ status: 'succeeded', provider, qualityTier, creditsCharged: 0, completedAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true });
    await recordTenantUsage({
      requestId,
      tenantId: request.context.tenantId,
      workspaceId: request.context.workspaceId,
      principalId: request.context.principalId,
      task: request.task,
      inferenceMode: 'managed',
      provider,
      inputTokens: totalInputTokens || null,
      outputTokens: totalOutputTokens || null,
      providerCostUsd: totalCost || null,
      creditsCharged: 0,
      status: 'succeeded',
      latencyMs: Date.now() - startedAt,
      source: request.source,
      qualityTier,
      attempts,
    });
    return { result, requestId, creditsCharged: 0, provider, qualityTier, allowance };
  } catch (error) {
    if (quotaReservation?.status === 'reserved') await releaseFreeQuota(quotaReservation.id).catch(() => undefined);
    await idempotencyRef.set({ status: 'failed', errorCode: errorCode(error), updatedAt: Timestamp.now(), expiresAt: Timestamp.now() }, { merge: true }).catch(() => undefined);
    await recordTenantUsage({
      requestId,
      tenantId: request.context.tenantId,
      workspaceId: request.context.workspaceId,
      principalId: request.context.principalId,
      task: request.task,
      inferenceMode: 'managed',
      provider,
      creditsCharged: 0,
      status: 'failed',
      latencyMs: Date.now() - startedAt,
      source: request.source,
      errorCode: errorCode(error),
      qualityTier,
      attempts,
    }).catch(() => undefined);
    throw error;
  } finally {
    if (admission.length) await releaseFreeInferenceAdmission(admission);
  }
}
