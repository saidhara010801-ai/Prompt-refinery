export type ClariftTask = 'quick_refine' | 'guided_fix' | 'full_council' | 'evaluate' | 'apply_fix' | 'convert_document';

const DEFAULT_TASK_COSTS: Record<ClariftTask, number> = {
  quick_refine: 1,
  guided_fix: 2,
  full_council: 5,
  evaluate: 1,
  apply_fix: 2,
  convert_document: 0,
};

function nonNegativeInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getTaskCosts(environment: Record<string, string | undefined> = process.env) {
  let configured: Partial<Record<ClariftTask, number>> = {};
  try {
    configured = environment.CLARIFT_TASK_COSTS_JSON ? JSON.parse(environment.CLARIFT_TASK_COSTS_JSON) : {};
  } catch {
    configured = {};
  }
  return Object.fromEntries(Object.entries(DEFAULT_TASK_COSTS).map(([task, cost]) => [
    task,
    nonNegativeInteger(configured[task as ClariftTask], cost),
  ])) as Record<ClariftTask, number>;
}

export function taskCost(task: ClariftTask, environment?: Record<string, string | undefined>) {
  return getTaskCosts(environment)[task];
}

export function hasManagedRemoteProvider(environment: Record<string, string | undefined> = process.env) {
  const gemini = environment.CLARIFT_GEMINI_API_KEY || environment.GEMINI_API_KEY || environment.GOOGLE_API_KEY;
  const openRouter = environment.ENABLE_MANAGED_OPENROUTER === 'true'
    ? environment.CLARIFT_OPENROUTER_API_KEY || environment.OPENROUTER_API_KEY
    : undefined;
  const freeOpenRouter = environment.ENABLE_FREE_MANAGED_INFERENCE === 'true'
    ? environment.CLARIFT_OPENROUTER_API_KEY || environment.OPENROUTER_API_KEY
    : undefined;
  const together = environment.ENABLE_FREE_MANAGED_INFERENCE === 'true'
    ? environment.CLARIFT_TOGETHER_API_KEY || environment.TOGETHER_API_KEY
    : undefined;
  const selfHostedGemma = environment.ENABLE_SELF_HOSTED_GEMMA === 'true' && environment.GEMMA_BASE_URL
    ? environment.GEMMA_API_KEY
    : undefined;
  return Boolean(gemini?.trim() || openRouter?.trim() || freeOpenRouter?.trim() || together?.trim() || selfHostedGemma?.trim());
}

export function isLocalInferenceFallbackActive(environment: Record<string, string | undefined> = process.env) {
  return environment.ENABLE_LOCAL_INFERENCE_FALLBACK === 'true' && !hasManagedRemoteProvider(environment);
}

export function getAdvertisedTaskCosts(environment: Record<string, string | undefined> = process.env) {
  const costs = getTaskCosts(environment);
  if (!isLocalInferenceFallbackActive(environment)) return costs;
  return {
    ...costs,
    quick_refine: 0,
    guided_fix: 0,
    full_council: 0,
    evaluate: 0,
    apply_fix: 0,
  };
}
