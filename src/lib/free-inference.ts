export type FreeInferenceTask = 'quick_refine' | 'guided_fix' | 'full_council' | 'evaluate';

export type InferenceQualityTier = 'generative' | 'fallback';

export type BasicModeReason =
  | 'daily_limit'
  | 'monthly_limit'
  | 'budget_limit'
  | 'request_size'
  | 'service_busy';

export interface AllowancePeriod {
  limit: number;
  used: number;
  reserved: number;
  remaining: number;
  resetAt: string;
}
export interface FreeInferenceAllowance {
  refinement: { daily: AllowancePeriod; monthly: AllowancePeriod };
  evaluation: { daily: AllowancePeriod; monthly: AllowancePeriod };
}

export interface BasicModeStatus {
  reason: BasicModeReason;
  resetScope: 'daily' | 'monthly' | null;
  resetAt: string | null;
}

export interface PublicInferenceMetadata {
  contractVersion: 2;
  requestId: string;
  creditsCharged: number;
  qualityTier: InferenceQualityTier;
  allowance: FreeInferenceAllowance;
  basicMode?: BasicModeStatus;
}

export const FREE_REFINEMENT_DAILY_UNITS = 10;
export const FREE_REFINEMENT_MONTHLY_UNITS = 200;
export const FREE_EVALUATION_DAILY_UNITS = 5;
export const FREE_EVALUATION_MONTHLY_UNITS = 100;
export const FREE_INPUT_TOKEN_LIMIT = 2048;

export const FREE_TASK_UNITS: Record<FreeInferenceTask, number> = {
  quick_refine: 1,
  guided_fix: 2,
  full_council: 3,
  evaluate: 1,
};

export const FREE_TASK_OUTPUT_TOKENS: Record<FreeInferenceTask, number> = {
  quick_refine: 1024,
  guided_fix: 1536,
  full_council: 2048,
  evaluate: 1024,
};

export function taskAllowanceKind(task: FreeInferenceTask) {
  return task === 'evaluate' ? 'evaluation' as const : 'refinement' as const;
}

export function nextUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export function nextUtcMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export function quotaPeriodKeys(now = new Date()) {
  return {
    day: now.toISOString().slice(0, 10),
    month: now.toISOString().slice(0, 7),
    dayResetAt: nextUtcDay(now),
    monthResetAt: nextUtcMonth(now),
  };
}

export function chooseBasicModeStatus(input: {
  requestTooLarge?: boolean;
  monthlyLimit?: boolean;
  dailyLimit?: boolean;
  budgetLimit?: boolean;
  dayResetAt?: Date;
  monthResetAt?: Date;
}): BasicModeStatus {
  if (input.requestTooLarge) return { reason: 'request_size', resetScope: null, resetAt: null };
  if (input.monthlyLimit) return {
    reason: 'monthly_limit',
    resetScope: 'monthly',
    resetAt: (input.monthResetAt ?? nextUtcMonth()).toISOString(),
  };
  if (input.dailyLimit) return {
    reason: 'daily_limit',
    resetScope: 'daily',
    resetAt: (input.dayResetAt ?? nextUtcDay()).toISOString(),
  };
  if (input.budgetLimit) return {
    reason: 'budget_limit',
    resetScope: 'daily',
    resetAt: (input.dayResetAt ?? nextUtcDay()).toISOString(),
  };
  return { reason: 'service_busy', resetScope: null, resetAt: null };
}

export function estimateSerializedTokens(value: unknown) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.max(1, Math.ceil(serialized.length / 3.5));
}

export function priceForMaximumAttempt(input: {
  inputTokens: number;
  outputTokens: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}) {
  return (input.inputTokens * input.inputUsdPerMillion + input.outputTokens * input.outputUsdPerMillion) / 1_000_000;
}
