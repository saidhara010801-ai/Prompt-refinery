import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { redeemPromoCode } from '@/lib/server/promo-service';
import { AuthorizationError } from '@/lib/server/user-access';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = z.object({ code: z.string().trim().min(8).max(100) }).parse(await request.json());
    return NextResponse.json(await redeemPromoCode(request, body.code));
  } catch (error) {
    const status = error instanceof AuthorizationError ? error.status : error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: { code: error instanceof Error ? error.name : 'PromoError', message: error instanceof Error ? error.message : 'Could not redeem this promo code.' } }, { status });
  }
}
