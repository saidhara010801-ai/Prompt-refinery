import { createHash, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';

import {
  refinePromptWithAICouncil,
  type RefinePromptWithAICouncilInput,
  type RefinePromptWithAICouncilOutput,
} from '@/ai/flows/refine-prompt-with-ai-council';
import { evaluatePromptGuidelinesBatch, type BatchEvaluationOutput } from '@/ai/flows/evaluate-prompt-guidelines-batch';
import { reserveCredits, releaseCredits, settleCredits, taskCost, type ClariftTask } from './credit-service';
import { acquireConcurrencySlot, consumeDistributedLimit, releaseConcurrencySlot } from './distributed-limits';
import {
  localFallbackCredential,
  resolveProviderCredential,
  type InferenceMode,
  type InferenceProviderName,
  type ProviderCredential,
  type ProviderName,
} from './provider-key-service';
import type { TenantContext } from './tenant-service';
import { recordTenantUsage } from './usage-meter';
import { getAdminFirestore } from './firebase-admin';
import { acquireProviderCircuit, recordProviderFailure, recordProviderSuccess } from './provider-circuit-breaker';
import { captureProviderUsage } from './provider-usage-context';
import { evaluatePromptLocally, refinePromptLocally } from '@/lib/local-inference';
import { buildFreeEvaluationRequest, buildFreeRefinementRequest } from './free-model-inference';
import { executeFreeGatewayTask, tenantUsesFreeManagedInference } from './free-inference-gateway';
import { readFreeInferenceAllowance, resolveInferenceAllowancePlan } from './free-inference-control';
import { chooseBasicModeStatus, type BasicModeStatus, type FreeInferenceAllowance, type InferenceQualityTier } from '@/lib/free-inference';

export type GatewaySource = 'app' | 'api' | 'extension';
export type GatewayProvider = InferenceProviderName | 'together';

export interface GatewayPublicMetadata {
  qualityTier: InferenceQualityTier;
  allowance: FreeInferenceAllowance;
  basicMode?: BasicModeStatus;
}

export interface GatewayTaskRequest {
  context: TenantContext;
  task: ClariftTask;
  inferenceMode?: InferenceMode;
  preferredProvider?: ProviderName;
  idempotencyKey: string;
  source: GatewaySource;
  allowProviderFallback?: boolean;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function errorCode(error: unknown) {
  return error instanceof Error ? error.name.slice(0, 120) : 'UnknownError';
}

function shouldRetryProvider(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  if (/invalid.*key|unauthorized|permission|quota|insufficient|validation|not supported/.test(message)) return false;
  const status = Number((error as Error & { status?: number }).status);
  return (error.name === 'OpenRouterError' && (!status || status === 429 || status >= 500)) ||
    /timed out|temporarily unavailable|could not be reached|fetch failed|network/.test(message);
}

function shouldCountProviderFailure(error: unknown) {
  return (error instanceof Error && error.name === 'ProviderTimeoutError') || shouldRetryProvider(error);
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function idempotencyDocumentId(tenantId: string, key: string) {
  return createHash('sha256').update(`${tenantId}:${key}`).digest('hex');
}

async function claimIdempotency(request: GatewayTaskRequest, requestId: string) {
  const firestore = getAdminFirestore();
  const ref = firestore.doc(`gatewayRequests/${idempotencyDocumentId(request.context.tenantId, request.idempotencyKey)}`);
  const now = Date.now();
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    if (snapshot.exists && (data?.tenantId !== request.context.tenantId || data?.task !== request.task)) {
      throw new Error('An idempotency key cannot be reused for another tenant or task.');
    }
    if (data?.status === 'succeeded') {
      const error = new Error(`This request was already completed as ${String(data.requestId || 'an earlier request')}.`);
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

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error('Clarift took too long to complete this request.');
          error.name = 'ProviderTimeoutError';
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function runGatewayTask<T>(
  request: GatewayTaskRequest,
  executor: (credential: ProviderCredential, requestId: string) => Promise<T>
) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const mode = request.inferenceMode ?? 'managed';
  const idempotencyRef = await claimIdempotency(request, requestId);
  let concurrency: Awaited<ReturnType<typeof acquireConcurrencySlot>> | null = null;
  let reservation: Awaited<ReturnType<typeof reserveCredits>> | null = null;
  let provider: InferenceProviderName | 'none' = 'none';
  let creditsCharged = 0;
  let providerUsage: { inputTokens: number | null; outputTokens: number | null; costUsd: number | null } = {
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
  };
  try {
    const [perUser, perTenant] = await Promise.all([
      consumeDistributedLimit({
        bucket: 'ai-user-minute',
        key: request.context.principalId,
        limit: positiveInteger(process.env.CLARIFT_USER_RPM, 20),
        windowMs: 60_000,
      }),
      consumeDistributedLimit({
        bucket: 'ai-tenant-minute',
        key: request.context.tenantId,
        limit: positiveInteger(process.env.CLARIFT_TENANT_RPM, 40),
        windowMs: 60_000,
      }),
    ]);
    if (!perUser.allowed || !perTenant.allowed) {
      const error = new Error('Clarift rate limit reached. Wait briefly and try again.');
      error.name = 'ManagedRateLimitError';
      throw error;
    }
    const concurrencyLimit = request.task === 'full_council'
      ? positiveInteger(process.env.CLARIFT_FULL_COUNCIL_CONCURRENCY, 1)
      : positiveInteger(process.env.CLARIFT_TASK_CONCURRENCY, 3);
    concurrency = await acquireConcurrencySlot({
      bucket: request.task,
      key: request.context.tenantId,
      limit: concurrencyLimit,
    });
    let credential = await resolveProviderCredential({
      context: request.context,
      mode,
      preferredProvider: request.preferredProvider,
    });
    if (mode === 'managed' && credential.provider !== 'local') {
      reservation = await reserveCredits({
        tenantId: request.context.tenantId,
        workspaceId: request.context.workspaceId,
        principalId: request.context.principalId,
        task: request.task,
        idempotencyKey: request.idempotencyKey,
        requestId,
      });
      if (reservation.status === 'settled') {
        const error = new Error('This managed request was already completed.');
        error.name = 'IdempotencyReplayError';
        throw error;
      }
    }
    const timeoutMs = positiveInteger(process.env.CLARIFT_PROVIDER_TIMEOUT_MS, 90_000);
    const runProvider = async () => {
      const currentProvider = credential.provider;
      provider = currentProvider;
      const remoteManagedProvider = mode === 'managed' && currentProvider !== 'local';
      if (mode === 'managed' && currentProvider !== 'local') await acquireProviderCircuit(currentProvider);
      try {
        const captured = await withTimeout(captureProviderUsage(() => executor(credential, requestId)), timeoutMs);
        providerUsage = captured.usage;
        if (mode === 'managed' && currentProvider !== 'local') await recordProviderSuccess(currentProvider).catch(() => undefined);
        return captured.result;
      } catch (error) {
        if (remoteManagedProvider && shouldCountProviderFailure(error)) {
          await recordProviderFailure(currentProvider, errorCode(error)).catch(() => undefined);
        }
        throw error;
      }
    };
    let result!: T;
    try {
      result = await runProvider();
    } catch (firstError) {
      const retries = request.task === 'full_council'
        ? 0
        : Math.min(positiveInteger(process.env.CLARIFT_PROVIDER_RETRIES, 1), 2);
      let lastError = firstError;
      if (retries > 0 && shouldRetryProvider(firstError)) {
        await sleep(250);
        try {
          result = await runProvider();
          lastError = null;
        } catch (retryError) {
          lastError = retryError;
        }
      }
      if (lastError) {
        if (mode !== 'managed' || !request.allowProviderFallback) throw lastError;
        if (
          credential.provider === 'gemini' &&
          process.env.ENABLE_MANAGED_OPENROUTER === 'true' &&
          shouldRetryProvider(lastError)
        ) {
          try {
            credential = await resolveProviderCredential({ context: request.context, mode, preferredProvider: 'openrouter' });
            result = await runProvider();
            lastError = null;
          } catch (openRouterError) {
            lastError = openRouterError;
          }
        }
        if (lastError && process.env.ENABLE_LOCAL_INFERENCE_FALLBACK === 'true') {
          credential = localFallbackCredential();
          result = await runProvider();
          lastError = null;
        }
        if (lastError) throw lastError;
      }
    }
    const completedProvider = credential.provider;
    creditsCharged = mode === 'managed' && completedProvider !== 'local' ? taskCost(request.task) : 0;
    if (reservation) await settleCredits(reservation.id, creditsCharged);
    await idempotencyRef.set({
      status: 'succeeded',
      provider: completedProvider,
      creditsCharged,
      completedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }, { merge: true });
    await recordTenantUsage({
      requestId,
      tenantId: request.context.tenantId,
      workspaceId: request.context.workspaceId,
      principalId: request.context.principalId,
      task: request.task,
      inferenceMode: mode,
      provider: completedProvider,
      inputTokens: providerUsage.inputTokens,
      outputTokens: providerUsage.outputTokens,
      providerCostUsd: providerUsage.costUsd,
      creditsCharged,
      status: 'succeeded',
      latencyMs: Date.now() - startedAt,
      source: request.source,
    });
    return { result, requestId, creditsCharged, provider: completedProvider };
  } catch (error) {
    if (reservation) await releaseCredits(reservation.id).catch(() => undefined);
    await idempotencyRef.set({
      status: 'failed',
      errorCode: errorCode(error),
      updatedAt: Timestamp.now(),
      expiresAt: Timestamp.now(),
    }, { merge: true }).catch(() => undefined);
    await recordTenantUsage({
      requestId,
      tenantId: request.context.tenantId,
      workspaceId: request.context.workspaceId,
      principalId: request.context.principalId,
      task: request.task,
      inferenceMode: mode,
      provider,
      creditsCharged: 0,
      status: 'failed',
      latencyMs: Date.now() - startedAt,
      source: request.source,
      errorCode: errorCode(error),
    }).catch(() => undefined);
    throw error;
  } finally {
    if (concurrency) await releaseConcurrencySlot(concurrency).catch(() => undefined);
  }
}

export async function executeRefinement(input: GatewayTaskRequest & {
  refinement: Omit<RefinePromptWithAICouncilInput, 'apiKey' | 'openRouterApiKey' | 'provider' | 'executionMode'>;
}): Promise<{ result: RefinePromptWithAICouncilOutput; requestId: string; creditsCharged: number; provider: GatewayProvider } & GatewayPublicMetadata> {
  if (!['quick_refine', 'guided_fix', 'full_council'].includes(input.task)) throw new Error('Invalid refinement task.');
  const executionMode = input.task as 'quick_refine' | 'guided_fix' | 'full_council';
  if ((input.inferenceMode ?? 'managed') === 'managed' && await tenantUsesFreeManagedInference(input.context)) {
    return executeFreeGatewayTask({
      context: input.context,
      task: executionMode,
      idempotencyKey: input.idempotencyKey,
      source: input.source,
      prepared: buildFreeRefinementRequest(executionMode, input.refinement),
      fallback: () => refinePromptLocally({ ...input.refinement, executionMode }),
    });
  }
  const gateway = await runGatewayTask({ ...input, allowProviderFallback: true }, async (credential) => {
    if (credential.provider === 'local') return refinePromptLocally({ ...input.refinement, executionMode });
    return refinePromptWithAICouncil({
      ...input.refinement,
      executionMode,
      provider: credential.provider,
      apiKey: credential.provider === 'gemini' ? credential.apiKey : undefined,
      openRouterApiKey: credential.provider === 'openrouter' ? credential.apiKey : undefined,
    });
  });
  const qualityTier = gateway.provider === 'local' ? 'fallback' : 'generative';
  return {
    ...gateway,
    qualityTier,
    allowance: await readFreeInferenceAllowance(
      input.context.tenantId,
      new Date(),
      await resolveInferenceAllowancePlan(input.context)
    ),
    ...(qualityTier === 'fallback' ? { basicMode: chooseBasicModeStatus({}) } : {}),
  };
}

export async function executeEvaluation(input: GatewayTaskRequest & { prompt: string; guidelines: string[] }): Promise<{
  result: BatchEvaluationOutput;
  requestId: string;
  creditsCharged: number;
  provider: GatewayProvider;
  qualityTier: InferenceQualityTier;
  allowance: FreeInferenceAllowance;
  basicMode?: BasicModeStatus;
}> {
  if ((input.inferenceMode ?? 'managed') === 'managed' && await tenantUsesFreeManagedInference(input.context)) {
    return executeFreeGatewayTask({
      context: input.context,
      task: 'evaluate',
      idempotencyKey: input.idempotencyKey,
      source: input.source,
      prepared: buildFreeEvaluationRequest(input.prompt, input.guidelines),
      fallback: () => evaluatePromptLocally(input.prompt, input.guidelines),
    });
  }
  const gateway = await runGatewayTask({ ...input, task: 'evaluate', preferredProvider: 'gemini', allowProviderFallback: true }, async (credential) => {
    if (credential.provider === 'local') return evaluatePromptLocally(input.prompt, input.guidelines);
    if (credential.provider !== 'gemini') {
      const error = new Error('Evaluation currently requires Gemini.');
      error.name = 'ProviderNotSupportedError';
      throw error;
    }
    return evaluatePromptGuidelinesBatch({ prompt: input.prompt, guidelines: input.guidelines, apiKey: credential.apiKey });
  });
  const qualityTier = gateway.provider === 'local' ? 'fallback' : 'generative';
  return {
    ...gateway,
    qualityTier,
    allowance: await readFreeInferenceAllowance(
      input.context.tenantId,
      new Date(),
      await resolveInferenceAllowancePlan(input.context)
    ),
    ...(qualityTier === 'fallback' ? { basicMode: chooseBasicModeStatus({}) } : {}),
  };
}
