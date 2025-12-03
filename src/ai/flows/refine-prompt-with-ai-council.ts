'use server';

/**
 * @fileOverview This file defines a Genkit flow for refining prompts using an AI council with different prompting techniques.
 *
 * - refinePromptWithAICouncil - A function that refines a user-provided prompt using an AI council.
 * - RefinePromptWithAICouncilInput - The input type for the refinePromptWithAICouncil function.
 * - RefinePromptWithAICouncilOutput - The return type for the refinePromptWithAICouncil function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const RefinePromptWithAICouncilInputSchema = z.object({
  prompt: z.string().describe('The prompt to be refined.'),
  promptType: z
    .enum([
      'Zero-shot',
      'Few-shot',
      'Chain-of-thought',
      'Tree-of-thoughts',
      'Role / persona',
      'Prompt chaining',
      'ReAct',
      'Meta / reflection',
    ])
    .describe(
      'The prompting technique to be applied by the AI council for refinement.'
    ),
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

export async function refinePromptWithAICouncil(
  input: RefinePromptWithAICouncilInput
): Promise<RefinePromptWithAICouncilOutput> {
  return refinePromptWithAICouncilFlow(input);
}

const refinePromptWithAICouncilPrompt = ai.definePrompt({
  name: 'refinePromptWithAICouncilPrompt',
  input: {schema: RefinePromptWithAICouncilInputSchema},
  output: {schema: RefinePromptWithAICouncilOutputSchema},
  prompt: `You are a council of three expert prompt engineers: Dr. Anya Sharma (specialist in clarity and conciseness), Dr. Ben Carter (specialist in creative and lateral thinking), and Dr. Chloe Davis (specialist in structured and logical prompting). Your goal is to refine the user-provided prompt using the specified prompting technique, which is "{{promptType}}".

Here are the prompting techniques and their main ideas:
- Zero-shot: Just instructions, no examples
- Few-shot: Add a few examples
- Chain-of-thought: Show step-by-step reasoning
- Tree-of-thoughts: Explore multiple reasoning branches
- Role / persona: “Act as X” role control
- Prompt chaining: Multi-prompt pipelines
- ReAct: Interleave reasoning and tool use
- Meta / reflection: Model reasons about its own process

Based on the prompt type "{{promptType}}", each of you will independently refine the following prompt:
"""
{{prompt}}
"""

When the promptType is 'ReAct', your output should be a refined prompt that instructs the LLM to follow the ReAct process. Do not output the ReAct process itself. Instead, create a prompt that would cause another LLM to perform that process.

First, each council member will provide their thought process and their refined version of the prompt.
Then, synthesize the best ideas from all three members into a single, final refined prompt.

Your response must be a JSON object with two keys: "refinedPrompt" (the final synthesized prompt) and "refinements" (an array of objects, where each object represents a council member's contribution with "councilMember", "thoughtProcess", and "refinedText").
`,
});

const refinePromptWithAICouncilFlow = ai.defineFlow(
  {
    name: 'refinePromptWithAICouncilFlow',
    inputSchema: RefinePromptWithAICouncilInputSchema,
    outputSchema: RefinePromptWithAICouncilOutputSchema,
  },
  async input => {
    const {output} = await refinePromptWithAICouncilPrompt(input);
    return output!;
  }
);
