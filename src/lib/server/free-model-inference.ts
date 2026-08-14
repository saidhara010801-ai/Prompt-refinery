import { z } from 'zod';

import type { RefinePromptWithAICouncilInput, RefinePromptWithAICouncilOutput } from '@/ai/flows/refine-prompt-with-ai-council';
import type { BatchEvaluationOutput } from '@/ai/flows/evaluate-prompt-guidelines-batch';
import { FREE_TASK_OUTPUT_TOKENS, type FreeInferenceTask } from '@/lib/free-inference';

const CouncilMemberSchema = z.object({
  councilMember: z.string().min(1).max(160),
  thoughtProcess: z.string().min(1).max(4000),
  refinedText: z.string().min(1).max(60000),
});

export const FreeRefinementOutputSchema = z.object({
  refinedPrompt: z.string().min(1).max(60000),
  refinements: z.array(CouncilMemberSchema).min(1).max(5),
});

const DimensionScoresSchema = z.object({
  clarity: z.number().min(0).max(100),
  context: z.number().min(0).max(100),
  structure: z.number().min(0).max(100),
  specificity: z.number().min(0).max(100),
});

export const FreeEvaluationOutputSchema = z.object({
  combinedScore: z.number().min(0).max(100),
  results: z.array(z.object({
    guideline: z.string().min(1),
    shouldInclude: z.boolean(),
    reason: z.string().min(1).max(4000),
    score: z.number().min(0).max(100),
    dimensionScores: DimensionScoresSchema,
    recommendations: z.array(z.string().min(1).max(2000)).max(10),
  })).min(1).max(8),
});

function refinementJsonSchema(roleCount: number): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['refinedPrompt', 'refinements'],
    properties: {
      refinedPrompt: { type: 'string', maxLength: 12000 },
      refinements: {
        type: 'array',
        minItems: roleCount,
        maxItems: roleCount,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['councilMember', 'thoughtProcess', 'refinedText'],
          properties: {
            councilMember: { type: 'string', maxLength: 160 },
            thoughtProcess: { type: 'string', maxLength: 400 },
            refinedText: { type: 'string', maxLength: 12000 },
          },
        },
      },
    },
  };
}

const evaluationJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['combinedScore', 'results'],
  properties: {
    combinedScore: { type: 'number', minimum: 0, maximum: 100 },
    results: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['guideline', 'shouldInclude', 'reason', 'score', 'dimensionScores', 'recommendations'],
        properties: {
          guideline: { type: 'string' },
          shouldInclude: { type: 'boolean' },
          reason: { type: 'string' },
          score: { type: 'number', minimum: 0, maximum: 100 },
          dimensionScores: {
            type: 'object',
            additionalProperties: false,
            required: ['clarity', 'context', 'structure', 'specificity'],
            properties: {
              clarity: { type: 'number', minimum: 0, maximum: 100 },
              context: { type: 'number', minimum: 0, maximum: 100 },
              structure: { type: 'number', minimum: 0, maximum: 100 },
              specificity: { type: 'number', minimum: 0, maximum: 100 },
            },
          },
          recommendations: { type: 'array', maxItems: 10, items: { type: 'string' } },
        },
      },
    },
  },
};

const roleNames: Record<Exclude<FreeInferenceTask, 'evaluate'>, string[]> = {
  quick_refine: ['The Specifier'],
  guided_fix: ['The Specifier', 'The Simplifier', 'The Critic'],
  full_council: ['The Specifier', 'The Simplifier', 'The Stylist', 'The Critic', 'The Formatter'],
};

function attachmentText(input: RefinePromptWithAICouncilInput) {
  if (!input.attachments?.length) return '';
  return `\nReference material:\n${input.attachments.map((attachment) => `--- ${attachment.name} (${attachment.mimeType}) ---\n${attachment.content}`).join('\n')}`;
}

export function buildFreeRefinementRequest(
  task: Exclude<FreeInferenceTask, 'evaluate'>,
  input: Omit<RefinePromptWithAICouncilInput, 'apiKey' | 'openRouterApiKey' | 'provider' | 'executionMode'>
) {
  const roles = roleNames[task];
  const system = `You are Clarift, an expert prompt-refinement system. Improve prompts for clarity, context, specificity, constraints, and useful output structure. Produce only the requested JSON object. Do not reveal hidden reasoning or chain-of-thought. Keep every thoughtProcess under 240 characters and every intermediate refinedText concise. Return exactly ${roles.length} refinement entries in this order: ${roles.join(', ')}.`;
  const user = `Refine the prompt using the ${input.promptType} technique and the ${task} mode.

Original prompt:
"""
${input.prompt}
"""
${input.maxCharacters ? `The final refined prompt must not exceed ${input.maxCharacters} characters.` : ''}
${input.projectMemory ? `Relevant project memory:\n"""\n${input.projectMemory}\n"""` : ''}
${attachmentText(input)}

Use project memory and references only when relevant. If the selected technique is ReAct or chain-of-thought, write a prompt that instructs the downstream model to use that method; do not perform or expose hidden reasoning yourself. The final prompt must be copy-ready and preserve the user's intent.`;
  return {
    messages: [{ role: 'system' as const, content: system }, { role: 'user' as const, content: user }],
    schema: { name: 'clarift_refinement', schema: refinementJsonSchema(roles.length) },
    outputSchema: FreeRefinementOutputSchema as z.ZodType<RefinePromptWithAICouncilOutput>,
    maxTokens: FREE_TASK_OUTPUT_TOKENS[task],
  };
}

export function buildFreeEvaluationRequest(prompt: string, guidelines: string[]) {
  const system = 'You are Clarift, an expert prompt evaluator. Evaluate each requested guideline in one pass. Return only the requested JSON object. Reasons are concise user-facing conclusions, not hidden reasoning.';
  const user = `Current prompt:\n"""\n${prompt}\n"""\n\nGuidelines, in required response order:\n${guidelines.map((guideline, index) => `${index + 1}. ${guideline}`).join('\n')}\n\nReturn one result per guideline in the same order. Use integer scores from 0 to 100 and concrete recommendations. combinedScore is the overall average.`;
  return {
    messages: [{ role: 'system' as const, content: system }, { role: 'user' as const, content: user }],
    schema: { name: 'clarift_evaluation', schema: evaluationJsonSchema },
    outputSchema: FreeEvaluationOutputSchema as z.ZodType<BatchEvaluationOutput>,
    maxTokens: FREE_TASK_OUTPUT_TOKENS.evaluate,
  };
}
