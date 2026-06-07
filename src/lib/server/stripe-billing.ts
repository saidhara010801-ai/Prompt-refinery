import { Timestamp } from 'firebase-admin/firestore';
import type Stripe from 'stripe';

import { getAdminFirestore } from './firebase-admin';
import { getCheckoutReturnOrigin } from './checkout-origin';

type Environment = Record<string, string | undefined>;

export type StripeWebhookProcessingStatus = 'processed' | 'failed' | 'ignored';

export interface StripePriceSelectionInput {
  country?: string | null;
  locale?: string | null;
}

export interface StripePriceSelection {
  priceId: string;
  currency: 'inr' | 'usd' | 'default';
}

export interface StripeWebhookEventRecord {
  eventId: string;
  type: string;
  processingStatus: StripeWebhookProcessingStatus;
  processedAt: Timestamp;
  relatedUid: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  errorCode: string | null;
}

export interface StripeSubscriptionPatch {
  subscriptionTier: 'free' | 'pro';
  subscriptionSource: 'stripe' | null;
  subscriptionStatus: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}

export function isStripeCheckoutEnabled(environment: Environment = process.env): boolean {
  return environment.ENABLE_STRIPE_CHECKOUT !== 'false';
}

export function isPromotionCodesEnabled(environment: Environment = process.env): boolean {
  return environment.ENABLE_PROMOTION_CODES === 'true';
}

function firstConfigured(...values: Array<string | undefined>): string | null {
  return values.map((value) => value?.trim()).find(Boolean) ?? null;
}

export function selectStripePriceForUser(
  input: StripePriceSelectionInput,
  environment: Environment = process.env
): StripePriceSelection {
  const defaultPrice = firstConfigured(
    environment.STRIPE_PRO_PRICE_ID_DEFAULT,
    environment.STRIPE_PRO_PRICE_ID_USD,
    environment.STRIPE_PRO_PRICE_ID
  );
  const usdPrice = firstConfigured(environment.STRIPE_PRO_PRICE_ID_USD, defaultPrice ?? undefined);
  const inrPrice = firstConfigured(environment.STRIPE_PRO_PRICE_ID_INR);
  const country = input.country?.trim().toUpperCase();
  const locale = input.locale?.trim().toLowerCase();
  const isIndia = country === 'IN' || Boolean(locale?.endsWith('-in') || locale === 'hi-in' || locale === 'en-in');
  const isUs = country === 'US' || Boolean(locale?.endsWith('-us') || locale === 'en-us');

  if (isIndia && inrPrice) {
    return { priceId: inrPrice, currency: 'inr' };
  }

  if (isUs && usdPrice) {
    return { priceId: usdPrice, currency: 'usd' };
  }

  if (defaultPrice) {
    return { priceId: defaultPrice, currency: defaultPrice === environment.STRIPE_PRO_PRICE_ID_INR ? 'inr' : 'default' };
  }

  throw new Error('Stripe Pro price is not configured.');
}

export function getCountryFromRequest(request: Request): string | null {
  return request.headers.get('x-vercel-ip-country') ||
    request.headers.get('x-appengine-country') ||
    request.headers.get('cf-ipcountry') ||
    null;
}

export function getLocaleFromRequest(request: Request): string | null {
  return request.headers.get('accept-language')?.split(',')[0]?.trim() || null;
}

export function isAllowedBrowserPostOrigin(
  originHeader: string | null,
  requestUrl: string,
  environment: Environment = process.env
): boolean {
  if (!originHeader) {
    return environment.NODE_ENV !== 'production';
  }

  try {
    return new URL(originHeader).origin === getCheckoutReturnOrigin(requestUrl, environment);
  } catch {
    return false;
  }
}

export function requireAllowedBrowserPostOrigin(request: Request, environment: Environment = process.env) {
  if (!isAllowedBrowserPostOrigin(request.headers.get('origin'), request.url, environment)) {
    const error = new Error('Request origin is not allowed.');
    error.name = 'OriginNotAllowedError';
    throw error;
  }
}

