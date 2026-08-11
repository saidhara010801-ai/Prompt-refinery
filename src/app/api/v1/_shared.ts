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
