import { createHash, createHmac } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';

import { grantCredits } from './credit-service';
import { getAdminFirestore } from './firebase-admin';
import type { TenantContext } from './tenant-service';
import { verifyRazorpayCheckoutSignature, verifyRazorpayWebhookSignature } from '@/lib/razorpay-signatures';

export { verifyRazorpayCheckoutSignature, verifyRazorpayWebhookSignature } from '@/lib/razorpay-signatures';

export interface CreditPackProduct {
  code: string;
  kind: 'credit_pack';
  displayName: string;
  amountSubunits: number;
  currency: 'INR';
  credits: number;
}

export interface MonthlyPlanProduct {
  code: string;
  kind: 'subscription';
  displayName: string;
  razorpayPlanId: string;
  currency: 'INR';
  creditsPerCycle: number;
  interval: 'monthly';
}

export type RazorpayProduct = CreditPackProduct | MonthlyPlanProduct;

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function configuredCatalog(environment: Record<string, string | undefined> = process.env): RazorpayProduct[] {
  let raw: unknown = null;
  try {
    raw = environment.RAZORPAY_CATALOG_JSON ? JSON.parse(environment.RAZORPAY_CATALOG_JSON) : null;
  } catch {
    raw = null;
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): RazorpayProduct[] => {
    if (!entry || typeof entry !== 'object') return [];
    const value = entry as Record<string, unknown>;
    const code = String(value.code || '').trim().slice(0, 80);
    const displayName = String(value.displayName || '').trim().slice(0, 120);
    if (!code || !displayName || value.currency !== 'INR') return [];
    if (value.kind === 'credit_pack') {
      const amountSubunits = positiveInteger(value.amountSubunits);
      const credits = positiveInteger(value.credits);
      return amountSubunits && credits ? [{ code, kind: 'credit_pack', displayName, amountSubunits, currency: 'INR', credits }] : [];
    }
    if (value.kind === 'subscription') {
      const razorpayPlanId = String(value.razorpayPlanId || '').trim();
      const creditsPerCycle = positiveInteger(value.creditsPerCycle);
      return razorpayPlanId && creditsPerCycle ? [{ code, kind: 'subscription', displayName, razorpayPlanId, currency: 'INR', creditsPerCycle, interval: 'monthly' }] : [];
    }
    return [];
  });
}

export function isRazorpayEnabled(environment: Record<string, string | undefined> = process.env) {
  return environment.ENABLE_RAZORPAY_BILLING === 'true';
}

export function getRazorpayCatalog(environment: Record<string, string | undefined> = process.env) {
  return configuredCatalog(environment);
}

export function publicRazorpayCatalog(environment: Record<string, string | undefined> = process.env) {
  return configuredCatalog(environment).map((product) => product.kind === 'credit_pack' ? {
    code: product.code,
    kind: product.kind,
    displayName: product.displayName,
    amountSubunits: product.amountSubunits,
    currency: product.currency,
    credits: product.credits,
  } : {
    code: product.code,
    kind: product.kind,
    displayName: product.displayName,
    currency: product.currency,
    creditsPerCycle: product.creditsPerCycle,
    interval: product.interval,
  });
}

function razorpayCredentials(environment: Record<string, string | undefined> = process.env) {
  const keyId = environment.RAZORPAY_KEY_ID?.trim();
  const keySecret = environment.RAZORPAY_KEY_SECRET?.trim();
  if (!isRazorpayEnabled(environment) || !keyId || !keySecret) throw new Error('Razorpay billing is not configured.');
  return { keyId, keySecret };
}

async function razorpayRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { keyId, keySecret } = razorpayCredentials();
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!response.ok) {
    const error = new Error('Razorpay could not create this checkout.');
    error.name = 'RazorpayRequestError';
    throw error;
  }
  return response.json() as Promise<T>;
}

function product(code: string) {
  const selected = getRazorpayCatalog().find((entry) => entry.code === code);
  if (!selected) {
    const error = new Error('The selected billing product is unavailable.');
    error.name = 'BillingProductUnavailableError';
    throw error;
  }
  return selected;
}

export async function createCreditPackOrder(context: TenantContext, productCode: string) {
  const selected = product(productCode);
  if (selected.kind !== 'credit_pack') throw new Error('The selected product is not a credit pack.');
  const firestore = getAdminFirestore();
  const localRef = firestore.collection('paymentOrders').doc();
  const now = Timestamp.now();
  await localRef.create({
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    createdBy: context.principalId,
    provider: 'razorpay',
    productCode: selected.code,
    kind: selected.kind,
    amountSubunits: selected.amountSubunits,
    currency: selected.currency,
    creditsToGrant: selected.credits,
    status: 'creating',
    createdAt: now,
    updatedAt: now,
  });
  try {
    const order = await razorpayRequest<{ id: string; amount: number; currency: string; status: string }>('/orders', {
      amount: selected.amountSubunits,
      currency: selected.currency,
      receipt: localRef.id.slice(0, 40),
      notes: { clariftOrderId: localRef.id, tenantRef: context.tenantId.slice(0, 120) },
    });
    await localRef.set({ razorpayOrderId: order.id, status: 'created', updatedAt: Timestamp.now() }, { merge: true });
    return {
      localOrderId: localRef.id,
      razorpayOrderId: order.id,
      keyId: razorpayCredentials().keyId,
      amount: selected.amountSubunits,
      currency: selected.currency,
      displayName: selected.displayName,
    };
  } catch (error) {
    await localRef.set({ status: 'failed', errorCode: error instanceof Error ? error.name : 'UnknownError', updatedAt: Timestamp.now() }, { merge: true });
    throw error;
  }
}

