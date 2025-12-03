'use server';

import { refinePromptWithAICouncil, RefinePromptWithAICouncilInput } from "@/ai/flows/refine-prompt-with-ai-council";
import { evaluatePromptGuidelineInclusion, EvaluatePromptGuidelineInclusionInput } from "@/ai/flows/evaluate-prompt-guideline-inclusion";
import { z } from "zod";

const refineSchema = z.object({
    prompt: z.string().min(1, "Prompt cannot be empty."),
    promptType: z.enum([
      'Zero-shot',
      'Few-shot',
      'Chain-of-thought',
      'Tree-of-thoughts',
      'Role / persona',
      'Prompt chaining',
      'ReAct',
      'Meta / reflection',
    ]),
    apiKey: z.string().optional(),
});

export async function refinePromptAction(data: RefinePromptWithAICouncilInput) {
    const parsed = refineSchema.safeParse(data);
    if (!parsed.success) {
        throw new Error(parsed.error.errors.map(e => e.message).join(', '));
    }

    try {
        const result = await refinePromptWithAICouncil(parsed.data);
        return result;
    } catch (error) {
        console.error("Error refining prompt:", error);
        // Provide a more specific error message if possible
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        throw new Error(`Failed to refine prompt. Details: ${errorMessage}`);
    }
}

const evaluateSchema = z.object({
    prompt: z.string().min(1, "Prompt cannot be empty."),
    guideline: z.string().min(1, "Guideline must be selected."),
    apiKey: z.string().optional(),
    userQuery: z.string(),
});

export async function evaluateGuidelineAction(data: EvaluatePromptGuidelineInclusionInput) {
    const parsed = evaluateSchema.safeParse(data);
    if (!parsed.success) {
        throw new Error(parsed.error.errors.map(e => e.message).join(', '));
    }

    try {
        const result = await evaluatePromptGuidelineInclusion(parsed.data);
        return result;
    } catch (error) {
        console.error("Error evaluating guideline:", error);
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
        throw new Error(`Failed to evaluate guideline. Details: ${errorMessage}`);
    }
}
