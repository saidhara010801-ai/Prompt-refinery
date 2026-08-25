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

  if (error instanceof Error && [
    'InsufficientCreditsError',
    'ManagedRateLimitError',
    'ConcurrencyLimitError',
    'ProviderTimeoutError',
    'ManagedProviderUnavailableError',
  ].includes(error.name)) {
    const statuses: Record<string, number> = {
      InsufficientCreditsError: 402,
      ManagedRateLimitError: 429,
      ConcurrencyLimitError: 429,
      ProviderTimeoutError: 504,
      ManagedProviderUnavailableError: 503,
    };
    return { status: statuses[error.name], body: { error: { code: error.name, message: error.message } } };
  }

  if (error instanceof Error && error.name === 'OpenRouterError') {
    const providerStatus = typeof (error as Error & { status?: unknown }).status === 'number'
      ? (error as Error & { status: number }).status
      : undefined;
    const message = providerStatus === 401 || providerStatus === 403
      ? 'The managed inference service rejected its credentials. Contact Clarift support.'
      : providerStatus === 402
        ? 'The managed inference service is temporarily unavailable.'
        : providerStatus === 429
          ? 'The managed inference service is busy. Wait briefly and try again.'
          : providerStatus === 504
            ? 'Managed inference took too long to respond. Please try again.'
            : providerStatus === 404
              ? 'The managed inference configuration is unavailable. Contact Clarift support.'
              : 'Managed inference could not complete the request. Please try again.';
    return {
      status: providerStatus === 504 ? 504 : 502,
      body: { error: { code: providerStatus === 504 ? 'ProviderTimeoutError' : 'ProviderRequestError', message } },
    };
  }

  if (error instanceof Error && error.name === 'GenkitError') {
    const message = error.message.toLowerCase();
    if (message.includes('api key not valid') || message.includes('api_key_invalid')) {
      return {
        status: 401,
        body: { error: { code: 'ProviderApiKeyInvalidError', message: 'The managed inference service rejected its credentials. Contact Clarift support.' } },
      };
    }
    if (message.includes('quota') || message.includes('resource_exhausted') || message.includes('rate limit')) {
      return {
        status: 429,
        body: { error: { code: 'ProviderQuotaError', message: 'The managed inference service is busy. Wait briefly and try again.' } },
      };
    }
    if (message.includes('model') && (message.includes('not found') || message.includes('no longer available'))) {
      return {
        status: 503,
        body: { error: { code: 'ProviderModelUnavailableError', message: 'The managed inference configuration is unavailable. Contact Clarift support.' } },
      };
    }
  }

  if (error instanceof Error && error.name === 'EmptyAIOutputError') {
    return {
      status: 502,
      body: { error: { code: 'ProviderOutputError', message: 'Managed inference did not return a usable structured result. Please try again.' } },
    };
  }

  return {
    status: 502,
    body: {
      error: {
        code: 'ApiRequestError',
        message: 'Clarift could not complete the request. Please try again shortly.',
      },
    },
  };
}

export function publicApiError(error: unknown) {
  const details = publicApiErrorDetails(error);
  return NextResponse.json(details.body, { status: details.status });
}
