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

## Firebase App Hosting

`apphosting.yaml` references Stripe values in Cloud Secret Manager. Create or rotate them before the first rollout:

```powershell
firebase apphosting:secrets:set STRIPE_SECRET_KEY
firebase apphosting:secrets:set STRIPE_PRO_PRICE_ID
firebase apphosting:secrets:set STRIPE_WEBHOOK_SECRET
```

Configure the public `NEXT_PUBLIC_FIREBASE_*` variables and `APP_BASE_URL=https://<production-host>` for the backend environment. `APP_BASE_URL` is the trusted Stripe Checkout return origin. Enable Email/Password, Anonymous, and Google sign-in providers in Firebase Authentication. Add the deployed hostname to Firebase Authentication authorized domains.

Deploy Firestore rules after review:

```powershell
firebase deploy --only firestore:rules
```

The checked-in `firebase.json` and `firestore.indexes.json` files make the rules deployment reproducible. Project-memory and saved-prompt writes are server-managed; browser rules intentionally allow read access only where required.

## Stripe

Create a recurring Pro price and store its price ID as `STRIPE_PRO_PRICE_ID`. Register:

```text
https://<production-host>/api/stripe_webhooks
```

Subscribe the webhook to:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Store the resulting signing secret as `STRIPE_WEBHOOK_SECRET`.

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
