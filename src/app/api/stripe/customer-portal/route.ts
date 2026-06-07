import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

import { assertActiveAccountForCheckout } from '@/lib/server/account-service';
import { getCheckoutReturnOrigin } from '@/lib/server/checkout-origin';
import { consumeRequestLimit, getClientIp } from '@/lib/server/request-rate-limit';
import { buildBillingPortalSessionParams, requireAllowedBrowserPostOrigin } from '@/lib/server/stripe-billing';
import { AuthorizationError, getBearerTokenFromRequest, getCurrentUserFromRequest } from '@/lib/server/user-access';

export const runtime = 'nodejs';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

export async function POST(request: NextRequest) {
  const rateLimit = consumeRequestLimit({
    bucket: 'stripe-customer-portal',
    key: getClientIp(request),
    limit: 10,
    windowMs: 60 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: { message: 'Too many billing portal attempts. Wait a while and try again.' } },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
    );
  }

  if (!stripeSecretKey) {
    return NextResponse.json(
      { error: { message: 'Stripe Billing Portal is not configured on this server.' } },
      { status: 503 }
    );
  }

  if (!getBearerTokenFromRequest(request)) {
    return NextResponse.json({ error: { message: 'Sign in to manage billing.' } }, { status: 401 });
  }

  try {
    requireAllowedBrowserPostOrigin(request);
    const currentUser = await getCurrentUserFromRequest(request);
    const profile = await assertActiveAccountForCheckout(currentUser.uid);
    if (!profile.stripeCustomerId) {
      return NextResponse.json(
        { error: { message: 'No Stripe customer is linked to this account yet.' } },
        { status: 404 }
      );
    }

    const stripe = new Stripe(stripeSecretKey);
    const session = await stripe.billingPortal.sessions.create(buildBillingPortalSessionParams({
      stripeCustomerId: profile.stripeCustomerId,
      origin: getCheckoutReturnOrigin(request.url),
    }));

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Could not create Stripe Billing Portal session:', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    if (error instanceof Error && error.name === 'OriginNotAllowedError') {
      return NextResponse.json({ error: { message: 'Request origin is not allowed.' } }, { status: 403 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    }
    return NextResponse.json(
      { error: { message: 'Could not open billing portal. Sign in again and retry.' } },
      { status: 500 }
    );
  }
}
