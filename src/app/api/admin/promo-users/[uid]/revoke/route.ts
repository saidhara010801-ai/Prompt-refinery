import { NextRequest } from 'next/server';

import { adminJson } from '../../../_shared';
import { revokePromoUser } from '@/lib/server/promo-service';

export async function POST(request: NextRequest, { params }: { params: Promise<{ uid: string }> }) {
  return adminJson(async () => revokePromoUser(request, (await params).uid), request, 'admin.promo_user_revoke');
}