export async function createMonthlySubscription(context: TenantContext, productCode: string) {
  const selected = product(productCode);
  if (selected.kind !== 'subscription') throw new Error('The selected product is not a subscription.');
  const firestore = getAdminFirestore();
  const subscriptionRef = firestore.doc(`billingSubscriptions/${context.tenantId}`);
  await subscriptionRef.set({
    tenantId: context.tenantId,
    provider: 'razorpay',
    productCode: selected.code,
    internalPlan: 'individual',
    razorpayPlanId: selected.razorpayPlanId,
    creditsPerCycle: selected.creditsPerCycle,
    status: 'creating',
    createdBy: context.principalId,
    updatedAt: Timestamp.now(),
    createdAt: Timestamp.now(),
  }, { merge: true });
  try {
    const subscription = await razorpayRequest<{ id: string; status: string }>('/subscriptions', {
      plan_id: selected.razorpayPlanId,
      total_count: 120,
      quantity: 1,
      customer_notify: 1,
      notes: { tenantRef: context.tenantId.slice(0, 120) },
    });
    await subscriptionRef.set({ razorpaySubscriptionId: subscription.id, status: subscription.status || 'created', updatedAt: Timestamp.now() }, { merge: true });
    return {
      razorpaySubscriptionId: subscription.id,
      keyId: razorpayCredentials().keyId,
      displayName: selected.displayName,
    };
  } catch (error) {
    await subscriptionRef.set({ status: 'failed', errorCode: error instanceof Error ? error.name : 'UnknownError', updatedAt: Timestamp.now() }, { merge: true });
    throw error;
  }
}

export async function recordCheckoutVerification(input: {
  context: TenantContext;
  localOrderId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  signature: string;
}) {
  const ref = getAdminFirestore().doc(`paymentOrders/${input.localOrderId}`);
  const snapshot = await ref.get();
  const data = snapshot.data();
  if (!snapshot.exists || data?.tenantId !== input.context.tenantId || data?.razorpayOrderId !== input.razorpayOrderId) {
    throw new Error('Payment order not found.');
  }
  if (!verifyRazorpayCheckoutSignature({ orderId: input.razorpayOrderId, paymentId: input.razorpayPaymentId, signature: input.signature }, process.env.RAZORPAY_KEY_SECRET || '')) {
    const error = new Error('Payment verification failed.');
    error.name = 'RazorpaySignatureError';
    throw error;
  }
  if (data?.status === 'paid') return { verified: true, status: 'paid' };
  await ref.set({
    razorpayPaymentId: input.razorpayPaymentId,
    checkoutVerified: true,
    status: 'verification_pending',
    updatedAt: Timestamp.now(),
  }, { merge: true });
  return { verified: true, status: 'verification_pending' };
}

async function reservePaymentEvent(eventId: string, eventType: string, payloadHash: string) {
  const firestore = getAdminFirestore();
  const ref = firestore.doc(`paymentEvents/${createHash('sha256').update(eventId).digest('hex')}`);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    if (snapshot.exists && ['processed', 'ignored'].includes(String(data?.status))) return false;
    if (data?.status === 'processing' && (data.updatedAt?.toMillis?.() ?? 0) > Date.now() - 10 * 60 * 1000) return false;
    transaction.set(ref, {
      provider: 'razorpay',
      eventId,
      eventType,
      payloadHash,
      status: 'processing',
      receivedAt: snapshot.data()?.receivedAt || Timestamp.now(),
      updatedAt: Timestamp.now(),
    }, { merge: true });
    return true;
  });
}

async function markPaymentEvent(eventId: string, status: 'processed' | 'ignored' | 'failed', tenantId?: string | null, errorCode?: string | null) {
  await getAdminFirestore().doc(`paymentEvents/${createHash('sha256').update(eventId).digest('hex')}`).set({
    status,
    tenantId: tenantId ?? null,
    errorCode: errorCode ?? null,
    processedAt: status === 'failed' ? null : Timestamp.now(),
    updatedAt: Timestamp.now(),
  }, { merge: true });
}

function entity(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const wrapper = (payload.payload as Record<string, unknown> | undefined)?.[key] as Record<string, unknown> | undefined;
  return (wrapper?.entity as Record<string, unknown> | undefined) || {};
}

