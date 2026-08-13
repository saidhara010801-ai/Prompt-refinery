import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createCreditPackOrder, createMonthlySubscription } from '@/lib/server/razorpay-billing';
import { getCurrentUserFromRequest, AuthorizationError } from '@/lib/server/user-access';
import { resolveTenantForUid } from '@/lib/server/tenant-service';
import { consumeDistributedLimit } from '@/lib/server/distributed-limits';

export async function POST(request: Request) {
  try {
    const user = await getCurrentUserFromRequest(request);
    const limit = await consumeDistributedLimit({ bucket: 'razorpay-checkout', key: user.uid, limit: 8, windowMs: 60 * 60 * 1000 });
    if (!limit.allowed) throw new AuthorizationError('Too many checkout attempts. Wait and try again.', 429, 'CheckoutRateLimitError');
    const input = z.object({ productCode: z.string().trim().min(1).max(80), kind: z.enum(['credit_pack', 'subscription']) }).parse(await request.json());
    const context = await resolveTenantForUid(user.uid);
    const result = input.kind === 'credit_pack'
      ? await createCreditPackOrder(context, input.productCode)
      : await createMonthlySubscription(context, input.productCode);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : 'Checkout unavailable.' } }, {
      status: error instanceof AuthorizationError ? error.status : error instanceof z.ZodError ? 400 : 503,
    });
  }
}
