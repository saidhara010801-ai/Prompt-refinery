import type { NextRequest } from 'next/server';

import { readBetaEvidenceReport } from '@/lib/server/admin-service';
import { adminJson } from '../_shared';

export async function GET(request: NextRequest) {
  const windowDays = Number(request.nextUrl.searchParams.get('days') ?? 30);
  return adminJson(
    () => readBetaEvidenceReport(request, windowDays),
    request,
    'admin.beta_evidence_report_read'
  );
}
