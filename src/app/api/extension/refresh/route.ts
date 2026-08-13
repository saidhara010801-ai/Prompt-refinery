import { NextResponse } from 'next/server';
import { z } from 'zod';

import { refreshExtensionSession } from '@/lib/server/extension-auth-service';
import { extensionCorsHeaders } from '../_shared';

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: extensionCorsHeaders }); }
export async function POST(request: Request) {
  try {
    const { refreshToken } = z.object({ refreshToken: z.string().min(20).max(200) }).parse(await request.json());
    return NextResponse.json(await refreshExtensionSession(refreshToken), { headers: extensionCorsHeaders });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : 'Reconnect the extension.' } }, { status: 401, headers: extensionCorsHeaders });
  }
}
