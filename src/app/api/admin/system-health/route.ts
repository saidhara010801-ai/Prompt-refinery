import { NextRequest } from 'next/server';

import { readSafeSystemHealth } from '@/lib/server/admin-service';
import { adminJson } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return adminJson(async () => readSafeSystemHealth(request), request, 'admin.system_health_read');
}
