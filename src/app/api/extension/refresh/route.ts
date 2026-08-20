import { NextResponse } from 'next/server';
import { z } from 'zod';

import { refreshExtensionSession } from '@/lib/server/extension-auth-service';
import { enforceExtensionRequestLimit, ExtensionRequestSecurityError, readBoundedExtensionJson } from '@/lib/server/extension-request-security';
import { extensionCorsHeaders } from '../_shared';

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: extensionCorsHeaders }); }
export async function POST(request: Request) {
  try {
    const { refreshToken } = z.object({ refreshToken: z.string().min(20).max(200) }).parse(await readBoundedExtensionJson(request));
    await enforceExtensionRequestLimit({ request, action: 'refresh', subject: refreshToken });
    return NextResponse.json(await refreshExtensionSession(refreshToken), { headers: extensionCorsHeaders });
  } catch (error) {
    if (error instanceof ExtensionRequestSecurityError) {
      return NextResponse.json({ error: { message: error.message } }, {
        status: error.status,
        headers: {
          ...extensionCorsHeaders,
          ...(error.retryAfterSeconds ? { 'Retry-After': String(error.retryAfterSeconds) } : {}),
        },
      });
    }
    return NextResponse.json({ error: { message: 'Reconnect the extension.' } }, { status: 401, headers: extensionCorsHeaders });
  }
}
