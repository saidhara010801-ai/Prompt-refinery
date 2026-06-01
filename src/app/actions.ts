'use server';

import { refinePromptWithAICouncil, RefinePromptWithAICouncilInput } from "@/ai/flows/refine-prompt-with-ai-council";
import { evaluatePromptGuidelineInclusion, EvaluatePromptGuidelineInclusionInput } from "@/ai/flows/evaluate-prompt-guideline-inclusion";
import { getTokenCounts, GetTokenCountsInput } from "@/ai/flows/get-token-counts";
import { assertProFeatureAccess, assertRefinementAccess, releaseManagedRefinement, reserveManagedRefinement } from "@/lib/server/account-service";
import { z } from "zod";

const DEFAULT_OPENROUTER_MODELS = {
    specifier: "openai/gpt-4o-mini",
    simplifier: "anthropic/claude-3.5-haiku",
    stylist: "google/gemini-2.0-flash-001",
    critic: "anthropic/claude-3.5-haiku",
    formatter: "openai/gpt-4o-mini",
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
        critic: z.string().min(1).optional(),
        formatter: z.string().min(1).optional(),
    }).optional(),
    projectMemory: z.string().optional(),
    explanationMode: z.boolean().optional(),
    firebaseIdToken: z.string().optional(),
    attachments: z.array(z.object({
        name: z.string(),
        mimeType: z.string(),
        content: z.string(),
        dataUri: z.string().optional(),
    })).optional(),
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

export async function refinePromptAction(data: RefinePromptWithAICouncilInput & { firebaseIdToken?: string }) {
    const parsed = refineSchema.safeParse(data);
    if (!parsed.success) {
        throw new Error(parsed.error.errors.map(e => e.message).join(', '));
    }

    const provider = parsed.data.provider ?? "gemini";
    const usesManagedProvider = provider === "openrouter"
        ? !parsed.data.openRouterApiKey && Boolean(process.env.OPENROUTER_API_KEY)
        : !parsed.data.apiKey && Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    let managedReservation: { uid: string; usageDate: string } | null = null;

    try {
        await assertRefinementAccess(parsed.data.firebaseIdToken, parsed.data.promptType, Boolean(parsed.data.projectMemory));
        const usesCustomOpenRouterModels = provider === "openrouter" && parsed.data.openRouterModels && (
            parsed.data.openRouterModels.specifier !== DEFAULT_OPENROUTER_MODELS.specifier ||
            parsed.data.openRouterModels.simplifier !== DEFAULT_OPENROUTER_MODELS.simplifier ||
            parsed.data.openRouterModels.stylist !== DEFAULT_OPENROUTER_MODELS.stylist ||
            parsed.data.openRouterModels.critic !== DEFAULT_OPENROUTER_MODELS.critic ||
            parsed.data.openRouterModels.formatter !== DEFAULT_OPENROUTER_MODELS.formatter
        );
        if (usesCustomOpenRouterModels) {
            await assertProFeatureAccess(
                parsed.data.firebaseIdToken,
                "Custom OpenRouter council routing is available on Pro. Upgrade or restore the default model IDs."
            );
        }
        if (usesManagedProvider) {
            managedReservation = await reserveManagedRefinement(parsed.data.firebaseIdToken);
        }

        const { firebaseIdToken: _firebaseIdToken, ...flowData } = parsed.data;
        const input = provider === "openrouter"
            ? {
                ...flowData,
                openRouterApiKey: parsed.data.openRouterApiKey || process.env.OPENROUTER_API_KEY,
                openRouterModels: {
                    ...DEFAULT_OPENROUTER_MODELS,
                    ...parsed.data.openRouterModels,
                },
            }
            : flowData;

        const result = await refinePromptWithAICouncil(input);
        return result;
    } catch (error) {
        console.error("Error refining prompt:", error);
        if (managedReservation) {
            await releaseManagedRefinement(managedReservation.uid, managedReservation.usageDate)
                .catch((releaseError) => console.error("Error releasing managed refinement reservation:", releaseError));
        }
        const hasApiKey = provider === "openrouter" ? Boolean(parsed.data.openRouterApiKey || process.env.OPENROUTER_API_KEY) : Boolean(parsed.data.apiKey);
        if (error instanceof Error && (
            error.name === "ProFeatureRequiredError" ||
            error.name === "ManagedRateLimitError" ||
            error.name === "AuthenticationRequiredError"
        )) {
            throw error;
        }
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
