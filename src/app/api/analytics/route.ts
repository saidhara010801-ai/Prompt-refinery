import { NextResponse } from 'next/server';

import { getUsageDashboard } from '@/lib/server/usage-analytics';
import { AuthorizationError } from '@/lib/server/user-access';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    return NextResponse.json(await getUsageDashboard(request));
  } catch (error) {
    const status = error instanceof AuthorizationError ? error.status : error instanceof Error && error.name === 'ProFeatureRequiredError' ? 403 : error instanceof Error && error.name === 'AnalyticsDisabledError' ? 503 : 500;
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : 'Could not load analytics.' } }, { status });
  }
}