export function buildCheckoutSessionParams(input: {
  uid: string;
  email?: string | null;
  priceId: string;
  origin: string;
  allowPromotionCodes: boolean;
}): Stripe.Checkout.SessionCreateParams {
  return {
    mode: 'subscription',
    client_reference_id: input.uid,
    customer_email: input.email ?? undefined,
    line_items: [{ price: input.priceId, quantity: 1 }],
    allow_promotion_codes: input.allowPromotionCodes || undefined,
    metadata: { firebaseUid: input.uid },
    subscription_data: {
      metadata: { firebaseUid: input.uid },
    },
    success_url: `${input.origin}/?upgrade=success`,
    cancel_url: `${input.origin}/?upgrade=cancelled`,
  };
}

export function buildBillingPortalSessionParams(input: {
  stripeCustomerId: string;
  origin: string;
}): Stripe.BillingPortal.SessionCreateParams {
  return {
    customer: input.stripeCustomerId,
    return_url: input.origin,
  };
}

export function getStripeCustomerId(value: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!value) {
    return null;
  }
  return typeof value === 'string' ? value : value.id;
}

export function isStripeSubscriptionActive(status: Stripe.Subscription.Status | string): boolean {
  return status === 'active' || status === 'trialing';
}

export function buildStripeSubscriptionPatch(subscription: Pick<Stripe.Subscription, 'id' | 'status' | 'customer'>): StripeSubscriptionPatch | null {
  const stripeCustomerId = getStripeCustomerId(subscription.customer);
  if (!stripeCustomerId) {
    return null;
  }

  const active = isStripeSubscriptionActive(subscription.status);
  return {
    subscriptionTier: active ? 'pro' : 'free',
    subscriptionSource: active ? 'stripe' : null,
    subscriptionStatus: subscription.status,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
  };
}

export function buildStripeWebhookEventRecord(input: {
  eventId: string;
  type: string;
  processingStatus: StripeWebhookProcessingStatus;
  relatedUid?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  errorCode?: string | null;
}): StripeWebhookEventRecord {
  return {
    eventId: input.eventId,
    type: input.type,
    processingStatus: input.processingStatus,
    processedAt: Timestamp.now(),
    relatedUid: input.relatedUid ?? null,
    stripeCustomerId: input.stripeCustomerId ?? null,
    stripeSubscriptionId: input.stripeSubscriptionId ?? null,
    errorCode: input.errorCode ?? null,
  };
}

export async function recordStripeWebhookEvent(input: Parameters<typeof buildStripeWebhookEventRecord>[0]) {
  await getAdminFirestore()
    .doc(`stripeWebhookEvents/${input.eventId}`)
    .set(buildStripeWebhookEventRecord(input), { merge: true });
}

export async function hasProcessedStripeWebhookEvent(eventId: string): Promise<boolean> {
  const snapshot = await getAdminFirestore().doc(`stripeWebhookEvents/${eventId}`).get();
  return snapshot.exists && snapshot.data()?.processingStatus === 'processed';
}

export async function reserveStripeWebhookEvent(eventId: string, type: string): Promise<boolean> {
  const eventRef = getAdminFirestore().doc(`stripeWebhookEvents/${eventId}`);
  return getAdminFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(eventRef);
    const existingStatus = snapshot.data()?.processingStatus;
    if (existingStatus === 'processed' || existingStatus === 'ignored') {
      return false;
    }

    transaction.set(eventRef, buildStripeWebhookEventRecord({
      eventId,
      type,
      processingStatus: 'ignored',
      errorCode: 'processing_reserved',
    }), { merge: true });
    return true;
  });
}

export async function findUidForStripeCustomer(stripeCustomerId: string): Promise<string | null> {
  const snapshot = await getAdminFirestore()
    .collection('users')
    .where('stripeCustomerId', '==', stripeCustomerId)
    .limit(1)
    .get();
  return snapshot.docs[0]?.id ?? null;
}

export async function applyStripeSubscriptionPatch(uid: string, patch: StripeSubscriptionPatch) {
  await getAdminFirestore().doc(`users/${uid}`).set({
    id: uid,
    ...patch,
    updatedAt: Timestamp.now(),
  }, { merge: true });
}

export function getWebhookSubscriptionIds(subscription: Pick<Stripe.Subscription, 'id' | 'customer'>) {
  return {
    stripeCustomerId: getStripeCustomerId(subscription.customer),
    stripeSubscriptionId: subscription.id,
  };
}
