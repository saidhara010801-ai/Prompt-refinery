import { NextResponse } from 'next/server';
import { z } from 'zod';

import { exchangeExtensionLink } from '@/lib/server/extension-auth-service';
import { enforceExtensionRequestLimit, ExtensionRequestSecurityError, readBoundedExtensionJson } from '@/lib/server/extension-request-security';
import { extensionCorsHeaders } from '../../_shared';

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: extensionCorsHeaders }); }
export async function POST(request: Request) {
  try {
    const { deviceCode } = z.object({ deviceCode: z.string().min(20).max(200) }).parse(await readBoundedExtensionJson(request));
    await enforceExtensionRequestLimit({ request, action: 'exchange', subject: deviceCode });
    const result = await exchangeExtensionLink(deviceCode);
    return NextResponse.json(result, { status: result.status === 'expired' || result.status === 'used' ? 410 : 200, headers: extensionCorsHeaders });
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
    return NextResponse.json({ error: { message: 'Could not complete extension linking.' } }, { status: 400, headers: extensionCorsHeaders });
  }
}
