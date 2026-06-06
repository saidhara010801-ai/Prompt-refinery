import { NextRequest } from 'next/server';

import { readAdminEntitlement } from '@/lib/server/admin-service';
import { adminJson } from '../../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ uid: string }> }) {
  return adminJson(async () => {
    const { uid } = await params;
    return readAdminEntitlement(request, uid);
  }, request, 'admin.entitlement_read');
}
