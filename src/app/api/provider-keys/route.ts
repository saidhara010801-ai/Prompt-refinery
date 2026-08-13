import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getBearerTokenFromRequest, AuthorizationError } from '@/lib/server/user-access';
import { listProviderKeyStatuses, revokeProviderKey, saveProviderKey } from '@/lib/server/provider-key-service';

const inputSchema = z.object({
  provider: z.enum(['gemini', 'openrouter']),
  apiKey: z.string().trim().min(8).max(500),
});

function token(request: Request) {
  const value = getBearerTokenFromRequest(request);
  if (!value) throw new AuthorizationError('Sign in to manage provider keys.', 401, 'AuthenticationRequiredError');
  return value;
}

function failure(error: unknown) {
  const status = error instanceof AuthorizationError ? error.status : error instanceof z.ZodError ? 400 : 400;
  return NextResponse.json({ error: { message: error instanceof Error ? error.message : 'Provider-key request failed.' } }, { status });
}

export async function GET(request: Request) {
  try {
    return NextResponse.json({ keys: await listProviderKeyStatuses(token(request)) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await request.json());
    return NextResponse.json(await saveProviderKey(token(request), input.provider, input.apiKey));
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const input = z.object({ provider: z.enum(['gemini', 'openrouter']) }).parse(await request.json());
    return NextResponse.json(await revokeProviderKey(token(request), input.provider));
  } catch (error) {
    return failure(error);
  }
}
