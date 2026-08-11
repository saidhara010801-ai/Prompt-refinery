import { NextResponse } from 'next/server';

import { AuthorizationError } from '@/lib/server/user-access';

export function publicApiError(error: unknown) {
  const status = error instanceof AuthorizationError ? error.status : error instanceof Error && error.name === 'ZodError' ? 400 : 502;
  return NextResponse.json({ error: { code: error instanceof Error ? error.name : 'ApiRequestError', message: error instanceof Error ? error.message : 'Clarift API request failed.' } }, { status });
}
