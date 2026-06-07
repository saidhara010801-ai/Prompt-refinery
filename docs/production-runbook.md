# Production Runbook

## Release Gate

Run these commands before promoting a release:

```powershell
npm ci
npm run verify
npm run check:production-env
npm audit --omit=dev
```

The environment check must run with the production Firebase and Stripe variables available. The optional managed OpenRouter fallback and MarkItDown executable are reported separately. Review residual dependency advisories before promotion; do not use forced fixes that downgrade Next.js.

Review the companion production documents before public launch:

- [Production readiness plan](production-readiness-plan.md)
- [Deployment decision](deployment-decision.md)
- [Privacy and data retention](privacy-and-data-retention.md)
- [Monitoring](monitoring.md)
- [Incident response](incident-response.md)
- [Go-live checklist](go-live-checklist.md)

## Firebase App Hosting

`apphosting.yaml` references Stripe values in Cloud Secret Manager. Create or rotate them before the first rollout:

```powershell
firebase apphosting:secrets:set STRIPE_SECRET_KEY
firebase apphosting:secrets:set STRIPE_PRO_PRICE_ID
firebase apphosting:secrets:set STRIPE_PRO_PRICE_ID_USD
firebase apphosting:secrets:set STRIPE_PRO_PRICE_ID_INR
firebase apphosting:secrets:set STRIPE_PRO_PRICE_ID_DEFAULT
firebase apphosting:secrets:set STRIPE_WEBHOOK_SECRET
```

Configure the public `NEXT_PUBLIC_FIREBASE_*` variables and `APP_BASE_URL=https://<production-host>` for the backend environment. `APP_BASE_URL` is the trusted Stripe Checkout return origin. Enable Email/Password, Anonymous, and Google sign-in providers in Firebase Authentication. Add the deployed hostname to Firebase Authentication authorized domains.

Production readiness also requires explicit owner bootstrap, quota, model allowlist, and emergency feature-flag variables. Keep managed provider and file-conversion flags disabled until their quotas, allowlists, and runtime dependencies are verified.

Bootstrap at least one owner with `OWNER_EMAILS` or `OWNER_UIDS` before enabling admin APIs. Legacy user documents without role, tier, source, or status fields resolve safely to `role: "user"`, `subscriptionTier: "free"`, `subscriptionSource: null`, and `accountStatus: "active"`.

Deploy Firestore rules after review:

```powershell
firebase deploy --only firestore:rules
```

The checked-in `firebase.json` and `firestore.indexes.json` files make the rules deployment reproducible. Project-memory and saved-prompt writes are server-managed; browser rules intentionally allow read access only where required.

Privileged collections are server-only from browser rules: `adminEntitlements`, `adminAuditLogs`, `stripeWebhookEvents`, `usageEvents`, and `dailyUsageAggregates`. Admin/support access must use guarded server APIs.

## Roles, Status, And Entitlements

Role hierarchy is `user < support < admin < owner`. Support can read safe system health; admin can search/read redacted user metadata and entitlement/audit data; owner is required to grant/revoke Pro and suspend/reactivate accounts.

Account statuses are `active`, `disabled`, `suspended`, and `deleted_pending`. Non-active statuses are blocked from checkout, managed provider calls, saving prompts, and Pro/project-memory server actions.

Effective Pro entitlement is resolved server-side. Active owner/manual/team/beta/test grants can provide Pro without Stripe. Active Stripe subscription state can provide Pro. Expired or revoked grants do not. Stripe cancellation only removes Stripe-sourced Pro and must not remove valid manual/team/beta/test grants.

Minimal admin API paths:

- `POST /api/admin/users/search`
- `GET /api/admin/users/{uid}/entitlement`
- `POST /api/admin/users/{uid}/grant-pro`
- `POST /api/admin/users/{uid}/revoke-pro`
- `POST /api/admin/users/{uid}/status`
- `GET /api/admin/audit-logs`
- `GET /api/admin/system-health`

All admin/security actions write redacted entries to `adminAuditLogs`.

Admin API throttles are enforced in the shared admin route wrapper:

- Owner-only mutations, including Pro grant/revoke and account-status changes, are limited to the stricter mutation bucket.
- User search and audit-log reads use a stricter read/search bucket.
- Entitlement reads and system-health reads use the default admin bucket.
- `ADMIN_RATE_LIMIT_MAX_REQUESTS` controls the upper read limit; mutation/search buckets are capped below that value.

Admin user search must provide a UID or email-prefix search term. It returns at most 25 users and uses `nextPageToken` for additional pages. Audit-log reads are ordered by newest first, return at most 25 logs, and use `nextPageToken` for additional pages. Do not add unbounded collection scans to admin APIs.

