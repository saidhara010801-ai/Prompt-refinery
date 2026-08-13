import { NextResponse } from 'next/server';

import { getCheckoutReturnOrigin } from '@/lib/server/checkout-origin';
import { startExtensionLink } from '@/lib/server/extension-auth-service';
import { extensionCorsHeaders } from '../../_shared';

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: extensionCorsHeaders }); }
export async function POST(request: Request) {
  try {
    if (process.env.ENABLE_EXTENSION_ACCOUNT_LINKING !== 'true') {
      return NextResponse.json({ error: { message: 'Extension account linking is not enabled.' } }, { status: 503, headers: extensionCorsHeaders });
    }
    return NextResponse.json(await startExtensionLink(getCheckoutReturnOrigin(request.url)), { status: 201, headers: extensionCorsHeaders });
  } catch {
    return NextResponse.json({ error: { message: 'Could not start extension linking.' } }, { status: 500, headers: extensionCorsHeaders });
  }
}
