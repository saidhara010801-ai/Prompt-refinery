export class EmptyAIOutputError extends Error {
  constructor(flowName: string) {
    super(`${flowName} did not return structured output. Please try again.`);
    this.name = 'EmptyAIOutputError';
  }
}

export function requireFlowOutput<T>(output: T | null | undefined, flowName: string): T {
  if (!output) {
    throw new EmptyAIOutputError(flowName);
  }

  return output;
}
