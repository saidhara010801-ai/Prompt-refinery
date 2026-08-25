import { NextResponse } from 'next/server';

import { authenticatePublicApi } from '@/lib/server/api-key-service';
import { inferenceAllowancePlan, readFreeInferenceAllowance } from '@/lib/server/free-inference-control';
import { getTenantAccountSummaryForUid } from '@/lib/server/tenant-service';
import { publicApiError } from '../_shared';

export async function GET(request: Request) {
  try {
    const caller = await authenticatePublicApi(request, 'usage:read');
    const summary = await getTenantAccountSummaryForUid(caller.uid, caller.context);
    const allowance = await readFreeInferenceAllowance(
      caller.context.tenantId,
      new Date(),
      inferenceAllowancePlan(summary.plan)
    );
    return NextResponse.json({
      plan: summary.plan,
      planStatus: summary.planStatus,
      developer: summary.developer,
      credits: {
        balance: summary.balance,
        reserved: summary.reserved,
        available: summary.available,
      },
      allowance,
    });
  } catch (error) {
    return publicApiError(error);
  }
}
