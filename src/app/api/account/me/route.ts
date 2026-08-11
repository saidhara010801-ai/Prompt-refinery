import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUserFromRequest, AuthorizationError } from '@/lib/server/user-access';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const context = await getCurrentUserFromRequest(request);
    return NextResponse.json({
      uid: context.uid,
      email: context.email,
      role: context.role,
      accountStatus: context.profile.accountStatus,
      entitlement: {
        tier: context.entitlement.tier,
        isPro: context.entitlement.isPro,
        source: context.entitlement.source,
        label: context.entitlement.isPro && context.entitlement.source === 'promo' ? 'Pro — Promo' : context.entitlement.isPro ? 'Pro' : 'Free',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : 'Unauthorized' } }, { status: error instanceof AuthorizationError ? error.status : 500 });
  }
}
