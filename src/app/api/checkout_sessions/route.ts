import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

import { getCheckoutReturnOrigin } from '@/lib/server/checkout-origin';
import { consumeRequestLimit, getClientIp } from '@/lib/server/request-rate-limit';
import { assertActiveAccount, getBearerTokenFromRequest, getCurrentUserFromRequest } from '@/lib/server/user-access';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeProPriceId = process.env.STRIPE_PRO_PRICE_ID;

export async function POST(request: NextRequest) {
  const rateLimit = consumeRequestLimit({
    bucket: 'stripe-checkout',
    key: getClientIp(request),
    limit: 10,
    windowMs: 60 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: { message: 'Too many checkout attempts. Wait a while and try again.' } },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
    );
  }

  if (process.env.ENABLE_STRIPE_CHECKOUT === 'false' || !stripeSecretKey || !stripeProPriceId) {
    return NextResponse.json(
      { error: { message: 'Stripe Pro checkout is not configured on this server.' } },
      { status: 503 }
    );
  }

  const firebaseIdToken = getBearerTokenFromRequest(request);
  if (!firebaseIdToken) {
    return NextResponse.json({ error: { message: 'Sign in to upgrade to Pro.' } }, { status: 401 });
  }

  try {
    const currentUser = await getCurrentUserFromRequest(request);
    assertActiveAccount(currentUser.profile, 'create checkout sessions');

    const origin = getCheckoutReturnOrigin(request.url);
    const stripe = new Stripe(stripeSecretKey);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      client_reference_id: currentUser.uid,
      customer_email: currentUser.email || currentUser.decodedToken.email,
      line_items: [{ price: stripeProPriceId, quantity: 1 }],
      metadata: { firebaseUid: currentUser.uid },
      subscription_data: {
        metadata: { firebaseUid: currentUser.uid },
      },
      success_url: `${origin}/?upgrade=success`,
      cancel_url: `${origin}/?upgrade=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Could not create Stripe subscription checkout:', error);
    return NextResponse.json(
      { error: { message: 'Could not start Pro checkout. Please sign in again and retry.' } },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    configured: Boolean(stripeSecretKey && stripeProPriceId),
    product: 'Prompt Refinery Pro',
  });
}
