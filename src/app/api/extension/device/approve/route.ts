import { NextResponse } from 'next/server';
import { z } from 'zod';

import { approveExtensionLink } from '@/lib/server/extension-auth-service';
import { getBearerTokenFromRequest, AuthorizationError } from '@/lib/server/user-access';

export async function POST(request: Request) {
  try {
    const token = getBearerTokenFromRequest(request);
    if (!token) throw new AuthorizationError('Sign in before linking the extension.', 401, 'AuthenticationRequiredError');
    const { deviceCode } = z.object({ deviceCode: z.string().min(20).max(200) }).parse(await request.json());
    return NextResponse.json(await approveExtensionLink(token, deviceCode));
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : 'Extension linking failed.' } }, { status: error instanceof AuthorizationError ? error.status : 400 });
  }
}
