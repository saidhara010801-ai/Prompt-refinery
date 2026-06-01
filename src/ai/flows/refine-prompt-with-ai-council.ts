'use server';

/**
 * @fileOverview This file defines a Genkit flow for refining prompts using an AI council with different prompting techniques.
 *
 * - refinePromptWithAICouncil - A function that refines a user-provided prompt using an AI council.
 * - RefinePromptWithAICouncilInput - The input type for the refinePromptWithAICouncil function.
 * - RefinePromptWithAICouncilOutput - The return type for the refinePromptWithAICouncil function.
 */

import { ai, genkit, generation } from '@/ai/genkit';
import { z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { requireFlowOutput } from './require-flow-output';
import { createOpenRouterChatCompletion, parseJsonObject } from './openrouter-client';

const PromptTechniqueSchema = z.enum([
  'Zero-shot',
  'Few-shot',
  'Chain-of-thought',
  'Tree-of-thoughts',
  'Role / persona',
  'Prompt chaining',
  'ReAct',
  'Meta / reflection',
]);

const OpenRouterModelsSchema = z.object({
  specifier: z.string().min(1),
  simplifier: z.string().min(1),
  stylist: z.string().min(1),
  critic: z.string().min(1).optional(),
  formatter: z.string().min(1).optional(),
});

const AttachmentContextSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  content: z.string(),
  dataUri: z.string().optional(),
});

const RefinePromptWithAICouncilInputSchema = z.object({
  prompt: z.string().describe('The prompt to be refined.'),
  promptType: PromptTechniqueSchema.describe(
    'The prompting technique to be applied by the AI council for refinement.'
  ),
  apiKey: z.string().optional().describe('The user-provided Gemini API key.'),
  provider: z.enum(['gemini', 'openrouter']).optional().describe('The model provider used for refinement.'),
  openRouterApiKey: z.string().optional().describe('The user-provided OpenRouter API key.'),
  openRouterModels: OpenRouterModelsSchema.optional().describe('OpenRouter model IDs for each council member.'),
  projectMemory: z.string().optional().describe('Recent project context from prior refinements and response notes.'),
  explanationMode: z.boolean().optional().describe('Whether to include clear user-facing explanations of refinement decisions.'),
  attachments: z.array(AttachmentContextSchema).optional().describe('Uploaded file context converted into text or metadata for refinement.'),
});
export type RefinePromptWithAICouncilInput = z.infer<typeof RefinePromptWithAICouncilInputSchema>;

const CouncilMemberOutputSchema = z.object({
  councilMember: z.string().describe('The name or identifier of the AI Council member providing the refinement.'),
  thoughtProcess: z.string().describe('The thought process or reasoning of the council member during the refinement.'),
  refinedText: z.string().describe('The refined text or suggestion provided by the council member.'),
});

const RefinePromptWithAICouncilOutputSchema = z.object({
  refinedPrompt: z.string().describe('The final, most refined prompt after considering all council member inputs.'),
  refinements: z.array(CouncilMemberOutputSchema).describe('A list of refinements from each council member.')
});
export type RefinePromptWithAICouncilOutput = z.infer<typeof RefinePromptWithAICouncilOutputSchema>;

type CouncilRole = 'specifier' | 'simplifier' | 'stylist' | 'critic' | 'formatter';

const councilRoleConfig: Record<CouncilRole, { name: string; focus: string }> = {
  specifier: {
    name: 'The Specifier',
    focus: 'clarity, specificity, missing context, and explicit constraints',
  },
  simplifier: {
    name: 'The Simplifier',
    focus: 'decomposing complex work into simple, ordered, executable steps',
  },
  stylist: {
    name: 'The Stylist',
    focus: 'persona, tone, output format, and audience fit',
  },
  critic: {
    name: 'The Critic',
    focus: 'quality risks, missing requirements, ambiguity, safety, and likely failure modes',
  },
  formatter: {
    name: 'The Formatter',
    focus: 'final structure, sections, delimiters, reusable formatting, and copy-ready presentation',
  },
};

const OpenRouterCouncilMemberResponseSchema = z.object({
  thoughtProcess: z.string(),
  refinedText: z.string(),
});

function formatAttachmentContext(attachments?: z.infer<typeof AttachmentContextSchema>[]): string {
  if (!attachments?.length) {
    return '';
  }

  return `\nUploaded attachment context:\n${attachments
    .map((attachment) => `- ${attachment.name} (${attachment.mimeType}):\n"""\n${attachment.content}\n"""`)
    .join('\n\n')}\n`;
}

