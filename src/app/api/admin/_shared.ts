import { NextResponse } from 'next/server';

import { auditUnauthorizedAdminAttempt } from '@/lib/server/admin-service';
import { AuthorizationError } from '@/lib/server/user-access';

export async function adminJson(handler: () => Promise<unknown>, request: Request, action: string) {
  if (process.env.ENABLE_ADMIN_CENTER === 'false') {
    return NextResponse.json({ error: { message: 'Admin center is disabled.' } }, { status: 503 });
  }

  try {
    return NextResponse.json(await handler(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      await auditUnauthorizedAdminAttempt(request, action, error);
      return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    }

    console.error(`Admin API failed: ${action}`, error);
    return NextResponse.json({ error: { message: 'Admin request failed.' } }, { status: 500 });
  }
}
