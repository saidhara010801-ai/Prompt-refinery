import { NextRequest } from 'next/server';

import { revokePro } from '@/lib/server/admin-service';
import { adminJson } from '../../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ uid: string }> }) {
  return adminJson(async () => {
    const { uid } = await params;
    return revokePro(request, uid);
  }, request, 'admin.pro_revoke');
}
