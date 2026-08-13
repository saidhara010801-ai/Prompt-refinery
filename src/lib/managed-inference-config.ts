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
