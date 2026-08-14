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

const councilLabelPattern = /^(?:the\s+)?(?:specifier|simplifier|stylist|critic|formatter)\s*:\s*/i;

function normalizedPrompt(value: string) {
  return value
    .trim()
    .replace(councilLabelPattern, '')
    .replace(/^["'`]+|["'`,;]+$/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function hasSerializationWrapper(value: string) {
  const trimmed = value.trim();
  if (councilLabelPattern.test(trimmed)) return true;
  const withoutComma = trimmed.endsWith(',') ? trimmed.slice(0, -1).trimEnd() : trimmed;
  const opening = withoutComma[0];
  return Boolean(opening && ['"', "'", '`'].includes(opening) && withoutComma.at(-1) === opening);
}

function refinementOutputSchema(roles: string[], maxCharacters?: number) {
  return FreeRefinementOutputSchema.superRefine((output, context) => {
    if (output.refinements.length !== roles.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['refinements'], message: 'The council response has the wrong number of passes.' });
      return;
    }

    output.refinements.forEach((refinement, index) => {
      if (refinement.councilMember.trim().toLowerCase() !== roles[index].toLowerCase()) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['refinements', index, 'councilMember'], message: 'The council passes are not in the required order.' });
      }
    });

    const finalPrompt = output.refinedPrompt.trim();
    if (hasSerializationWrapper(finalPrompt)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['refinedPrompt'], message: 'The final prompt contains an intermediate-pass wrapper.' });
    }
    if (maxCharacters && finalPrompt.length > maxCharacters) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['refinedPrompt'], message: 'The final prompt exceeds the requested character limit.' });
    }

    if (roles.length > 1) {
      const normalizedFinal = normalizedPrompt(finalPrompt);
      if (output.refinements.some((refinement) => normalizedPrompt(refinement.refinedText) === normalizedFinal)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['refinedPrompt'], message: 'The final prompt must synthesize the council passes.' });
      }
    }
  });
}

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

function refinementJsonSchema(roles: string[], maxCharacters?: number): Record<string, unknown> {
  const roleCount = roles.length;
  const finalMaximum = Math.min(maxCharacters ?? 12000, 12000);
  const synthesisDescription = roleCount === 1
    ? 'The final copy-ready prompt only. Do not add a council label, quotation wrapper, explanation, or trailing punctuation outside the prompt.'
    : `A new final copy-ready prompt synthesized from all ${roleCount} council passes. It must not copy any single refinedText or include a council label, quotation wrapper, explanation, or trailing punctuation outside the prompt.`;
  return {
    type: 'object',
    additionalProperties: false,
    required: ['refinedPrompt', 'refinements'],
    properties: {
      refinedPrompt: { type: 'string', maxLength: finalMaximum, description: synthesisDescription },
      refinements: {
        type: 'array',
        minItems: roleCount,
        maxItems: roleCount,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['councilMember', 'thoughtProcess', 'refinedText'],
          properties: {
            councilMember: { type: 'string', enum: roles, description: `Use the required council names in this exact order: ${roles.join(', ')}.` },
            thoughtProcess: { type: 'string', maxLength: 400, description: 'A concise user-facing summary of changes, without hidden reasoning.' },
            refinedText: { type: 'string', maxLength: 12000, description: 'This council member\'s intermediate copy-ready proposal. Do not prefix it with the council member name or wrap it in quotes.' },
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
  const system = `You are Clarift, an expert prompt-refinement system. Improve prompts for clarity, context, specificity, constraints, and useful output structure.

Council responsibilities:
- The Specifier makes intent, context, constraints, audience, and success criteria explicit.
- The Simplifier removes unnecessary complexity and organizes instructions into an executable flow.
- The Stylist improves role, tone, format, and audience fit.
- The Critic identifies gaps and repairs them in its proposed prompt without introducing a different prompting technique.
- The Formatter produces a reusable, copy-ready structure.

Return exactly ${roles.length} intermediate refinement entries in this order: ${roles.join(', ')}. After completing those passes, set refinedPrompt to one final prompt that incorporates their strongest compatible improvements. For multi-pass modes, refinedPrompt must be a new synthesis and must not equal any single refinedText.

Produce only the requested JSON object. The refinedPrompt and refinedText values must contain prompt text only: no council labels, quotation wrappers, explanations, or trailing commas. Do not reveal hidden reasoning or chain-of-thought. Keep every thoughtProcess under 240 characters and every intermediate refinedText concise. Apply only the user's selected prompting technique; council roles are review functions, not permission to introduce other techniques.`;
  const user = `Refine the prompt using the ${input.promptType} technique and the ${task} mode.

Original prompt:
"""
${input.prompt}
"""
${input.maxCharacters ? `The final refined prompt must not exceed ${input.maxCharacters} characters.` : ''}
${input.projectMemory ? `Relevant project memory:\n"""\n${input.projectMemory}\n"""` : ''}
${attachmentText(input)}

Use project memory and references only when relevant. If the selected technique is ReAct or chain-of-thought, write a prompt that instructs the downstream model to use that method without requesting hidden reasoning. Do not introduce ReAct, chain-of-thought, tree-of-thoughts, or another technique unless it is the selected technique. The final prompt must be copy-ready, preserve the user's intent, respect the character limit, and synthesize every required council pass.`;
  return {
    messages: [{ role: 'system' as const, content: system }, { role: 'user' as const, content: user }],
    schema: { name: 'clarift_refinement', schema: refinementJsonSchema(roles, input.maxCharacters) },
    outputSchema: refinementOutputSchema(roles, input.maxCharacters) as z.ZodType<RefinePromptWithAICouncilOutput>,
    repairMessage: `The previous response was not a valid Clarift council result. Return all ${roles.length} council passes in the required order, then create a distinct final refinedPrompt that synthesizes them. The final prompt must contain prompt text only, with no council label, quote wrapper, explanation, or trailing comma. Do not copy any one intermediate refinedText as the final result. Return only the complete JSON object.`,
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
