import { z } from 'genkit';

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_OPENROUTER_RESPONSE_CHARACTERS = 300000;

const OpenRouterChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

type OpenRouterChatMessage = z.infer<typeof OpenRouterChatMessageSchema>;

const OpenRouterChatResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string().nullable(),
      }),
      finish_reason: z.string().optional().nullable(),
    })
  ),
});

interface OpenRouterChatInput {
  apiKey: string;
  model: string;
  messages: OpenRouterChatMessage[];
  temperature?: number;
}

export class OpenRouterError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

export async function createOpenRouterChatCompletion(input: OpenRouterChatInput): Promise<string> {
  if (!input.apiKey?.trim()) {
    throw new OpenRouterError('OpenRouter API key is missing.');
  }

  const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/saidhara010801-ai/Prompt-refinery',
      'X-OpenRouter-Title': 'The Prompt Refinery',
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      temperature: input.temperature ?? 0.3,
      response_format: { type: 'json_object' },
    }),
  });

  const responseText = await response.text();
  if (responseText.length > MAX_OPENROUTER_RESPONSE_CHARACTERS) {
    throw new OpenRouterError('OpenRouter returned a response that was too large.', response.status);
  }

  if (!response.ok) {
    throw new OpenRouterError(responseText || `OpenRouter request failed with status ${response.status}.`, response.status);
  }

  let responseJson: unknown;
  try {
    responseJson = JSON.parse(responseText);
  } catch {
    throw new OpenRouterError('OpenRouter returned a non-JSON response.', response.status);
  }

  const parsed = OpenRouterChatResponseSchema.safeParse(responseJson);
  if (!parsed.success) {
    throw new OpenRouterError('OpenRouter returned an unexpected response shape.');
  }

  const content = parsed.data.choices[0]?.message.content;
  if (!content) {
    throw new OpenRouterError('OpenRouter returned an empty response.');
  }

  return content;
}

export function parseJsonObject<T>(text: string, schema: z.ZodType<T>, label: string): T {
  const fencedJson = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fencedJson ?? text;

  try {
    return schema.parse(JSON.parse(candidate));
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');

    if (start === -1 || end === -1 || end <= start) {
      throw new OpenRouterError(`${label} was not valid JSON.`);
    }

    try {
      return schema.parse(JSON.parse(candidate.slice(start, end + 1)));
    } catch {
      throw new OpenRouterError(`${label} did not match the expected JSON schema.`);
    }
  }
}
