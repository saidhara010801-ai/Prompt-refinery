import { NextResponse } from 'next/server';

import { listSharedWithMe } from '@/lib/server/sharing-service';
import { AuthorizationError } from '@/lib/server/user-access';

export async function GET(request: Request) {
  try {
    return NextResponse.json({ shares: await listSharedWithMe(request) });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : 'Could not load shared items.' } }, { status: error instanceof AuthorizationError ? error.status : 403 });
  }
}
