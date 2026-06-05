# Production Readiness Plan

## Current Architecture

The Prompt Refinery is a Next.js App Router application with server actions, API routes, Firebase Auth, Firestore, Firebase Admin, Stripe Checkout/webhooks, Google Genkit/Gemini flows, optional OpenRouter council routing, and optional MarkItDown document conversion.

The release candidate has passed local verification, but public production launch is not complete until live Firebase, Stripe, provider, deployment, monitoring, and security controls are verified.

## Production Blockers

- Real Firebase project, Auth providers, authorized domains, Firestore rules, and indexes must be configured and deployed.
- Stripe test and live Checkout, Billing Portal, webhook signatures, webhook idempotency, cancellation, failed payment, and localized pricing must be verified.
- Gemini and OpenRouter must be tested with real keys. BYOK remains the launch default.
- Managed OpenRouter must remain disabled until quotas, model allowlists, usage logging, and cost monitoring are enforced.
- Admin roles, account status controls, entitlement grants, audit logs, and minimal admin APIs/UI must be added before operator-managed Pro grants.
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

- `adminEntitlements/{uid}` for manual/team/beta/test/owner Pro grants.
- `adminAuditLogs/{logId}` for all admin/support/security actions.
- `stripeWebhookEvents/{eventId}` for idempotent webhook processing.
- `usageEvents/{eventId}` for privacy-safe usage metadata.
- `dailyUsageAggregates/{date_uid}` for quota and admin metrics.

## Deployment Recommendation

Use Firebase App Hosting as the primary target. The app already depends on Firebase Auth, Firestore, Firebase Admin, App Hosting-compatible environment checks, and Firebase deployment tooling. Render remains a fallback only if future file conversion needs custom runtime isolation.

## Required Configuration

Production requires public Firebase config, Stripe subscription secrets, trusted `APP_BASE_URL`, owner bootstrap values, explicit feature flags, quotas, rate limits, and provider model allowlists. Optional managed providers and file conversion fail closed unless their feature flags and required secrets/runtime values are configured.

## Required Tests

Before launch, add tests for legacy users, role guards, account status blocking, entitlement precedence, Stripe webhook idempotency, billing portal creation, localized pricing, admin redaction/pagination, Firestore rule assumptions, provider allowlists, BYOK redaction, quotas, upload validation, and privacy-safe analytics.

## Rollback Plan

- Keep the previous Firebase App Hosting rollout available.
- Disable risky features with emergency flags before rollback when possible.
- Disable checkout with `ENABLE_STRIPE_CHECKOUT=false`.
- Disable managed providers with `ENABLE_MANAGED_OPENROUTER=false`.
- Disable conversion with `ENABLE_FILE_CONVERSION=false`.
- Rotate compromised secrets through Secret Manager.
- Review `adminAuditLogs` and `stripeWebhookEvents` before and after rollback.