async function runOpenRouterCouncilMember(input: RefinePromptWithAICouncilInput, role: CouncilRole) {
  const models = OpenRouterModelsSchema.parse(input.openRouterModels);
  const roleConfig = councilRoleConfig[role];
  const model = models[role] ?? models.specifier;

  const content = await createOpenRouterChatCompletion({
    apiKey: input.openRouterApiKey!,
    model,
    messages: [
      {
        role: 'system',
        content: `You are ${roleConfig.name}, one member of an expert prompt-engineering council. Focus on ${roleConfig.focus}. Return only JSON.`,
      },
      {
        role: 'user',
        content: `Refine the prompt below using the "${input.promptType}" technique and the 8 golden rules of prompting.

Golden rules:
1. Be specific and provide context.
2. Use delimiters.
3. Specify the desired output format.
4. Provide examples when useful.
5. Break complex tasks into smaller steps.
6. Use a persona or role when useful.
7. Check assumptions.
8. Iterate and refine.

If the technique is ReAct, write a prompt that instructs another LLM to follow ReAct. Do not perform ReAct yourself.

Prompt:
"""
${input.prompt}
"""
${input.projectMemory ? `
Recent project memory:
"""
${input.projectMemory}
"""

Use this memory only when it is relevant to the new prompt. Do not expose private notes unless they improve the final prompt.
` : ''}
${formatAttachmentContext(input.attachments)}

Return a JSON object with exactly:
{
  "thoughtProcess": "${input.explanationMode ? 'concise user-facing explanation of the most important refinement choices' : 'one short summary sentence'}",
  "refinedText": "your refined prompt version"
}`,
      },
    ],
  });

  const parsed = parseJsonObject(content, OpenRouterCouncilMemberResponseSchema, roleConfig.name);

  return {
    councilMember: `${roleConfig.name} (${model})`,
    thoughtProcess: parsed.thoughtProcess,
    refinedText: parsed.refinedText,
  };
}

async function synthesizeOpenRouterCouncilOutput(
  input: RefinePromptWithAICouncilInput,
  refinements: z.infer<typeof CouncilMemberOutputSchema>[]
): Promise<RefinePromptWithAICouncilOutput> {
  const models = OpenRouterModelsSchema.parse(input.openRouterModels);
  const content = await createOpenRouterChatCompletion({
    apiKey: input.openRouterApiKey!,
    model: models.formatter ?? models.specifier,
    messages: [
      {
        role: 'system',
        content: 'You synthesize an AI prompt-engineering council into one final refined prompt. Return only JSON.',
      },
      {
        role: 'user',
        content: `Original prompt:
"""
${input.prompt}
"""
${input.projectMemory ? `
Recent project memory:
"""
${input.projectMemory}
"""
` : ''}
${formatAttachmentContext(input.attachments)}

Technique: ${input.promptType}

Council refinements:
${JSON.stringify(refinements, null, 2)}

Synthesize the best ideas into one final prompt. Return JSON with exactly:
{
  "refinedPrompt": "final prompt only"
}`,
      },
    ],
  });

  const parsed = parseJsonObject(content, z.object({ refinedPrompt: z.string() }), 'OpenRouter synthesis');

  return RefinePromptWithAICouncilOutputSchema.parse({
    refinedPrompt: parsed.refinedPrompt,
    refinements,
  });
}

async function refinePromptWithOpenRouter(input: RefinePromptWithAICouncilInput): Promise<RefinePromptWithAICouncilOutput> {
  const refinements = await Promise.all([
    runOpenRouterCouncilMember(input, 'specifier'),
    runOpenRouterCouncilMember(input, 'simplifier'),
    runOpenRouterCouncilMember(input, 'stylist'),
    runOpenRouterCouncilMember(input, 'critic'),
    runOpenRouterCouncilMember(input, 'formatter'),
  ]);

  return synthesizeOpenRouterCouncilOutput(input, refinements);
}

const refinePromptWithAICouncilPrompt = ai.definePrompt({
  name: 'refinePromptWithAICouncilPrompt',
  input: { schema: RefinePromptWithAICouncilInputSchema },
  output: { schema: RefinePromptWithAICouncilOutputSchema },
  prompt: `You are a council of five expert prompt engineers:
- "The Specifier": Focuses on clarity, specificity, and context. Ensures all constraints are articulated.
- "The Simplifier": Breaks down complex tasks into simple, logical steps. Aims for a clear, sequential flow.
- "The Stylist": Defines the persona, format, and tone. Ensures the output matches the desired style.
- "The Critic": Finds gaps, ambiguity, risks, missing requirements, and likely failure modes.
- "The Formatter": Turns the final prompt into a copy-ready structure with clear delimiters and sections.

Your goal is to refine the user-provided prompt using the specified prompting technique, which is "{{promptType}}", while applying the 8 golden rules of prompting.

The 8 Golden Rules of Prompting:
1. Be specific and provide context.
2. Use delimiters.
3. Specify the desired output format.
4. Provide examples (few-shot prompting).
5. Break down complex tasks into smaller steps.
6. Use a persona or role for the model.
7. Check your assumptions.
8. Iterate and refine.

Based on the prompt type "{{promptType}}", each of you will independently refine the following prompt:
"""
{{prompt}}
"""
{{#if projectMemory}}

Recent project memory:
"""
{{projectMemory}}
"""

Use this memory only when it is relevant to the new prompt. Do not expose private notes unless they improve the final prompt.
{{/if}}
{{#if attachments}}

Uploaded attachment context:
{{#each attachments}}
- {{name}} ({{mimeType}}):
"""
{{content}}
"""
{{#if dataUri}}
{{media url=dataUri}}
{{/if}}
{{/each}}
{{/if}}

When the promptType is 'ReAct', your output should be a refined prompt that instructs the LLM to follow the ReAct process. Do not output the ReAct process itself. Instead, create a prompt that would cause another LLM to perform that process.

First, each council member will provide their thought process and their refined version of the prompt, incorporating their specialty and the 8 golden rules.
{{#if explanationMode}}
Use each thoughtProcess field for a concise, user-facing explanation of the most important refinement decisions.
{{else}}
Keep each thoughtProcess field to one short summary sentence.
{{/if}}
Then, synthesize the best ideas from all five members into a single, final refined prompt.

Your response must be a JSON object with two keys: "refinedPrompt" (the final synthesized prompt) and "refinements" (an array of objects, where each object represents a council member's contribution with "councilMember", "thoughtProcess", and "refinedText").
`,
});

