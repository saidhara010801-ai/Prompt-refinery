# Monitoring

## Health Checks

Monitor:

- `GET /api/health`
- `GET /api/health?ready=1`

Health responses must expose booleans/status only, never secret values.

## Alerts

Create alerts for:

- Readiness non-200.
- Stripe checkout failures.
- Stripe webhook failures or duplicate retry spikes.
- High 401/403 rates.
- High 429 rates.
- High 5xx rates.
- Gemini auth/quota errors.
- OpenRouter auth/quota errors.
- MarkItDown 503 spikes.
- Firebase Admin credential failures.
- Firestore permission errors.
- Unusual usage/token/cost spikes.
- Admin role/status/entitlement changes.
- Build or deployment failures.

## Logging Policy

Logs must redact keys, bearer tokens, cookies, auth headers, prompts, uploaded contents, provider raw responses, Stripe secrets, and private account data. Prefer structured error codes over raw exception dumps.
