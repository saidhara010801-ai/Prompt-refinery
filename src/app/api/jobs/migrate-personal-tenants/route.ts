import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isAuthorizedJobRequest } from '@/lib/server/job-auth';
import { migrateTenantUsersPage } from '@/lib/server/tenant-migration';

export async function POST(request: Request) {
  try {
    if (!isAuthorizedJobRequest(request)) {
      return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    }
    const input = z.object({ apply: z.boolean().default(false), limit: z.number().int().min(1).max(100).optional(), pageToken: z.string().max(200).nullable().optional() })
      .parse(await request.json().catch(() => ({})));
    return NextResponse.json(await migrateTenantUsersPage(input));
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : 'Migration failed.' } }, { status: 400 });
  }
}
