import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createApiKey, listApiKeys, revokeApiKey } from '@/lib/server/api-key-service';
import { AuthorizationError } from '@/lib/server/user-access';

function responseError(error: unknown) {
  return NextResponse.json({ error: { message: error instanceof Error ? error.message : 'API key request failed.' } }, { status: error instanceof AuthorizationError ? error.status : 500 });
}

export async function GET(request: Request) {
  try { return NextResponse.json({ keys: await listApiKeys(request) }); } catch (error) { return responseError(error); }
}

export async function POST(request: Request) {
  try {
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(await request.json());
    return NextResponse.json(await createApiKey(request, name), { status: 201 });
  } catch (error) { return responseError(error); }
}

export async function DELETE(request: Request) {
  try {
    const { keyId } = z.object({ keyId: z.string().min(1).max(200) }).parse(await request.json());
    return NextResponse.json(await revokeApiKey(request, keyId));
  } catch (error) { return responseError(error); }
}
