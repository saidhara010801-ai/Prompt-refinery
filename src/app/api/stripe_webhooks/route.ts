import { NextResponse } from 'next/server';
import Stripe from 'stripe';

import {
  applyStripeSubscriptionPatch,
  buildStripeSubscriptionPatch,
  findUidForStripeCustomer,
  getStripeCustomerId,
  getWebhookSubscriptionIds,
  recordStripeWebhookEvent,
  reserveStripeWebhookEvent,
} from '@/lib/server/stripe-billing';

export const runtime = 'nodejs';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

async function resolveUidForSubscription(subscription: Stripe.Subscription): Promise<string | null> {
  const metadataUid = subscription.metadata.firebaseUid;
  if (metadataUid) {
    return metadataUid;
  }

  const stripeCustomerId = getStripeCustomerId(subscription.customer);
  return stripeCustomerId ? findUidForStripeCustomer(stripeCustomerId) : null;
}

async function applySubscriptionEvent(event: Stripe.Event, subscription: Stripe.Subscription) {
  const uid = await resolveUidForSubscription(subscription);
  const ids = getWebhookSubscriptionIds(subscription);
  if (!uid) {
    await recordStripeWebhookEvent({
      eventId: event.id,
      type: event.type,
      processingStatus: 'failed',
      relatedUid: null,
      ...ids,
      errorCode: 'user_lookup_failed',
    });
    return;
  }

  const patch = buildStripeSubscriptionPatch(subscription);
  if (!patch) {
    await recordStripeWebhookEvent({
      eventId: event.id,
      type: event.type,
      processingStatus: 'failed',
      relatedUid: uid,
      ...ids,
      errorCode: 'customer_lookup_failed',
    });
    return;
  }

  await applyStripeSubscriptionPatch(uid, patch);
  await recordStripeWebhookEvent({
    eventId: event.id,
    type: event.type,
    processingStatus: 'processed',
    relatedUid: uid,
    stripeCustomerId: patch.stripeCustomerId,
    stripeSubscriptionId: patch.stripeSubscriptionId,
    errorCode: null,
  });
}

async function retrieveInvoiceSubscription(stripe: Stripe, invoice: Stripe.Invoice): Promise<Stripe.Subscription | null> {
  const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
  return subscriptionId ? stripe.subscriptions.retrieve(subscriptionId) : null;
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
  } catch {
    return NextResponse.json({ error: 'Invalid Stripe signature.' }, { status: 400 });
  }

  const shouldProcess = await reserveStripeWebhookEvent(event.id, event.type);
  if (!shouldProcess) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      await applySubscriptionEvent(event, event.data.object as Stripe.Subscription);
      return NextResponse.json({ received: true });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const uid = session.metadata?.firebaseUid ?? session.client_reference_id ?? null;
      if (typeof session.subscription !== 'string') {
        await recordStripeWebhookEvent({
          eventId: event.id,
          type: event.type,
          processingStatus: 'failed',
          relatedUid: uid,
          stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
          stripeSubscriptionId: null,
          errorCode: 'subscription_lookup_failed',
        });
        return NextResponse.json({ received: true });
      }

      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      await applySubscriptionEvent(event, subscription);
      return NextResponse.json({ received: true });
    }

    if (event.type === 'invoice.payment_failed' || event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object as Stripe.Invoice;
      const subscription = await retrieveInvoiceSubscription(stripe, invoice);
      if (!subscription) {
        await recordStripeWebhookEvent({
          eventId: event.id,
          type: event.type,
          processingStatus: 'failed',
          relatedUid: null,
          stripeCustomerId: typeof invoice.customer === 'string' ? invoice.customer : null,
          stripeSubscriptionId: null,
          errorCode: 'subscription_lookup_failed',
        });
        return NextResponse.json({ received: true });
      }

      await applySubscriptionEvent(event, subscription);
      return NextResponse.json({ received: true });
    }

    await recordStripeWebhookEvent({
      eventId: event.id,
      type: event.type,
      processingStatus: 'ignored',
      errorCode: 'event_type_ignored',
    });
    return NextResponse.json({ received: true, ignored: true });
  } catch (error) {
    await recordStripeWebhookEvent({
      eventId: event.id,
      type: event.type,
      processingStatus: 'failed',
      errorCode: error instanceof Error ? error.name : 'webhook_processing_failed',
    });
    console.error('Could not fulfill Stripe webhook:', {
      eventType: event.type,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: 'Webhook fulfillment failed.' }, { status: 500 });
  }
}
