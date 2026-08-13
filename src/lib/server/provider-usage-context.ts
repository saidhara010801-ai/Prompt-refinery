import { AsyncLocalStorage } from 'node:async_hooks';

interface ProviderUsageAggregate {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

const usageStorage = new AsyncLocalStorage<ProviderUsageAggregate>();

export function recordOpenRouterUsage(input: { inputTokens?: number; outputTokens?: number; costUsd?: number }) {
  const aggregate = usageStorage.getStore();
  if (!aggregate) return;
  aggregate.inputTokens += Number.isFinite(input.inputTokens) ? Number(input.inputTokens) : 0;
  aggregate.outputTokens += Number.isFinite(input.outputTokens) ? Number(input.outputTokens) : 0;
  aggregate.costUsd += Number.isFinite(input.costUsd) ? Number(input.costUsd) : 0;
}

export async function captureProviderUsage<T>(operation: () => Promise<T>) {
  const aggregate: ProviderUsageAggregate = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const result = await usageStorage.run(aggregate, operation);
  return {
    result,
    usage: {
      inputTokens: aggregate.inputTokens || null,
      outputTokens: aggregate.outputTokens || null,
      costUsd: aggregate.costUsd || null,
    },
  };
}