Audit logs must never include raw request bodies, prompts, uploaded contents, saved prompt text, project memory, BYOK keys, auth headers, cookies, bearer tokens, raw provider responses, Stripe secrets, or environment secrets. Audit metadata redacts sensitive keys and stores request IP/user-agent metadata as short hashes.

Manual Firestore rule verification until emulator tests are added:

- A user cannot write `role`, `accountStatus`, subscription, Stripe, quota, entitlement, audit, usage, or admin fields on their own profile.
- A browser client cannot read or write `adminEntitlements`, `adminAuditLogs`, `stripeWebhookEvents`, `usageEvents`, or `dailyUsageAggregates`.
- A user cannot read another user's saved prompts, projects, project sessions, or profile document.

## Stripe

Create a recurring Pro product in Stripe test mode and live mode. Configure:

- `STRIPE_PRO_PRICE_ID`: legacy/default fallback price.
- `STRIPE_PRO_PRICE_ID_DEFAULT`: preferred default fallback price.
- `STRIPE_PRO_PRICE_ID_USD`: USD Pro price.
- `STRIPE_PRO_PRICE_ID_INR`: INR Pro price.
- `ENABLE_STRIPE_CHECKOUT`: emergency checkout switch.
- `ENABLE_PROMOTION_CODES`: when `true`, Checkout enables Stripe promotion-code entry.

Checkout derives the Firebase UID from the verified bearer token, checks account status server-side, validates request origin against `APP_BASE_URL`, selects the Price ID server-side, and ignores client-submitted price/currency/customer data. India resolves to INR when `STRIPE_PRO_PRICE_ID_INR` is configured; otherwise checkout falls back to the default/USD price.

Billing Portal is available at:

```text
POST /api/stripe/customer-portal
```

It requires a verified Firebase ID token, active account status, a stored server-side `stripeCustomerId`, route throttling, and an origin that matches `APP_BASE_URL`. It never accepts a customer ID from the client.

Register the webhook endpoint:

```text
https://<production-host>/api/stripe_webhooks
```

Subscribe the webhook to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`
- `invoice.payment_succeeded`

Store the resulting signing secret as `STRIPE_WEBHOOK_SECRET`. The webhook route verifies signatures with the raw request body, records each event in `stripeWebhookEvents/{eventId}`, skips duplicate processed/reserved events, records failed lookups instead of silently ignoring them, and updates only server-owned Stripe/subscription fields. Webhooks must never write role fields.

Stripe lifecycle behavior:

- `active` and `trialing` subscriptions grant Stripe-sourced Pro.
- `canceled`, `deleted`, `unpaid`, and inactive subscription states remove only Stripe-sourced Pro.
- Manual/team/beta/test/owner grants survive Stripe cancellation because entitlement resolution checks those grants separately.
- Promotion code discounts are handled only by Stripe Checkout when `ENABLE_PROMOTION_CODES=true`; the app does not implement custom discount math.

## Monitoring

Use these endpoints for uptime monitoring:

```text
GET /api/health
GET /api/health?ready=1
```

The liveness endpoint returns `200` with a redacted configuration summary. The readiness form returns `503` until required Firebase client configuration and Stripe subscriptions are configured.

Alert on:

- Readiness failures.
- Elevated `429` responses from checkout or document conversion.
- Stripe webhook fulfillment failures.
- Firebase Admin credential failures.
- AI provider quota, invalid-key, and empty-output errors.

## Rate Limits

Firestore transactions enforce the product quota of five managed-key refinements per day for Free users. Route-level in-memory throttles provide an additional best-effort guard for checkout and document conversion. For multi-instance production deployments, complement these guards with edge or platform rate limiting.

## Optional MarkItDown Runtime

The converter needs the Microsoft MarkItDown CLI in the runtime image. If the command is not discoverable as `markitdown`, set `MARKITDOWN_COMMAND`. Without it, the app returns a friendly `503` and text-file attachment fallback remains available.

## Manual Journeys

Before each production promotion, verify:

- Email, Google, and guest sign-in.
- Gemini BYOK refinement, invalid-key feedback, token counts, copy styles, and exports.
- OpenRouter BYOK refinement with default routing and Pro custom routing.
- Free saved-prompt cap and managed-refinement cap.
- Pro checkout, webhook fulfillment, projects, memory notes, and saved-prompt deletion.
- Evaluator scores and recommendations.
- Template loading, max-character target, explanation mode, image context, and document conversion.
- Dark/light mode and narrow-screen layout.
