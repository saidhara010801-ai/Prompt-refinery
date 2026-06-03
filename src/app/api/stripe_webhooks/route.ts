import { NextResponse } from 'next/server';
import Stripe from 'stripe';

import { getAdminFirestore } from '@/lib/server/firebase-admin';

export const runtime = 'nodejs';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

async function updateSubscriptionProfile(
  uid: string,
  subscription: Stripe.Subscription,
  tier: 'free' | 'pro'
) {
  await getAdminFirestore().doc(`users/${uid}`).set({
    id: uid,
    subscriptionTier: tier,
    subscriptionStatus: subscription.status,
    stripeCustomerId: typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id,
    stripeSubscriptionId: subscription.id,
    updatedAt: new Date(),
  }, { merge: true });
}

export async function POST(request: Request) {
  if (!stripeSecretKey || !stripeWebhookSecret) {
    return NextResponse.json({ error: 'Stripe webhooks are not configured.' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing Stripe signature.' }, { status: 400 });
  }

  const stripe = new Stripe(stripeSecretKey);
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, stripeWebhookSecret);
  } catch (error) {
    console.error('Rejected Stripe webhook:', error);
    return NextResponse.json({ error: 'Invalid Stripe signature.' }, { status: 400 });
  }

  try {
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription;
      const uid = subscription.metadata.firebaseUid;
      if (uid) {
        const active = subscription.status === 'active' || subscription.status === 'trialing';
        await updateSubscriptionProfile(uid, subscription, active ? 'pro' : 'free');
      }
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const uid = session.metadata?.firebaseUid;
      if (uid && typeof session.subscription === 'string') {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        const active = subscription.status === 'active' || subscription.status === 'trialing';
        await updateSubscriptionProfile(uid, subscription, active ? 'pro' : 'free');
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Could not fulfill Stripe webhook:', error);
    return NextResponse.json({ error: 'Webhook fulfillment failed.' }, { status: 500 });
  }
}