const refinePromptWithAICouncilFlow = ai.defineFlow(
  {
    name: 'refinePromptWithAICouncilFlow',
    inputSchema: RefinePromptWithAICouncilInputSchema,
    outputSchema: RefinePromptWithAICouncilOutputSchema,
  },
  async (input) => {
    const { output } = await refinePromptWithAICouncilPrompt(input);
    return requireFlowOutput(output, 'AI council refinement');
  }
);

export async function refinePromptWithAICouncil(
  input: RefinePromptWithAICouncilInput
): Promise<RefinePromptWithAICouncilOutput> {
  if (input.provider === 'openrouter') {
    return refinePromptWithOpenRouter(input);
  }

  if (input.apiKey) {
    const customAi = genkit({
      plugins: [googleAI({ apiKey: input.apiKey })],
      model: generation,
    });
    const dynamicPrompt = customAi.definePrompt({
        name: 'refinePromptWithAICouncilPrompt',
        input: { schema: RefinePromptWithAICouncilInputSchema },
        output: { schema: RefinePromptWithAICouncilOutputSchema },
        prompt: `You are a council of five expert prompt engineers:
- "The Specifier": Focuses on clarity, specificity, and context. Ensures all constraints are articulated.
- "The Simplifier": Breaks down complex tasks into simple, logical steps. Aims for a clear, sequential flow.
- "The Stylist": Defines the persona, format, and tone. Ensures the output matches the desired style.
- "The Critic": Finds gaps, ambiguity, risks, missing requirements, and likely failure modes.
- "The Formatter": Turns the final prompt into a copy-ready structure with clear delimiters and sections.

Your goal is to refine the user-provided prompt using the specified prompting technique, which is "{{promptType}}", while applying the 8 golden rules of prompting.

The 8 Golden Rules of Prompting:
1. Be specific and provide context.
2. Use delimiters.
3. Specify the desired output format.
4. Provide examples (few-shot prompting).
5. Break down complex tasks into smaller steps.
6. Use a persona or role for the model.
7. Check your assumptions.
8. Iterate and refine.

Based on the prompt type "{{promptType}}", each of you will independently refine the following prompt:
"""
{{prompt}}
"""
{{#if projectMemory}}

Recent project memory:
"""
{{projectMemory}}
"""

Use this memory only when it is relevant to the new prompt. Do not expose private notes unless they improve the final prompt.
{{/if}}
{{#if attachments}}

Uploaded attachment context:
{{#each attachments}}
- {{name}} ({{mimeType}}):
"""
{{content}}
"""
{{#if dataUri}}
{{media url=dataUri}}
{{/if}}
{{/each}}
{{/if}}

When the promptType is 'ReAct', your output should be a refined prompt that instructs the LLM to follow the ReAct process. Do not output the ReAct process itself. Instead, create a prompt that would cause another LLM to perform that process.

First, each council member will provide their thought process and their refined version of the prompt, incorporating their specialty and the 8 golden rules.
{{#if explanationMode}}
Use each thoughtProcess field for a concise, user-facing explanation of the most important refinement decisions.
{{else}}
Keep each thoughtProcess field to one short summary sentence.
{{/if}}
Then, synthesize the best ideas from all five members into a single, final refined prompt.

Your response must be a JSON object with two keys: "refinedPrompt" (the final synthesized prompt) and "refinements" (an array of objects, where each object represents a council member's contribution with "councilMember", "thoughtProcess", and "refinedText").
`,
    });
    const { output } = await dynamicPrompt(input);
    return requireFlowOutput(output, 'AI council refinement');
  }
  return refinePromptWithAICouncilFlow(input);
}
