'use server';
/**
 * @fileOverview A flow that evaluates whether to include a specific LLM council guideline in a prompt.
 *
 * - evaluatePromptGuidelineInclusion - A function that determines if a given LLM council guideline should be included in a prompt.
 * - EvaluatePromptGuidelineInclusionInput - The input type for the evaluatePromptGuidelineInclusion function.
 * - EvaluatePromptGuidelineInclusionOutput - The return type for the evaluatePromptGuidelineInclusion function.
 */

import { ai, genkit, generation } from '@/ai/genkit';
import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { requireFlowOutput } from './require-flow-output';
import {
  MAX_API_KEY_CHARACTERS,
  MAX_GUIDELINE_CHARACTERS,
  MAX_PROMPT_CHARACTERS,
} from '@/lib/input-limits';

const EvaluatePromptGuidelineInclusionInputSchema = z.object({
  prompt: z.string().max(MAX_PROMPT_CHARACTERS).describe('The current prompt being refined.'),
  guideline: z.string().max(MAX_GUIDELINE_CHARACTERS).describe('The specific LLM council guideline to evaluate for inclusion.'),
  userQuery: z.string().max(MAX_PROMPT_CHARACTERS).describe('The original user query that the prompt is intended to address.'),
  apiKey: z.string().max(MAX_API_KEY_CHARACTERS).optional().describe('The user-provided Gemini API key.'),
});
export type EvaluatePromptGuidelineInclusionInput = z.infer<typeof EvaluatePromptGuidelineInclusionInputSchema>;

const EvaluatePromptGuidelineInclusionOutputSchema = z.object({
  shouldInclude: z.boolean().describe('Whether the guideline should be included in the prompt.'),
  reason: z.string().max(4000).describe('The reason for the decision, explaining why the guideline is relevant or irrelevant.'),
  score: z.number().min(0).max(100).describe('Overall prompt quality score for this guideline.'),
  dimensionScores: z.object({
    clarity: z.number().min(0).max(100),
    context: z.number().min(0).max(100),
    structure: z.number().min(0).max(100),
    specificity: z.number().min(0).max(100),
  }).describe('Sub-dimension scores for prompt quality.'),
  recommendations: z.array(z.string().max(2000)).max(10).describe('Concrete prompt improvements.'),
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
  "reason": "Explanation of why the guideline should or should not be included.",
  "score": 0-100,
  "dimensionScores": {
    "clarity": 0-100,
    "context": 0-100,
    "structure": 0-100,
    "specificity": 0-100
  },
  "recommendations": ["Concrete improvement 1", "Concrete improvement 2"]
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
    return requireFlowOutput(output, 'Guideline evaluation');
  }
);


export async function evaluatePromptGuidelineInclusion(input: EvaluatePromptGuidelineInclusionInput): Promise<EvaluatePromptGuidelineInclusionOutput> {
  if (input.apiKey) {
    const customAi = genkit({
      plugins: [googleAI({ apiKey: input.apiKey })],
      model: generation,
    });
    const dynamicPrompt = customAi.definePrompt({
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
  "reason": "Explanation of why the guideline should or should not be included.",
  "score": 0-100,
  "dimensionScores": {
    "clarity": 0-100,
    "context": 0-100,
    "structure": 0-100,
    "specificity": 0-100
  },
  "recommendations": ["Concrete improvement 1", "Concrete improvement 2"]
}`,
    });
    const { output } = await dynamicPrompt(input);
    return requireFlowOutput(output, 'Guideline evaluation');
  }
  return evaluatePromptGuidelineInclusionFlow(input);
}
