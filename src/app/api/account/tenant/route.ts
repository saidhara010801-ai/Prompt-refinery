import { NextResponse } from 'next/server';

import { getBearerTokenFromRequest, AuthorizationError } from '@/lib/server/user-access';
import { getTenantAccountSummary } from '@/lib/server/tenant-service';
import { getAdvertisedTaskCosts, hasManagedRemoteProvider, isLocalInferenceFallbackActive } from '@/lib/managed-inference-config';
import { getVerifiedUserProfile } from '@/lib/server/account-service';
import { readFreeInferenceAllowance } from '@/lib/server/free-inference-control';
import { FREE_TASK_UNITS } from '@/lib/free-inference';
import { tenantUsesFreeManagedInference } from '@/lib/server/free-inference-gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const token = getBearerTokenFromRequest(request);
    if (!token) throw new AuthorizationError('Sign in to view your workspace.', 401, 'AuthenticationRequiredError');
    await getVerifiedUserProfile(token);
    const summary = await getTenantAccountSummary(token);
    const [allowance, freeManagedInference] = await Promise.all([
      readFreeInferenceAllowance(summary.tenantId),
      tenantUsesFreeManagedInference(summary),
    ]);
    return NextResponse.json({
      ...summary,
      taskCosts: getAdvertisedTaskCosts(),
      freeTaskUnits: FREE_TASK_UNITS,
      allowance,
      usesFreeManagedInference: freeManagedInference,
      capabilities: {
        byok: process.env.ENABLE_BYOK === 'true',
        developerApi: process.env.ENABLE_PUBLIC_API === 'true',
        extension: process.env.ENABLE_EXTENSION_ACCOUNT_LINKING === 'true',
        razorpay: process.env.ENABLE_RAZORPAY_BILLING === 'true',
        inference: freeManagedInference || hasManagedRemoteProvider()
          ? 'managed'
          : isLocalInferenceFallbackActive()
            ? 'local-fallback'
            : 'unavailable',
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : 'Workspace unavailable.' } }, {
      status: error instanceof AuthorizationError ? error.status : 400,
    });
  }
}
