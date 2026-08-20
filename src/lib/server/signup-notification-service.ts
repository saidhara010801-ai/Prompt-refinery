import { Timestamp } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

import { getAdminFirestore } from './firebase-admin';
import { consumeDistributedLimit } from './distributed-limits';

const RESEND_EMAIL_ENDPOINT = 'https://api.resend.com/emails';
const DELIVERY_LEASE_MS = 2 * 60 * 1000;
const RETRY_DELAY_MS = 5 * 60 * 1000;
const SEND_TIMEOUT_MS = 8_000;

type Environment = Record<string, string | undefined>;

interface SignupNotificationConfig {
  apiKey: string;
  from: string;
  recipients: string[];
}

interface SignupNotificationRecord {
  status?: 'pending' | 'sending' | 'sent';
  leaseUntil?: Timestamp;
  nextAttemptAt?: Timestamp;
  attempts?: number;
  email?: string;
  name?: string;
  providerIds?: string[];
  authCreatedAt?: string | null;
}

export interface NewUserNotificationDetails {
  uid: string;
  email: string;
  name: string;
  providerIds: string[];
  authCreatedAt: string | null;
}

export function parseNotificationRecipients(value: string | undefined): string[] {
  return Array.from(new Set((value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry))));
}

export function signupNotificationsAreConfigured(environment: Environment): boolean {
  if (environment.ENABLE_SIGNUP_NOTIFICATIONS?.trim().toLowerCase() !== 'true') return true;
  return Boolean(
    environment.RESEND_API_KEY?.trim() &&
    environment.SIGNUP_NOTIFICATION_FROM_EMAIL?.trim() &&
    parseNotificationRecipients(
      environment.SIGNUP_NOTIFICATION_EMAILS || environment.OWNER_EMAILS
    ).length
  );
}

export function signupNotificationHourlyLimit(environment: Environment = process.env): number {
  const configured = Number(environment.SIGNUP_NOTIFICATION_HOURLY_LIMIT);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(Math.floor(configured), 100)
    : 20;
}

function getNotificationConfig(environment: Environment = process.env): SignupNotificationConfig | null {
  if (environment.ENABLE_SIGNUP_NOTIFICATIONS?.trim().toLowerCase() !== 'true') return null;

  const apiKey = environment.RESEND_API_KEY?.trim() ?? '';
  const from = environment.SIGNUP_NOTIFICATION_FROM_EMAIL?.trim() ?? '';
  const recipients = parseNotificationRecipients(
    environment.SIGNUP_NOTIFICATION_EMAILS || environment.OWNER_EMAILS
  );
  if (!apiKey || !from || recipients.length === 0) {
    throw new Error('Signup notification email is enabled but its server configuration is incomplete.');
  }
  return { apiKey, from, recipients };
}

