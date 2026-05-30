'use server';

import { refinePromptWithAICouncil, RefinePromptWithAICouncilInput } from "@/ai/flows/refine-prompt-with-ai-council";
import { evaluatePromptGuidelineInclusion, EvaluatePromptGuidelineInclusionInput } from "@/ai/flows/evaluate-prompt-guideline-inclusion";
import { getTokenCounts, GetTokenCountsInput } from "@/ai/flows/get-token-counts";
import { z } from "zod";

const DEFAULT_OPENROUTER_MODELS = {
    specifier: "openai/gpt-4o-mini",
    simplifier: "anthropic/claude-3.5-haiku",
    stylist: "google/gemini-2.0-flash-001",
};

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
    provider: z.enum(["gemini", "openrouter"]).optional(),
    openRouterApiKey: z.string().optional(),
    openRouterModels: z.object({
        specifier: z.string().min(1),
        simplifier: z.string().min(1),
        stylist: z.string().min(1),
    }).optional(),
    projectMemory: z.string().optional(),
});

const tokenCounterSchema = z.object({
    text: z.string(),
    apiKey: z.string().optional(),
});

type ActionKind = "refine prompt" | "evaluate guideline" | "get token counts";

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isApiKeyMissingError(error: unknown): boolean {
    const errorMessage = getErrorMessage(error);

    return errorMessage.includes("GOOGLE_API_KEY") ||
        errorMessage.includes("GEMINI_API_KEY") ||
        errorMessage.includes("API key not found") ||
        errorMessage.includes("FAILED_PRECONDITION");
}

function isOpenRouterError(error: unknown): boolean {
    return error instanceof Error && error.name === "OpenRouterError";
}

function isApiKeyInvalidError(error: unknown): boolean {
    const errorMessage = getErrorMessage(error).toLowerCase();

    return errorMessage.includes("api key not valid") ||
        errorMessage.includes("api_key_invalid") ||
        errorMessage.includes("invalid api key") ||
        errorMessage.includes("permission_denied") ||
        errorMessage.includes("no auth credentials found") ||
        errorMessage.includes("unauthorized") ||
        errorMessage.includes("\"code\":401");
}

function isQuotaError(error: unknown): boolean {
    const errorMessage = getErrorMessage(error).toLowerCase();

    return errorMessage.includes("quota") ||
        errorMessage.includes("rate limit") ||
        errorMessage.includes("resource_exhausted") ||
        errorMessage.includes("too many requests");
}

function isEmptyOutputError(error: unknown): boolean {
    return error instanceof Error && error.name === "EmptyAIOutputError";
}

function toUserFacingError(error: unknown, actionKind: ActionKind, hasApiKey: boolean): Error {
    if (!hasApiKey || isApiKeyMissingError(error)) {
        const missingKeyError = new Error("Your Gemini API key is missing. Add it in Settings, then try again.");
        missingKeyError.name = "ApiKeyMissingError";
        return missingKeyError;
    }

    if (isApiKeyInvalidError(error)) {
        const invalidKeyError = new Error("Your Gemini API key looks invalid. Check the key in Settings and try again.");
        invalidKeyError.name = "ApiKeyInvalidError";
        return invalidKeyError;
    }

    if (isQuotaError(error)) {
        const quotaError = new Error("Gemini is reporting a quota or rate-limit issue. Wait a bit or use a key with available quota.");
        quotaError.name = "ApiQuotaError";
        return quotaError;
    }

    if (isEmptyOutputError(error)) {
        const emptyOutputError = new Error("Gemini did not return a usable structured response. Please try again.");
        emptyOutputError.name = "EmptyAIOutputError";
        return emptyOutputError;
    }

    const genericError = new Error(`Failed to ${actionKind}. Please try again in a moment.`);
    genericError.name = "AIRequestError";
    return genericError;
}

function toProviderError(error: unknown, actionKind: ActionKind, provider: "gemini" | "openrouter", hasApiKey: boolean): Error {
    if (provider === "gemini") {
        return toUserFacingError(error, actionKind, hasApiKey);
    }

    if (!hasApiKey) {
        const missingKeyError = new Error("Your OpenRouter API key is missing. Add it in Settings, then try again.");
        missingKeyError.name = "OpenRouterApiKeyMissingError";
        return missingKeyError;
    }

    if (isApiKeyInvalidError(error)) {
        const invalidKeyError = new Error("Your OpenRouter API key looks invalid. Check the key in Settings and try again.");
        invalidKeyError.name = "OpenRouterApiKeyInvalidError";
        return invalidKeyError;
    }

    if (isQuotaError(error)) {
        const quotaError = new Error("OpenRouter is reporting a quota or rate-limit issue. Wait a bit or use a key with available credits.");
        quotaError.name = "OpenRouterQuotaError";
        return quotaError;
    }

    if (isOpenRouterError(error)) {
        const openRouterError = new Error(`OpenRouter could not ${actionKind}. Check your selected model IDs and try again.`);
        openRouterError.name = "OpenRouterRequestError";
        return openRouterError;
    }

    return toUserFacingError(error, actionKind, true);
}

export async function refinePromptAction(data: RefinePromptWithAICouncilInput) {
    const parsed = refineSchema.safeParse(data);
    if (!parsed.success) {
        throw new Error(parsed.error.errors.map(e => e.message).join(', '));
    }

    try {
        const provider = parsed.data.provider ?? "gemini";
        const input = provider === "openrouter"
            ? {
                ...parsed.data,
                openRouterApiKey: parsed.data.openRouterApiKey || process.env.OPENROUTER_API_KEY,
                openRouterModels: {
                    ...DEFAULT_OPENROUTER_MODELS,
                    ...parsed.data.openRouterModels,
                },
            }
            : parsed.data;

        const result = await refinePromptWithAICouncil(input);
        return result;
    } catch (error) {
        console.error("Error refining prompt:", error);
        const provider = parsed.data.provider ?? "gemini";
        const hasApiKey = provider === "openrouter" ? Boolean(parsed.data.openRouterApiKey || process.env.OPENROUTER_API_KEY) : Boolean(parsed.data.apiKey);
        throw toProviderError(error, "refine prompt", provider, hasApiKey);
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
        throw toUserFacingError(error, "evaluate guideline", Boolean(parsed.data.apiKey));
    }
}

export async function getTokenCountsAction(data: GetTokenCountsInput) {
    const parsed = tokenCounterSchema.safeParse(data);
    if (!parsed.success) {
        throw new Error(parsed.error.errors.map(e => e.message).join(', '));
    }

    try {
        return await getTokenCounts(parsed.data);
    } catch (error) {
        console.error("Error getting token counts:", error);
        throw toUserFacingError(error, "get token counts", true);
    }
}
