import { NextRequest } from 'next/server';
import { z } from 'zod';

import { grantPro } from '@/lib/server/admin-service';
import { adminJson } from '../../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  source: z.enum(['manual', 'team', 'beta', 'test']).default('manual'),
  reason: z.string().trim().min(1).max(240).default('Admin grant'),
  expiresAt: z.string().datetime().optional().nullable(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ uid: string }> }) {
  return adminJson(async () => {
    const { uid } = await params;
    const parsed = schema.parse(await request.json().catch(() => ({})));
    return grantPro(request, uid, parsed.source, parsed.reason, parsed.expiresAt ? new Date(parsed.expiresAt) : null);
  }, request, 'admin.pro_grant');
}
