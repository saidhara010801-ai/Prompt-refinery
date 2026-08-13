import { NextResponse } from 'next/server';

import { revokeExtensionSession } from '@/lib/server/extension-auth-service';
import { extensionCorsHeaders } from '../_shared';

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: extensionCorsHeaders }); }
export async function POST(request: Request) {
  try { return NextResponse.json(await revokeExtensionSession(request), { headers: extensionCorsHeaders }); }
  catch { return NextResponse.json({ error: { message: 'Extension session is already disconnected.' } }, { status: 401, headers: extensionCorsHeaders }); }
}
