import { NextRequest } from 'next/server';

import { adminJson } from '../../../_shared';
import { invalidatePromoCode } from '@/lib/server/promo-service';

export async function POST(request: NextRequest, { params }: { params: Promise<{ codeId: string }> }) {
  return adminJson(async () => invalidatePromoCode(request, (await params).codeId), request, 'admin.promo_invalidate');
}
