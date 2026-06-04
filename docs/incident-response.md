# Incident Response

## Disable Risky Features

- Disable checkout: set `ENABLE_STRIPE_CHECKOUT=false`.
- Disable managed OpenRouter: set `ENABLE_MANAGED_OPENROUTER=false`.
- Disable file conversion: set `ENABLE_FILE_CONVERSION=false`.
- Disable admin center: set `ENABLE_ADMIN_CENTER=false`.
- Disable support access requests: set `ENABLE_SUPPORT_ACCESS_REQUESTS=false`.

Redeploy or restart the runtime after changing production flags if the platform requires it.

## Compromised Admin Or Support Account

1. Remove the user from owner/admin/support bootstrap env vars.
2. Revoke server-side role/grant records.
3. Set `accountStatus` to `disabled` or `suspended`.
4. Rotate any secrets the user could have accessed.
5. Review `adminAuditLogs` for actions taken by the account.

## Secret Rotation

Rotate compromised values in the owning provider first, then update Secret Manager:

- Firebase service-account credentials.
- Stripe secret key.
- Stripe webhook signing secret.
- OpenRouter API key.
- Gemini API key.

After rotation, verify `/api/health?ready=1` and run a focused provider/payment smoke test.

## Stripe Incident

1. Set `ENABLE_STRIPE_CHECKOUT=false`.
2. Check Stripe Dashboard webhook delivery logs.
3. Review `stripeWebhookEvents`.
4. Replay safe failed events after the fix.
5. Confirm entitlement precedence before manually changing user access.

## Provider Cost Or Abuse Incident

1. Disable managed providers.
2. Tighten allowlists and quotas.
3. Review usage aggregates and rate-limit events.
4. Suspend abusive accounts when needed.
5. Rotate provider keys if exposure is suspected.

## Rollback

1. Disable risky features first when possible.
2. Roll back Firebase App Hosting to the previous known-good release.
3. Confirm health/readiness.
4. Review audit and usage logs for data repair needs.

## User Notification

Notify users if there is confirmed unauthorized access to account data, prompt content, project memory, uploaded content, payment metadata, or provider credentials. Do not speculate in user-facing notices; state confirmed facts, actions taken, and recommended user steps.
