import { NextRequest } from 'next/server';

import { adminJson } from '../_shared';
import { listPromoUsers } from '@/lib/server/promo-service';

export async function GET(request: NextRequest) {
  return adminJson(() => listPromoUsers(request), request, 'admin.promo_users_list');
}
