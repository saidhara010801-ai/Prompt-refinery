import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

import { assertActiveAccountForCheckout } from '@/lib/server/account-service';
import { getCheckoutReturnOrigin } from '@/lib/server/checkout-origin';
import { consumeRequestLimit, getClientIp } from '@/lib/server/request-rate-limit';
import {
  buildCheckoutSessionParams,
  getCountryFromRequest,
  getLocaleFromRequest,
  isPromotionCodesEnabled,
  isStripeCheckoutEnabled,
  requireAllowedBrowserPostOrigin,
  selectStripePriceForUser,
} from '@/lib/server/stripe-billing';
import { AuthorizationError, getBearerTokenFromRequest, getCurrentUserFromRequest } from '@/lib/server/user-access';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

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

  if (!isStripeCheckoutEnabled() || !stripeSecretKey) {
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
    requireAllowedBrowserPostOrigin(request);
    const currentUser = await getCurrentUserFromRequest(request);
    await assertActiveAccountForCheckout(currentUser.uid);

    const origin = getCheckoutReturnOrigin(request.url);
    const price = selectStripePriceForUser({
      country: getCountryFromRequest(request),
      locale: getLocaleFromRequest(request),
    });
    const stripe = new Stripe(stripeSecretKey);
    const session = await stripe.checkout.sessions.create(buildCheckoutSessionParams({
      uid: currentUser.uid,
      email: currentUser.email || currentUser.decodedToken.email,
      priceId: price.priceId,
      origin,
      allowPromotionCodes: isPromotionCodesEnabled(),
    }));

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Could not create Stripe subscription checkout:', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    if (error instanceof Error && error.name === 'OriginNotAllowedError') {
      return NextResponse.json({ error: { message: 'Request origin is not allowed.' } }, { status: 403 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    }
    return NextResponse.json(
      { error: { message: 'Could not start Pro checkout. Please sign in again and retry.' } },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    configured: Boolean(stripeSecretKey && (process.env.STRIPE_PRO_PRICE_ID || process.env.STRIPE_PRO_PRICE_ID_DEFAULT || process.env.STRIPE_PRO_PRICE_ID_USD)),
    product: 'Prompt Refinery Pro',
  });
}
