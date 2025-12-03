'use server';

import { refinePromptWithAICouncil, RefinePromptWithAICouncilInput, RefinePromptWithAICouncilOutput } from "@/ai/flows/refine-prompt-with-ai-council";
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
});

export async function refinePromptAction(data: RefinePromptWithAICouncilInput): Promise<RefinePromptWithAICouncilOutput> {
    const parsed = refineSchema.safeParse(data);
    if (!parsed.success) {
        throw new Error(parsed.error.errors.map(e => e.message).join(', '));
    }

    try {
        const result = await refinePromptWithAICouncil(parsed.data);
        return result;
    } catch (error) {
        console.error("Error refining prompt:", error);
        throw new Error("Failed to refine prompt. Please try again.");
    }
}

const evaluateSchema = z.object({
    prompt: z.string().min(1, "Prompt cannot be empty."),
    guideline: z.string().min(1, "Guideline must be selected."),
});

export async function evaluateGuidelineAction(data: Omit<EvaluatePromptGuidelineInclusionInput, 'userQuery'>) {
    const parsed = evaluateSchema.safeParse(data);
    if (!parsed.success) {
        throw new Error(parsed.error.errors.map(e => e.message).join(', '));
    }

    try {
        const result = await evaluatePromptGuidelineInclusion({
            ...parsed.data,
            userQuery: parsed.data.prompt, // Using the prompt as the user query
        });
        return result;
    } catch (error) {
        console.error("Error evaluating guideline:", error);
        throw new Error("Failed to evaluate guideline. Please try again.");
    }
}
