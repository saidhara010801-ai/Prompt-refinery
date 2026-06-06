import { NextRequest } from 'next/server';

import { readAuditLogs } from '@/lib/server/admin-service';
import { adminJson } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return adminJson(async () => {
    const url = new URL(request.url);
    const pageSize = Number(url.searchParams.get('pageSize') ?? undefined);
    const cursor = url.searchParams.get('cursor');
    return readAuditLogs(request, Number.isFinite(pageSize) ? pageSize : undefined, cursor);
  }, request, 'admin.audit_log_read');
}
