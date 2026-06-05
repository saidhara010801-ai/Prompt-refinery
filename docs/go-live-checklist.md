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
- Test checkout passed.
- Webhook endpoint configured.
- Webhook signature verified.
- Cancellation and failed-payment flows verified.
- Live keys configured only in production.

## Providers

- Gemini BYOK valid/invalid tested.
- OpenRouter BYOK valid/invalid tested.
- Managed OpenRouter disabled or fully quota-protected.
- Model allowlists configured.

## Admin And Security

- Owner bootstrap verified.
- Admin user metadata search verified with pagination and redaction.
- Owner-only Pro grant/revoke verified.
- Account suspend/reactivate verified.
- Audit logs written.
- Audit logs paginated and direct browser reads denied by Firestore rules.
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
