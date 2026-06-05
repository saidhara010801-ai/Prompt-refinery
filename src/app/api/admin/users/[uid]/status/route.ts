import { NextRequest } from 'next/server';
import { z } from 'zod';

import { updateAccountStatus } from '@/lib/server/admin-service';
import { adminJson } from '../../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  accountStatus: z.enum(['active', 'disabled', 'suspended', 'deleted_pending']),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ uid: string }> }) {
  return adminJson(async () => {
    const { uid } = await params;
    const parsed = schema.parse(await request.json());
    return updateAccountStatus(request, uid, parsed.accountStatus);
  }, request, 'admin.account_status_change');
}
