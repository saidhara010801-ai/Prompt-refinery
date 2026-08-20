import { z } from 'zod';

export type OpenModelProvider = 'openrouter' | 'together';

export interface OpenModelUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

export interface OpenModelCompletion {
  content: string;
  finishReason: string | null;
  usage: OpenModelUsage;
}

interface OpenModelCompletionInput {
  provider: OpenModelProvider;
  apiKey: string;
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  maxTokens: number;
  timeoutMs: number;
  responseSchema?: { name: string; schema: Record<string, unknown> };
  providerSort?: 'price' | 'throughput' | 'latency';
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high';
}

const ResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().nullable() }),
    finish_reason: z.string().nullable().optional(),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    cost: z.union([z.number(), z.string()]).optional(),
  }).optional(),
});

export class OpenModelProviderError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'OpenModelProviderError';
  }
}

export class ProviderSchemaError extends Error {
  constructor(message = 'The provider response did not match the required schema.') {
    super(message);
    this.name = 'ProviderSchemaError';
  }
}

function endpoint(provider: OpenModelProvider) {
  return provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.together.ai/v1/chat/completions';
}

export async function createOpenModelCompletion(input: OpenModelCompletionInput): Promise<OpenModelCompletion> {
  if (!input.apiKey.trim()) throw new OpenModelProviderError('The managed provider credential is unavailable.', 503);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  let response: Response;
  let responseText = '';
  try {
    const messages = input.provider === 'together' && input.responseSchema
      ? [...input.messages, {
          role: 'user' as const,
          content: `Return only a complete JSON object matching this schema exactly:\n${JSON.stringify(input.responseSchema.schema)}`,
        }]
      : input.messages;
    response = await fetch(endpoint(input.provider), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
        ...(input.provider === 'openrouter' ? {
          'HTTP-Referer': process.env.APP_BASE_URL || 'https://clarift--clarift-e4f6f.us-east4.hosted.app',
          'X-OpenRouter-Title': 'Clarift',
        } : {}),
      },
      body: JSON.stringify({
        model: input.model,
        messages,
        temperature: 0.2,
        max_tokens: input.maxTokens,
        ...(input.provider === 'openrouter' && input.reasoningEffort ? {
          reasoning: { effort: input.reasoningEffort },
        } : {}),
        ...(input.responseSchema ? {
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: input.responseSchema.name,
              strict: true,
              schema: input.responseSchema.schema,
            },
          },
          ...(input.provider === 'openrouter' ? { provider: {
            require_parameters: true,
            ...(input.providerSort ? { sort: input.providerSort } : {}),
          } } : {}),
        } : {}),
      }),
      signal: controller.signal,
    });
    responseText = await response.text();
  } catch {
    if (controller.signal.aborted) throw new OpenModelProviderError('The managed provider timed out.', 504);
    throw new OpenModelProviderError('The managed provider could not be reached.', 502);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new OpenModelProviderError(`The managed provider returned status ${response.status}.`, response.status);
  }
  if (responseText.length > 300_000) throw new OpenModelProviderError('The managed provider response was too large.', 502);

  let json: unknown;
  try {
    json = JSON.parse(responseText);
  } catch {
    throw new OpenModelProviderError('The managed provider returned an invalid response envelope.', 502);
  }
  const parsed = ResponseSchema.safeParse(json);
  if (!parsed.success) throw new OpenModelProviderError('The managed provider returned an unexpected response envelope.', 502);
  const choice = parsed.data.choices[0];
  if (!choice.message.content?.trim()) throw new ProviderSchemaError('The managed provider returned empty content.');
  return {
    content: choice.message.content,
    finishReason: choice.finish_reason ?? null,
    usage: {
      inputTokens: parsed.data.usage?.prompt_tokens ?? null,
      outputTokens: parsed.data.usage?.completion_tokens ?? null,
      costUsd: parsed.data.usage?.cost === undefined ? null : Number(parsed.data.usage.cost),
    },
  };
}

export function parseProviderJson<T>(text: string, schema: z.ZodType<T>): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  const json = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
  try {
    return schema.parse(JSON.parse(json));
  } catch {
    throw new ProviderSchemaError();
  }
}
