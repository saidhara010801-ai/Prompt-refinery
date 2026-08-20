'use server';

import { randomUUID } from 'node:crypto';

import { RefinePromptWithAICouncilInput } from "@/ai/flows/refine-prompt-with-ai-council";
import { getTokenCounts, GetTokenCountsInput } from "@/ai/flows/get-token-counts";
import { assertRefinementAccess } from "@/lib/server/account-service";
import {
    MAX_ATTACHMENT_DATA_URI_CHARACTERS,
    MAX_ATTACHMENT_MIME_TYPE_CHARACTERS,
    MAX_ATTACHMENT_NAME_CHARACTERS,
    MAX_ATTACHMENT_TEXT_CHARACTERS,
    MAX_ATTACHMENTS,
    MAX_FIREBASE_ID_TOKEN_CHARACTERS,
    MAX_GUIDELINE_CHARACTERS,
    MAX_MODEL_ID_CHARACTERS,
    MAX_PROJECT_MEMORY_CHARACTERS,
    MAX_PROMPT_CHARACTERS,
    MAX_REFINED_PROMPT_CHARACTERS,
    MAX_TOKEN_ESTIMATE_CHARACTERS,
} from "@/lib/input-limits";
import { z } from "zod";
import { saveEvaluationRunForUser } from '@/lib/server/account-service';
import { withDefaultOpenRouterModels } from '@/lib/openrouter-models';
import { executeEvaluation, executeRefinement } from '@/lib/server/ai-gateway';
import { resolveTenantFromToken } from '@/lib/server/tenant-service';

const refineSchema = z.object({
    prompt: z.string().min(1, "Prompt cannot be empty.").max(MAX_PROMPT_CHARACTERS, `Prompt must be ${MAX_PROMPT_CHARACTERS} characters or fewer.`),
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
    provider: z.enum(["gemini", "openrouter"]).optional(),
    openRouterModels: z.object({
        specifier: z.string().min(1).max(MAX_MODEL_ID_CHARACTERS),
        simplifier: z.string().min(1).max(MAX_MODEL_ID_CHARACTERS),
        stylist: z.string().min(1).max(MAX_MODEL_ID_CHARACTERS),
        critic: z.string().min(1).max(MAX_MODEL_ID_CHARACTERS).optional(),
        formatter: z.string().min(1).max(MAX_MODEL_ID_CHARACTERS).optional(),
    }).optional(),
    projectMemory: z.string().max(MAX_PROJECT_MEMORY_CHARACTERS).optional(),
    explanationMode: z.boolean().optional(),
    maxCharacters: z.number().int().min(100).max(MAX_REFINED_PROMPT_CHARACTERS).optional(),
    firebaseIdToken: z.string().max(MAX_FIREBASE_ID_TOKEN_CHARACTERS).optional(),
    attachments: z.array(z.object({
        name: z.string().max(MAX_ATTACHMENT_NAME_CHARACTERS),
        mimeType: z.string().max(MAX_ATTACHMENT_MIME_TYPE_CHARACTERS),
        content: z.string().max(MAX_ATTACHMENT_TEXT_CHARACTERS),
        dataUri: z.string().max(MAX_ATTACHMENT_DATA_URI_CHARACTERS).optional(),
    })).max(MAX_ATTACHMENTS).optional(),
    task: z.enum(['quick_refine', 'guided_fix', 'full_council']).optional(),
    inferenceMode: z.enum(['managed', 'byok']).optional(),
    idempotencyKey: z.string().min(8).max(200).optional(),
});

