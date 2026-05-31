import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

import { getAdminAuth } from '@/lib/server/firebase-admin';
import { getVerifiedUserProfile } from '@/lib/server/account-service';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeProPriceId = process.env.STRIPE_PRO_PRICE_ID;

function getBearerToken(request: NextRequest): string | undefined {
  const authorization = request.headers.get('authorization');
  return authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
}

export async function POST(request: NextRequest) {
  if (!stripeSecretKey || !stripeProPriceId) {
    return NextResponse.json(
      { error: { message: 'Stripe Pro checkout is not configured on this server.' } },
      { status: 503 }
    );
  }

  const firebaseIdToken = getBearerToken(request);
  if (!firebaseIdToken) {
    return NextResponse.json({ error: { message: 'Sign in to upgrade to Pro.' } }, { status: 401 });
  }

  try {
    const decodedToken = await getAdminAuth().verifyIdToken(firebaseIdToken);
    await getVerifiedUserProfile(firebaseIdToken);

    const origin = request.headers.get('origin') || 'http://localhost:9002';
    const stripe = new Stripe(stripeSecretKey);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      client_reference_id: decodedToken.uid,
      customer_email: decodedToken.email,
      line_items: [{ price: stripeProPriceId, quantity: 1 }],
      metadata: { firebaseUid: decodedToken.uid },
      subscription_data: {
        metadata: { firebaseUid: decodedToken.uid },
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
