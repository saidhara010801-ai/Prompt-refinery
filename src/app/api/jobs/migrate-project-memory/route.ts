import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isAuthorizedJobRequest } from '@/lib/server/job-auth';
import { migrateProjectMemoryPage } from '@/lib/server/project-memory-migration';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isAuthorizedJobRequest(request)) return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
  try {
    const input = z.object({ apply: z.boolean().default(false), limit: z.number().int().min(1).max(500).optional(), pageToken: z.string().max(1000).nullable().optional() }).parse(await request.json());
    return NextResponse.json(await migrateProjectMemoryPage(input));
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : 'Migration failed.' } }, { status: 400 });
  }
}
