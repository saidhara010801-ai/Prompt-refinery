# Final Verification

Use this document to record the final production verification run.

## Commands

```powershell
npm ci
npm run verify
npm run check:production-env
npm audit --omit=dev
```

## Manual Production Checks

- Firebase Auth sign-up/sign-in/Google sign-in.
- Firestore rules and indexes deployed.
- Gemini BYOK valid/invalid.
- OpenRouter BYOK valid/invalid.
- Stripe Checkout test and live-mode dry run.
- Stripe Checkout rejects unauthenticated users, blocked account statuses, disabled checkout flag, invalid origins, and client price/currency spoofing.
- Stripe localized pricing resolves INR for India when configured and falls back safely to default/USD.
- Stripe promotion-code entry follows `ENABLE_PROMOTION_CODES`; no app-side discount math.
- Stripe webhook valid signature, invalid signature, duplicate event, failed lookup, retry-safe behavior, cancellation, paid invoice, and failed payment.
- Stripe webhook records are written to `stripeWebhookEvents/{eventId}` without raw payloads or secrets.
- Billing Portal uses only stored server-side `stripeCustomerId` and rejects blocked or unlinked accounts.
- Admin owner bootstrap.
- Admin user search with redaction and pagination.
- Manual/team/beta/test Pro grant/revoke; verify revocation does not cancel Stripe.
- Account suspend/reactivate.
- Suspended/disabled account blocks checkout, managed provider calls, saved prompts, and project-memory actions.
- Legacy user document with missing role/tier/status/source defaults to user/free/active.
- Audit logs for search, entitlement read, grant, revoke, status change, health read, audit read, and unauthorized attempts.
- Admin rate limits for user search, audit-log reads, entitlement reads, health reads, grant/revoke, and account status changes.
- Admin user search and audit-log APIs reject unbounded reads with hard page-size caps.
- Audit metadata redacts prompt, content, memory, key, apiKey, secret, token, bearer, cookie, authorization, provider response, and response fields.
- Audit request metadata stores hashed IP/user-agent values only.
- `ENABLE_MOCK_AUTH=true` does not enable mock auth in production.
- Health/readiness.
- Monitoring alerts.

## Known Risks

Document any residual npm audit advisories, disabled features, manual setup gaps, and production-provider limits here before launch approval.

## Latest Local Security Tests Added

- Legacy user default resolver coverage.
- Bootstrap role boundary coverage for user/support/admin/owner.
- Account status blocking coverage.
- Admin rate-limit policy and max page-size coverage.
- Support/admin/owner permission-boundary coverage, including owner-only grant/revoke and status actions.
- Audit metadata redaction and request-hash coverage.
- Production mock-auth rejection coverage.
- Entitlement precedence coverage for free, Stripe Pro, manual grant, expired grant, revoked grant, manual grant surviving Stripe cancellation, and owner role.
- Firestore rule assumption coverage for privileged collection denies and server-managed user fields.
- Stripe price-selection, Checkout parameter, promotion-code, origin-check, Billing Portal parameter, subscription lifecycle, manual-grant survival, and webhook event-record coverage.

## Phase C/D Closure Results

- Admin APIs have a shared in-memory throttle. Mutating owner-only actions are stricter than read/search endpoints.
- Admin user search is email-prefix/UID based, cursor-capable, and capped at 25 results.
- Audit-log reads are cursor-paginated and capped at 25 results.
- Firestore rule assumptions are covered by regression tests that inspect the checked-in rules file. Full emulator-based rule tests are still recommended before public launch.
- Local closure verification was run on this branch; production env verification still requires real Firebase/Stripe/App Hosting values.

## Stripe Billing Hardening Results

- Checkout uses server-selected Price IDs and `APP_BASE_URL` return URLs.
- Billing Portal route is authenticated, account-status guarded, origin checked, throttled, and server-customer-only.
- Webhook processing verifies Stripe signatures against the raw request body and records idempotency status in `stripeWebhookEvents`.
- Stripe subscription events update only server-owned subscription and Stripe fields, never role fields.
- Manual/team/beta/test/owner entitlements survive Stripe cancellation through entitlement precedence.
