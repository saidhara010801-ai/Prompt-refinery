import { NextRequest } from 'next/server';
import { z } from 'zod';

import { searchAdminUsers } from '@/lib/server/admin-service';
import { adminJson } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  search: z.string().max(160).default(''),
  pageSize: z.number().int().min(1).max(25).optional(),
  pageToken: z.string().max(200).optional().nullable(),
});

export async function POST(request: NextRequest) {
  return adminJson(async () => {
    const parsed = schema.parse(await request.json().catch(() => ({})));
    return searchAdminUsers(request, parsed.search, parsed.pageSize, parsed.pageToken);
  }, request, 'admin.user_search');
}