const tokenCounterSchema = z.object({
    text: z.string().max(MAX_TOKEN_ESTIMATE_CHARACTERS),
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

function toUserFacingError(error: unknown, actionKind: ActionKind): Error {
    if (isApiKeyMissingError(error)) {
        const missingKeyError = new Error("Clarift could not resolve a provider credential. Try managed inference or configure encrypted BYOK in Advanced settings.");
        missingKeyError.name = "ProviderKeyMissingError";
        return missingKeyError;
    }

    if (isApiKeyInvalidError(error)) {
        const invalidKeyError = new Error("The configured provider credential was rejected. Revalidate encrypted BYOK in Advanced settings or use managed inference.");
        invalidKeyError.name = "ProviderKeyInvalidError";
        return invalidKeyError;
    }

    if (isQuotaError(error)) {
        const quotaError = new Error("The selected provider is reporting a quota or rate-limit issue. Wait a moment and try again.");
        quotaError.name = "ProviderQuotaError";
        return quotaError;
    }

    if (isEmptyOutputError(error)) {
        const emptyOutputError = new Error("The provider did not return a usable structured response. Please try again.");
        emptyOutputError.name = "EmptyAIOutputError";
        return emptyOutputError;
    }

    const genericError = new Error(`Failed to ${actionKind}. Please try again in a moment.`);
    genericError.name = "AIRequestError";
    return genericError;
}

export async function refinePromptAction(data: RefinePromptWithAICouncilInput & {
    firebaseIdToken?: string;
    task?: 'quick_refine' | 'guided_fix' | 'full_council';
    inferenceMode?: 'managed' | 'byok';
    idempotencyKey?: string;
}) {
    const parsed = refineSchema.safeParse(data);
    if (!parsed.success) {
        throw new Error(parsed.error.errors.map(e => e.message).join(', '));
    }

    try {
        if (!parsed.data.firebaseIdToken) {
            const error = new Error('Sign in before using managed refinement.');
            error.name = 'AuthenticationRequiredError';
            throw error;
        }
        await assertRefinementAccess(parsed.data.firebaseIdToken, parsed.data.promptType, Boolean(parsed.data.projectMemory));
        const context = await resolveTenantFromToken(parsed.data.firebaseIdToken);
        const {
            firebaseIdToken: _firebaseIdToken,
            provider: _provider,
            task: requestedTask,
            inferenceMode,
            idempotencyKey,
            ...refinement
        } = parsed.data;
        const task = requestedTask ?? 'full_council';
        const gateway = await executeRefinement({
            context,
            task,
            inferenceMode: inferenceMode ?? 'managed',
            preferredProvider: inferenceMode === 'byok' ? _provider : undefined,
            idempotencyKey: idempotencyKey ?? `${context.principalId}:${Date.now()}:${randomUUID()}`,
            source: 'app',
            refinement: {
                ...refinement,
                openRouterModels: withDefaultOpenRouterModels(refinement.openRouterModels),
            },
        });
        return {
            ...gateway.result,
            contractVersion: 2 as const,
            requestId: gateway.requestId,
            creditsCharged: gateway.creditsCharged,
            qualityTier: gateway.qualityTier,
            allowance: gateway.allowance,
            basicMode: gateway.basicMode,
        };
    } catch (error) {
        console.error("Error refining prompt:", { name: error instanceof Error ? error.name : 'UnknownError' });
        if (error instanceof Error && (
            error.name === "ProFeatureRequiredError" ||
            error.name === "ManagedRateLimitError" ||
            error.name === "AuthenticationRequiredError" ||
            error.name === "InsufficientCreditsError" ||
            error.name === "ProviderKeyMissingError" ||
            error.name === "ConcurrencyLimitError" ||
            error.name === "ProviderTimeoutError"
        )) {
            throw error;
        }
        throw toUserFacingError(error, "refine prompt");
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
        console.error("Error getting token counts:", { name: error instanceof Error ? error.name : 'UnknownError' });
        throw toUserFacingError(error, "get token counts");
    }
}

const batchEvaluateSchema = z.object({
    prompt: z.string().min(1).max(MAX_PROMPT_CHARACTERS),
    guidelines: z.array(z.string().min(1).max(MAX_GUIDELINE_CHARACTERS)).min(1).max(8),
    firebaseIdToken: z.string().min(1).max(MAX_FIREBASE_ID_TOKEN_CHARACTERS),
});

export async function evaluateGuidelinesAction(data: z.infer<typeof batchEvaluateSchema>) {
    const parsed = batchEvaluateSchema.parse(data);
    try {
        const context = await resolveTenantFromToken(parsed.firebaseIdToken);
        const gateway = await executeEvaluation({
            context,
            task: 'evaluate',
            inferenceMode: 'managed',
            idempotencyKey: `${context.principalId}:evaluation:${Date.now()}:${randomUUID()}`,
            source: 'app',
            prompt: parsed.prompt,
            guidelines: parsed.guidelines,
        });
        const evaluation = gateway.result;
        const saved = await saveEvaluationRunForUser(parsed.firebaseIdToken, {
            prompt: parsed.prompt,
            guidelines: parsed.guidelines,
            combinedScore: evaluation.combinedScore,
            results: evaluation.results,
        });
        return {
            ...evaluation,
            id: saved.id,
            contractVersion: 2 as const,
            requestId: gateway.requestId,
            creditsCharged: gateway.creditsCharged,
            qualityTier: gateway.qualityTier,
            allowance: gateway.allowance,
            basicMode: gateway.basicMode,
        };
    } catch (error) {
        console.error('Error evaluating guidelines:', { name: error instanceof Error ? error.name : 'UnknownError' });
        if (error instanceof Error && [
            'AuthenticationRequiredError',
            'InsufficientCreditsError',
            'ProviderKeyMissingError',
            'ConcurrencyLimitError',
            'ProviderTimeoutError',
            'ManagedRateLimitError',
        ].includes(error.name)) throw error;
        throw toUserFacingError(error, 'evaluate guideline');
    }
}
