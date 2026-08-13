import { NextResponse } from 'next/server';
import { z } from 'zod';

import { exchangeExtensionLink } from '@/lib/server/extension-auth-service';
import { extensionCorsHeaders } from '../../_shared';

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: extensionCorsHeaders }); }
export async function POST(request: Request) {
  try {
    const { deviceCode } = z.object({ deviceCode: z.string().min(20).max(200) }).parse(await request.json());
    const result = await exchangeExtensionLink(deviceCode);
    return NextResponse.json(result, { status: result.status === 'expired' || result.status === 'used' ? 410 : 200, headers: extensionCorsHeaders });
  } catch {
    return NextResponse.json({ error: { message: 'Could not complete extension linking.' } }, { status: 400, headers: extensionCorsHeaders });
  }
}
