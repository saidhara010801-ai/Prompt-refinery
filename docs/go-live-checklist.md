# Go-Live Checklist

## Firebase

- Production project created.
- Auth providers enabled.
- Authorized domains configured.
- Firestore production mode enabled.
- Rules deployed.
- Indexes deployed.

## Stripe

- Product created.
- USD/default price created.
- INR price created if localized pricing is enabled.
- `STRIPE_PRO_PRICE_ID`, `STRIPE_PRO_PRICE_ID_DEFAULT`, `STRIPE_PRO_PRICE_ID_USD`, and `STRIPE_PRO_PRICE_ID_INR` configured as intended.
- `ENABLE_STRIPE_CHECKOUT` and `ENABLE_PROMOTION_CODES` explicitly configured.
- Test checkout passed.
- Checkout rejects spoofed client price/currency/UID/customer data.
- Checkout origin validation passed against `APP_BASE_URL`.
- India checkout selects INR when configured; unknown/default checkout selects default/USD.
- Billing Portal configured and successful portal session verified.
- Billing Portal rejects unauthenticated, suspended, disabled, deleted-pending, missing-customer, and client-spoofed-customer attempts.
- Webhook endpoint configured.
- Webhook signature verified.
- Duplicate webhook idempotency verified.
- Webhook failed lookup recording verified in `stripeWebhookEvents`.
- Cancellation and failed-payment flows verified.
- Manual/team/beta/test grants survive Stripe cancellation.
- Webhooks do not overwrite role fields.
- Live keys configured only in production.

## Providers

- Gemini BYOK valid/invalid tested.
- OpenRouter BYOK valid/invalid tested.
- Managed OpenRouter disabled or fully quota-protected.
- Model allowlists configured.

## Admin And Security

- Owner bootstrap verified.
- Firebase revoked-token rejection verified.
- Firebase disabled-user response verified.
- Admin user metadata search verified with pagination and redaction.
- Admin API rate limits verified for search, audit reads, entitlement reads, health reads, grant/revoke, and status changes.
- Owner-only Pro grant/revoke verified.
- Support cannot grant/revoke Pro or suspend/reactivate users.
- Admin cannot grant/revoke Pro or suspend/reactivate users unless elevated to owner.
- Account suspend/reactivate verified.
- Suspended/disabled accounts cannot use Pro-gated project or memory APIs.
- Disabled, suspended, and `deleted_pending` accounts cannot create checkout sessions.
- Audit logs written.
- Audit logs paginated and direct browser reads denied by Firestore rules.
- Audit logs do not contain raw request bodies, prompts, uploaded contents, memory, BYOK keys, bearer tokens, cookies, raw provider responses, or secrets.
- Unexpected admin API failures are audit-attempted without raw request bodies or secrets.
- `supportAccessRequests` direct browser reads/writes denied until scoped support flow exists.
- Firestore emulator rule tests added or manual rule checks completed and recorded.
- Mock auth disabled in production.
- Admin APIs protected by server-side guards.
- Legacy users without role/tier/status/source fields render as user/free/active.
- Suspended and disabled accounts cannot create checkout sessions or call provider APIs.
- Logs redacted.

## User Flows

- Sign up.
- Sign in.
- Google sign in.
- Sign out.
- Saved prompts.
- Projects and memory.
- Evaluator.
- Converter disabled/unavailable states.
- Pro checkout.
- Promotion code checkout when enabled.
- Localized price checkout when enabled.
- Cancellation downgrade without removing manual/team grants.

## Rollback

- Previous deployment available.
- Emergency flags documented.
- Checkout disable documented.
- Managed-provider disable documented.
- File-conversion disable documented.
- Secret rotation procedure documented.
- Residual dependency advisories reviewed as accepted risk unless safe upstream fixes are available.