export function newUserDetailsFromToken(decodedToken: DecodedIdToken): NewUserNotificationDetails {
  const firebase = decodedToken.firebase as { sign_in_provider?: string; identities?: Record<string, unknown> } | undefined;
  const identityProviders = Object.keys(firebase?.identities ?? {});
  const providerIds = Array.from(new Set([
    ...(firebase?.sign_in_provider ? [firebase.sign_in_provider] : []),
    ...identityProviders,
  ])).sort();

  return {
    uid: decodedToken.uid,
    email: decodedToken.email?.trim().toLowerCase() ?? '',
    name: decodedToken.name?.trim() ?? '',
    providerIds,
    authCreatedAt: typeof decodedToken.auth_time === 'number'
      ? new Date(decodedToken.auth_time * 1000).toISOString()
      : null,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function buildNewUserEmail(details: NewUserNotificationDetails) {
  const createdAt = details.authCreatedAt ?? new Date().toISOString();
  const providerLabel = details.providerIds.length > 0 ? details.providerIds.join(', ') : 'unknown';
  const text = [
    'A new user signed up to Clarift.',
    '',
    `Firebase UID: ${details.uid}`,
    `Email: ${details.email || 'not provided'}`,
    `Name: ${details.name || 'not provided'}`,
    `Sign-in provider: ${providerLabel}`,
    `Created at: ${createdAt}`,
    '',
    'Open Clarift Admin > Users to review the account and enable beta access.',
  ].join('\n');

  return {
    subject: `New Clarift signup: ${details.email || details.uid}`,
    text,
    html: `<h2>New Clarift signup</h2>
      <p>A new user signed up to Clarift.</p>
      <table style="border-collapse:collapse">
        <tr><td style="padding:4px 12px 4px 0"><strong>Firebase UID</strong></td><td><code>${escapeHtml(details.uid)}</code></td></tr>
        <tr><td style="padding:4px 12px 4px 0"><strong>Email</strong></td><td>${escapeHtml(details.email || 'not provided')}</td></tr>
        <tr><td style="padding:4px 12px 4px 0"><strong>Name</strong></td><td>${escapeHtml(details.name || 'not provided')}</td></tr>
        <tr><td style="padding:4px 12px 4px 0"><strong>Sign-in provider</strong></td><td>${escapeHtml(providerLabel)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0"><strong>Created at</strong></td><td>${escapeHtml(createdAt)}</td></tr>
      </table>
      <p>Open <strong>Clarift Admin &gt; Users</strong> to review the account and enable beta access.</p>`,
  };
}

async function sendSignupEmail(config: SignupNotificationConfig, details: NewUserNotificationDetails) {
  const email = buildNewUserEmail(details);
  const response = await fetch(RESEND_EMAIL_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `clarift-signup/${details.uid}`,
    },
    body: JSON.stringify({
      from: config.from,
      to: config.recipients,
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });

  const result = await response.json().catch(() => ({})) as { id?: string };
  if (!response.ok || !result.id) {
    const error = new Error(`Signup notification provider returned HTTP ${response.status}.`);
    error.name = 'SignupNotificationDeliveryError';
    throw error;
  }
  return result.id;
}

async function claimNotification(uid: string): Promise<SignupNotificationRecord | null> {
  const firestore = getAdminFirestore();
  const ref = firestore.doc(`signupNotifications/${uid}`);
  const now = Timestamp.now();
  let claimed: SignupNotificationRecord | null = null;

  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const record = snapshot.data() as SignupNotificationRecord;
    if (record.status === 'sent') return;
    if (record.status === 'sending' && record.leaseUntil && record.leaseUntil.toMillis() > now.toMillis()) return;
    if (record.nextAttemptAt && record.nextAttemptAt.toMillis() > now.toMillis()) return;

    claimed = record;
    transaction.set(ref, {
      status: 'sending',
      attempts: Number(record.attempts || 0) + 1,
      leaseUntil: Timestamp.fromMillis(now.toMillis() + DELIVERY_LEASE_MS),
      updatedAt: now,
    }, { merge: true });
  });
  return claimed;
}

async function deliverSignupNotification(uid: string): Promise<void> {
  let config: SignupNotificationConfig | null;
  try {
    config = getNotificationConfig();
  } catch {
    return;
  }
  if (!config) return;

  const record = await claimNotification(uid);
  if (!record) return;
  const ref = getAdminFirestore().doc(`signupNotifications/${uid}`);
  const deliveryLimit = await consumeDistributedLimit({
    bucket: 'signup-notification-delivery',
    key: 'global',
    limit: signupNotificationHourlyLimit(),
    windowMs: 60 * 60 * 1000,
  });
  if (!deliveryLimit.allowed) {
    await ref.set({
      status: 'pending',
      leaseUntil: null,
      nextAttemptAt: Timestamp.fromMillis(Date.now() + deliveryLimit.retryAfterSeconds * 1000),
      updatedAt: Timestamp.now(),
    }, { merge: true });
    return;
  }
  try {
    const providerMessageId = await sendSignupEmail(config, {
      uid,
      email: record.email ?? '',
      name: record.name ?? '',
      providerIds: record.providerIds ?? [],
      authCreatedAt: record.authCreatedAt ?? null,
    });
    await ref.set({
      status: 'sent',
      provider: 'resend',
      providerMessageId,
      sentAt: Timestamp.now(),
      leaseUntil: null,
      nextAttemptAt: null,
      updatedAt: Timestamp.now(),
    }, { merge: true });
  } catch (error) {
    await ref.set({
      status: 'pending',
      lastErrorName: error instanceof Error ? error.name : 'SignupNotificationDeliveryError',
      leaseUntil: null,
      nextAttemptAt: Timestamp.fromMillis(Date.now() + RETRY_DELAY_MS),
      updatedAt: Timestamp.now(),
    }, { merge: true });
  }
}

export async function registerNewUserSignup(decodedToken: DecodedIdToken): Promise<void> {
  if (process.env.ENABLE_SIGNUP_NOTIFICATIONS?.trim().toLowerCase() !== 'true') return;
  const details = newUserDetailsFromToken(decodedToken);
  const ref = getAdminFirestore().doc(`signupNotifications/${decodedToken.uid}`);
  try {
    await ref.create({
      ...details,
      status: 'pending',
      attempts: 0,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  } catch (error) {
    const code = (error as { code?: number | string })?.code;
    if (code !== 6 && code !== '6' && code !== 'already-exists') throw error;
  }
  await deliverSignupNotification(decodedToken.uid);
}

export async function retryPendingSignupNotification(uid: string): Promise<void> {
  if (process.env.ENABLE_SIGNUP_NOTIFICATIONS?.trim().toLowerCase() !== 'true') return;
  await deliverSignupNotification(uid);
}
