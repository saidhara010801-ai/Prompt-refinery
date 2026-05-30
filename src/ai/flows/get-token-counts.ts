'use server';
/**
 * @fileOverview Deterministic token count estimates for common LLM families.
 *
 * - getTokenCounts - A function that provides token count estimations.
 * - GetTokenCountsInput - The input type for the getTokenCounts function.
 * - GetTokenCountsOutput - The return type for the getTokenCounts function.
 */

import { z } from 'genkit';

const GetTokenCountsInputSchema = z.object({
  text: z.string().describe('The text to be tokenized.'),
  apiKey: z.string().optional().describe('Ignored for deterministic token estimation.'),
});
export type GetTokenCountsInput = z.infer<typeof GetTokenCountsInputSchema>;

const GetTokenCountsOutputSchema = z.object({
  gemini: z.number().describe('Estimated token count for Google Gemini models.'),
  openai: z.number().describe('Estimated token count for OpenAI GPT models.'),
  deepseek: z.number().describe('Estimated token count for DeepSeek models.'),
  qwen: z.number().describe('Estimated token count for Qwen models.'),
});
export type GetTokenCountsOutput = z.infer<typeof GetTokenCountsOutputSchema>;

function estimateBaseTokens(text: string): number {
  const trimmed = text.trim();

  if (!trimmed) {
    return 0;
  }

  const wordLikeSegments = trimmed.match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
  const characterEstimate = Math.ceil(trimmed.length / 4);
  const segmentEstimate = Math.ceil(wordLikeSegments.length * 1.25);

  return Math.max(1, Math.round((characterEstimate + segmentEstimate) / 2));
}

export async function getTokenCounts(input: GetTokenCountsInput): Promise<GetTokenCountsOutput> {
  const parsed = GetTokenCountsInputSchema.parse(input);
  const baseTokens = estimateBaseTokens(parsed.text);

  return GetTokenCountsOutputSchema.parse({
    gemini: baseTokens,
    openai: Math.max(0, Math.round(baseTokens * 1.05)),
    deepseek: Math.max(0, Math.round(baseTokens * 1.08)),
    qwen: Math.max(0, Math.round(baseTokens * 1.1)),
  });
}
