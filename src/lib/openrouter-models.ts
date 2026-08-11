export interface OpenRouterModels {
  specifier: string;
  simplifier: string;
  stylist: string;
  critic: string;
  formatter: string;
}

export const DEFAULT_OPENROUTER_MODELS: OpenRouterModels = {
  specifier: 'openai/gpt-4o-mini',
  simplifier: 'anthropic/claude-3.5-haiku',
  stylist: 'google/gemini-2.0-flash-001',
  critic: 'anthropic/claude-3.5-haiku',
  formatter: 'openai/gpt-4o-mini',
};

export function withDefaultOpenRouterModels(models?: Partial<OpenRouterModels>): OpenRouterModels {
  return {
    specifier: models?.specifier || DEFAULT_OPENROUTER_MODELS.specifier,
    simplifier: models?.simplifier || DEFAULT_OPENROUTER_MODELS.simplifier,
    stylist: models?.stylist || DEFAULT_OPENROUTER_MODELS.stylist,
    critic: models?.critic || DEFAULT_OPENROUTER_MODELS.critic,
    formatter: models?.formatter || DEFAULT_OPENROUTER_MODELS.formatter,
  };
}
