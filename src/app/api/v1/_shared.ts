import { NextResponse } from 'next/server';
import type { output, ZodTypeAny } from 'zod';

import { AuthorizationError } from '@/lib/server/user-access';

export async function parsePublicApiJson<TSchema extends ZodTypeAny>(
  request: Request,
  schema: TSchema
): Promise<output<TSchema>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new AuthorizationError('Request body must be valid JSON.', 400, 'ApiValidationError');
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AuthorizationError('Request data is invalid. Check the documented fields and try again.', 400, 'ApiValidationError');
  }
  return parsed.data;
}

export function publicApiErrorDetails(error: unknown) {
  if (error instanceof AuthorizationError) {
    return {
      status: error.status,
      body: { error: { code: error.name, message: error.message } },
    };
  }

  if (error instanceof Error && error.name === 'OpenRouterError') {
    const providerStatus = typeof (error as Error & { status?: unknown }).status === 'number'
      ? (error as Error & { status: number }).status
      : undefined;
    const message = providerStatus === 401 || providerStatus === 403
      ? 'OpenRouter rejected the provider API key. Check the key in extension settings.'
      : providerStatus === 402
        ? 'The OpenRouter account has insufficient credits for this refinement.'
        : providerStatus === 429
          ? 'OpenRouter rate limit reached. Wait briefly and try again.'
          : providerStatus === 504
            ? 'OpenRouter took too long to respond. Please try again.'
            : providerStatus === 404
              ? 'A selected OpenRouter model is unavailable. Restore the default council models and try again.'
              : 'OpenRouter could not complete the refinement. Check the provider key and try again.';
    return {
      status: providerStatus === 504 ? 504 : 502,
      body: { error: { code: providerStatus === 504 ? 'ProviderTimeoutError' : 'ProviderRequestError', message } },
    };
  }

  return {
    status: 502,
    body: {
      error: {
        code: 'ApiRequestError',
        message: 'Clarift could not complete the request. Check your provider key and settings, then try again.',
      },
    },
  };
}

export function publicApiError(error: unknown) {
  const details = publicApiErrorDetails(error);
  return NextResponse.json(details.body, { status: details.status });
}
