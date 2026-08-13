import { NextResponse } from 'next/server';
import { z } from 'zod';

import { recordCheckoutVerification } from '@/lib/server/razorpay-billing';
import { getCurrentUserFromRequest, AuthorizationError } from '@/lib/server/user-access';
import { resolveTenantForUid } from '@/lib/server/tenant-service';

export async function POST(request: Request) {
  try {
    const user = await getCurrentUserFromRequest(request);
    const input = z.object({
      localOrderId: z.string().min(1).max(200),
      razorpayOrderId: z.string().min(1).max(200),
      razorpayPaymentId: z.string().min(1).max(200),
      signature: z.string().min(32).max(256),
    }).parse(await request.json());
    return NextResponse.json(await recordCheckoutVerification({ context: await resolveTenantForUid(user.uid), ...input }));
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : 'Payment verification failed.' } }, {
      status: error instanceof AuthorizationError ? error.status : error instanceof z.ZodError ? 400 : 400,
    });
  }
}
