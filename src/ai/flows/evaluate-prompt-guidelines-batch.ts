'use server';

import { googleAI } from '@genkit-ai/google-genai';
import { z } from 'genkit';

import { ai, genkit, generation } from '@/ai/genkit';
import { requireFlowOutput } from './require-flow-output';
import { MAX_API_KEY_CHARACTERS, MAX_GUIDELINE_CHARACTERS, MAX_PROMPT_CHARACTERS } from '@/lib/input-limits';

const BatchEvaluationInputSchema = z.object({
  prompt: z.string().max(MAX_PROMPT_CHARACTERS),
  guidelines: z.array(z.string().max(MAX_GUIDELINE_CHARACTERS)).min(1).max(8),
  apiKey: z.string().max(MAX_API_KEY_CHARACTERS).optional(),
});
export type BatchEvaluationInput = z.infer<typeof BatchEvaluationInputSchema>;

const GuidelineResultSchema = z.object({
  guideline: z.string(),
  shouldInclude: z.boolean(),
  reason: z.string().max(4000),
  score: z.number().min(0).max(100),
  dimensionScores: z.object({
    clarity: z.number().min(0).max(100),
    context: z.number().min(0).max(100),
    structure: z.number().min(0).max(100),
    specificity: z.number().min(0).max(100),
  }),
  recommendations: z.array(z.string().max(2000)).max(10),
});

const BatchEvaluationOutputSchema = z.object({
  combinedScore: z.number().min(0).max(100),
  results: z.array(GuidelineResultSchema).min(1).max(8),
});
export type BatchEvaluationOutput = z.infer<typeof BatchEvaluationOutputSchema>;

const promptText = `You are an expert prompt evaluator. Evaluate the current prompt against every requested guideline in one pass.

Current prompt:
{{{prompt}}}

Guidelines:
{{#each guidelines}}- {{{this}}}
{{/each}}

Return one result per guideline in the same order. Scores are integers from 0 to 100. Recommendations must be concrete edits. combinedScore is the average overall quality after considering all requested guidelines.`;

const managedPrompt = ai.definePrompt({
  name: 'evaluatePromptGuidelinesBatchPrompt',
  input: { schema: BatchEvaluationInputSchema },
  output: { schema: BatchEvaluationOutputSchema },
  prompt: promptText,
});

export async function evaluatePromptGuidelinesBatch(input: BatchEvaluationInput): Promise<BatchEvaluationOutput> {
  const parsed = BatchEvaluationInputSchema.parse(input);
  if (parsed.apiKey) {
    const customAi = genkit({ plugins: [googleAI({ apiKey: parsed.apiKey })], model: generation });
    const dynamicPrompt = customAi.definePrompt({
      name: 'evaluatePromptGuidelinesBatchPromptCustom',
      input: { schema: BatchEvaluationInputSchema },
      output: { schema: BatchEvaluationOutputSchema },
      prompt: promptText,
    });
    const { output } = await dynamicPrompt(parsed);
    return requireFlowOutput(output, 'Batch guideline evaluation');
  }
  const { output } = await managedPrompt(parsed);
  return requireFlowOutput(output, 'Batch guideline evaluation');
}
