# Production Readiness Plan

## Current Architecture

The Prompt Refinery is a Next.js App Router application with server actions, API routes, Firebase Auth, Firestore, Firebase Admin, Stripe Checkout/webhooks, Google Genkit/Gemini flows, optional OpenRouter council routing, and optional MarkItDown document conversion.

The release candidate has passed local verification, but public production launch is not complete until live Firebase, Stripe, provider, deployment, monitoring, and security controls are verified.

## Production Blockers

- Real Firebase project, Auth providers, authorized domains, Firestore rules, and indexes must be configured and deployed.
- Stripe test and live mode must be configured and verified with real products, prices, Billing Portal settings, webhook signatures, cancellation, failed payment, and localized pricing.
- Gemini and OpenRouter must be tested with real keys. BYOK remains the launch default.
- Managed OpenRouter must remain disabled until quotas, model allowlists, usage logging, and cost monitoring are enforced.
- Minimal guarded admin APIs, account status controls, entitlement grants, and audit logs are now implemented server-side. A polished admin UI remains to be built before non-technical operators use these controls.
- `?mock_user=` style access must remain unavailable in production.
- MarkItDown conversion must remain disabled or isolated until runtime security is decided.

## Security Risks

- Client subscription state must never unlock Pro features.
- Missing legacy user fields must default to safe values: `role: "user"`, `subscriptionTier: "free"`, `accountStatus: "active"`.
- Users must not write role, account status, subscription, Stripe, entitlement, usage, audit, or admin fields.
- Logs must not contain BYOK keys, bearer tokens, prompts, uploaded content, project memory, saved prompt content, raw provider responses, or secrets.
- Admin/support data must be served only through guarded server APIs with redaction, pagination, query limits, and audit logging.

## Data Model Changes

Planned server-managed collections:

- `adminEntitlements/{uid}` for manual/team/beta/test Pro grants. Owner role also resolves to Pro without a Stripe subscription.
- `adminAuditLogs/{logId}` for admin/support/security actions, including search, entitlement reads, Pro grant/revoke, account status changes, audit-log reads, health reads, and feasible unauthorized attempts.
- `stripeWebhookEvents/{eventId}` for idempotent webhook processing.
- `usageEvents/{eventId}` for privacy-safe usage metadata.
- `dailyUsageAggregates/{date_uid}` for quota and admin metrics.

## Implemented Server Authority

- Legacy user documents default safely to `role: "user"`, `subscriptionTier: "free"`, `subscriptionSource: null`, and `accountStatus: "active"`.
- Server guards verify Firebase ID tokens for protected admin APIs and derive the acting UID from the decoded token.
- Role hierarchy is `user < support < admin < owner`; support can read safe system health only in this slice, admin can search/read metadata, and owner is required for Pro grants/revokes and account status changes.
- Suspended, disabled, and `deleted_pending` accounts are blocked from checkout, managed provider calls, Pro server actions, saving prompts, and project-memory writes.
- Entitlement precedence is server-authoritative: owner/manual/team/beta/test grants can provide Pro independently of Stripe; active Stripe state can provide Pro; expired/revoked grants do not; Stripe cancellation does not remove valid manual/team/beta/test grants.
- Admin APIs return redacted metadata only and do not expose prompts, saved prompt contents, project memory, uploaded contents, provider responses, BYOK keys, auth headers, cookies, Stripe secrets, or environment secrets.
- Stripe Checkout, Billing Portal, localized price selection, promotion-code toggling, webhook signature verification, webhook idempotency records, and subscription lifecycle field updates are implemented server-side.
- Stripe routes derive the user from verified Firebase ID tokens, reject blocked account statuses, validate browser-triggered origins against `APP_BASE_URL`, use route-level throttles, and never trust client-submitted UID, customer ID, subscription ID, role, tier, entitlement, price ID, or currency.

## Minimal Admin APIs

- `POST /api/admin/users/search`
- `GET /api/admin/users/{uid}/entitlement`
- `POST /api/admin/users/{uid}/grant-pro`
- `POST /api/admin/users/{uid}/revoke-pro`
- `POST /api/admin/users/{uid}/status`
- `GET /api/admin/audit-logs`
- `GET /api/admin/system-health`

## Deployment Recommendation

Use Firebase App Hosting as the primary target. The app already depends on Firebase Auth, Firestore, Firebase Admin, App Hosting-compatible environment checks, and Firebase deployment tooling. Render remains a fallback only if future file conversion needs custom runtime isolation.

## Required Configuration

Production requires public Firebase config, Stripe subscription secrets, trusted `APP_BASE_URL`, owner bootstrap values, explicit feature flags, quotas, rate limits, and provider model allowlists. Optional managed providers and file conversion fail closed unless their feature flags and required secrets/runtime values are configured.

## Required Tests

Before launch, keep the tests for legacy users, role boundaries, account status blocking, entitlement precedence, Firestore rule assumptions, Stripe price selection, Checkout params, Billing Portal params, webhook event records, and subscription lifecycle passing. Still add integration tests against Stripe test mode and a Firebase test project/emulator, plus provider allowlists, BYOK redaction, quotas, upload validation, and privacy-safe analytics.

## Rollback Plan

- Keep the previous Firebase App Hosting rollout available.
- Disable risky features with emergency flags before rollback when possible.
- Disable checkout with `ENABLE_STRIPE_CHECKOUT=false`.
- Disable managed providers with `ENABLE_MANAGED_OPENROUTER=false`.
- Disable conversion with `ENABLE_FILE_CONVERSION=false`.
- Rotate compromised secrets through Secret Manager.
- Review `adminAuditLogs` and `stripeWebhookEvents` before and after rollback.