async function applyOrderPaid(eventId: string, payload: Record<string, unknown>) {
  const order = entity(payload, 'order');
  const payment = entity(payload, 'payment');
  const razorpayOrderId = String(order.id || payment.order_id || '');
  if (!razorpayOrderId) return null;
  const snapshot = await getAdminFirestore().collection('paymentOrders').where('razorpayOrderId', '==', razorpayOrderId).limit(1).get();
  const document = snapshot.docs[0];
  if (!document) return null;
  const data = document.data();
  await grantCredits({
    tenantId: String(data.tenantId),
    amount: Number(data.creditsToGrant),
    grantId: `razorpay_order_${razorpayOrderId}`,
    type: 'credit_pack',
    sourceId: String(payment.id || razorpayOrderId),
  });
  await document.ref.set({
    status: 'paid',
    razorpayPaymentId: String(payment.id || data.razorpayPaymentId || ''),
    paidAt: Timestamp.now(),
    lastWebhookEventId: eventId,
    updatedAt: Timestamp.now(),
  }, { merge: true });
  return String(data.tenantId);
}

async function applySubscriptionEvent(eventId: string, eventType: string, payload: Record<string, unknown>) {
  const subscription = entity(payload, 'subscription');
  const subscriptionId = String(subscription.id || '');
  if (!subscriptionId) return null;
  const snapshot = await getAdminFirestore().collection('billingSubscriptions').where('razorpaySubscriptionId', '==', subscriptionId).limit(1).get();
  const document = snapshot.docs[0];
  if (!document) return null;
  const data = document.data();
  const eventAt = Number(payload.created_at) || Math.floor(Date.now() / 1000);
  const lastEventAt = Number(data.lastEventAt) || 0;
  const statusByType: Record<string, string> = {
    'subscription.authenticated': 'authenticated',
    'subscription.activated': 'active',
    'subscription.charged': 'active',
    'subscription.pending': 'past_due',
    'subscription.halted': 'halted',
    'subscription.cancelled': 'cancelled',
    'subscription.completed': 'completed',
    'subscription.paused': 'paused',
    'subscription.resumed': 'active',
  };
  if (eventType === 'subscription.charged') {
    const payment = entity(payload, 'payment');
    const cycleId = String(payment.id || subscription.current_start || eventId);
    await grantCredits({
      tenantId: String(data.tenantId),
      amount: Number(data.creditsPerCycle),
      grantId: `razorpay_subscription_cycle_${cycleId}`,
      type: 'subscription_cycle',
      sourceId: cycleId,
    });
  }
  if (eventAt >= lastEventAt) {
    const nextStatus = statusByType[eventType] || String(subscription.status || data.status || 'unknown');
    const now = Timestamp.now();
    const batch = getAdminFirestore().batch();
    batch.set(document.ref, {
      status: nextStatus,
      lastEventAt: eventAt,
      lastWebhookEventId: eventId,
      currentStart: subscription.current_start || data.currentStart || null,
      currentEnd: subscription.current_end || data.currentEnd || null,
      updatedAt: now,
    }, { merge: true });
    batch.set(getAdminFirestore().doc(`tenantEntitlements/${String(data.tenantId)}`), {
      tenantId: String(data.tenantId),
      plan: 'individual',
      status: nextStatus,
      managedInference: true,
      byokAllowed: true,
      developerApiAllowed: ['active', 'authenticated'].includes(nextStatus),
      source: 'razorpay_subscription',
      sourceId: subscriptionId,
      currentPeriodStart: subscription.current_start || null,
      currentPeriodEnd: subscription.current_end || null,
      updatedAt: now,
    }, { merge: true });
    await batch.commit();
  }
  return String(data.tenantId);
}

export async function processRazorpayWebhook(rawBody: string, signature: string, eventId: string) {
  const secrets = [process.env.RAZORPAY_WEBHOOK_SECRET, process.env.RAZORPAY_WEBHOOK_OLD_SECRET].filter((value): value is string => Boolean(value));
  if (!signature || !secrets.some((secret) => verifyRazorpayWebhookSignature(rawBody, signature, secret))) {
    const error = new Error('Razorpay webhook signature is invalid.');
    error.name = 'RazorpaySignatureError';
    throw error;
  }
  const payloadHash = createHmac('sha256', secrets[0]).update(rawBody).digest('hex');
  const payload = JSON.parse(rawBody) as Record<string, unknown>;
  const eventType = String(payload.event || 'unknown');
  if (!eventId || eventId.length > 200) throw new Error('Razorpay webhook event ID is missing or invalid.');
  if (!await reservePaymentEvent(eventId, eventType, payloadHash)) return { duplicate: true };
  try {
    let tenantId: string | null = null;
    if (eventType === 'order.paid' || eventType === 'payment.captured') tenantId = await applyOrderPaid(eventId, payload);
    else if (eventType.startsWith('subscription.')) tenantId = await applySubscriptionEvent(eventId, eventType, payload);
    await markPaymentEvent(eventId, tenantId ? 'processed' : 'ignored', tenantId);
    return { duplicate: false, processed: Boolean(tenantId) };
  } catch (error) {
    await markPaymentEvent(eventId, 'failed', null, error instanceof Error ? error.name : 'UnknownError');
    throw error;
  }
}
