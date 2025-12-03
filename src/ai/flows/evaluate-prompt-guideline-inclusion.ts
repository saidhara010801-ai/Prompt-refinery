'use server';
/**
 * @fileOverview A flow that evaluates whether to include a specific LLM council guideline in a prompt.
 *
 * - evaluatePromptGuidelineInclusion - A function that determines if a given LLM council guideline should be included in a prompt.
 * - EvaluatePromptGuidelineInclusionInput - The input type for the evaluatePromptGuidelineInclusion function.
 * - EvaluatePromptGuidelineInclusionOutput - The return type for the evaluatePromptGuidelineInclusion function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

const EvaluatePromptGuidelineInclusionInputSchema = z.object({
  prompt: z.string().describe('The current prompt being refined.'),
  guideline: z.string().describe('The specific LLM council guideline to evaluate for inclusion.'),
  userQuery: z.string().describe('The original user query that the prompt is intended to address.'),
  apiKey: z.string().optional().describe('The user-provided Gemini API key.'),
});
export type EvaluatePromptGuidelineInclusionInput = z.infer<typeof EvaluatePromptGuidelineInclusionInputSchema>;

const EvaluatePromptGuidelineInclusionOutputSchema = z.object({
  shouldInclude: z.boolean().describe('Whether the guideline should be included in the prompt.'),
  reason: z.string().describe('The reason for the decision, explaining why the guideline is relevant or irrelevant.'),
});
export type EvaluatePromptGuidelineInclusionOutput = z.infer<typeof EvaluatePromptGuidelineInclusionOutputSchema>;

const evaluatePromptGuidelineInclusionPrompt = ai.definePrompt({
  name: 'evaluatePromptGuidelineInclusionPrompt',
  input: { schema: EvaluatePromptGuidelineInclusionInputSchema },
  output: { schema: EvaluatePromptGuidelineInclusionOutputSchema },
  prompt: `You are an expert prompt engineer, tasked with evaluating whether a specific guideline from the LLM council should be included in a prompt.
The goal is to determine if the guideline will improve the prompt's effectiveness in addressing the original user query.

Original User Query: {{{userQuery}}}
Current Prompt: {{{prompt}}}
Guideline to Evaluate: {{{guideline}}}

First, reason step-by-step whether the guideline is relevant to the current prompt and user query. Consider the potential impact of the guideline on the prompt's clarity, focus, and overall quality.
Finally, based on your reasoning, determine whether the guideline should be included in the prompt.

Respond with a JSON object in the following format:
{
  "shouldInclude": true/false,
  "reason": "Explanation of why the guideline should or should not be included."
}`,
});

const evaluatePromptGuidelineInclusionFlow = ai.defineFlow(
  {
    name: 'evaluatePromptGuidelineInclusionFlow',
    inputSchema: EvaluatePromptGuidelineInclusionInputSchema,
    outputSchema: EvaluatePromptGuidelineInclusionOutputSchema,
  },
  async (input) => {
    const { output } = await evaluatePromptGuidelineInclusionPrompt(input);
    return output!;
  }
);


export async function evaluatePromptGuidelineInclusion(input: EvaluatePromptGuidelineInclusionInput): Promise<EvaluatePromptGuidelineInclusionOutput> {
  const flowOptions = input.apiKey ? { plugins: [googleAI({ apiKey: input.apiKey })] } : {};
  return evaluatePromptGuidelineInclusionFlow(input, flowOptions);
}
