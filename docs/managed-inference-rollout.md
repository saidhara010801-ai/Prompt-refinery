# Managed-Inference Rollout Runbook

## Current Release State

The codebase contains the personal-tenant schema, managed AI gateway, transactional credits, encrypted BYOK storage, scoped developer tokens, Razorpay billing integration, and extension account linking. The production defaults deliberately expose only the validated subset:

| Capability | Production default | Activation requirement |
| --- | --- | --- |
| Managed Gemini | Enabled | Existing managed Gemini secret, provider spend caps, and `/api/health?ready=1` |
| Extension account linking | Enabled | Managed inference healthy and extension E2E pass |
| Encrypted BYOK | Disabled | 32-byte Secret Manager key, rotation/recovery rehearsal, validation tests |
| Razorpay billing | Disabled | KYC/live activation, approved catalog and policies, test-mode webhook matrix |
| Developer API | Disabled | Token pepper, tenant/scope test pass, managed cost controls |
| Managed OpenRouter fallback | Disabled | Allowlist, API secret, spend cap, timeout/failure benchmarks |
| Stripe checkout | Disabled | Separate product migration or removal decision |

Do not enable a capability only because its UI and routes exist. Every capability fails closed through an explicit environment flag and runtime readiness check.

## Data Model

Every Firebase user receives deterministic personal resources:

- Tenant: `personal_{uid}`
- Workspace: `personal_{uid}_default`
- Membership: `personal_{uid}_{uid}` with owner role
- Wallet and entitlement keyed by tenant ID

Tenant-owned content is stored in top-level `projects`, `savedPrompts`, `evaluations`, `attachments`, and `usageEvents` collections. Wallets, reservations, ledger entries, billing events, provider credentials, developer tokens, extension sessions, limits, and gateway idempotency records are server-only.

Legacy `users/{uid}/...` data remains untouched for rollback while compatibility migration is active.

## Migration

1. Back up Firestore and record legacy collection counts.
2. Run a dry page. `npm run migrate:personal-tenants -- --apply=false --limit=25`
3. Verify the reported user, project, session, memory, prompt, evaluation, and usage counts.
4. Apply one page. `npm run migrate:personal-tenants -- --apply=true --limit=25`
5. Continue with `--page-token={lastUid}` until the command returns no token.
6. Rerun the final page and sampled users. Completed users must report `alreadyMigrated: true`.
7. Compare legacy and tenant-scoped counts and verify sampled ownership fields.
8. Keep legacy data for one full rollback window. Retire compatibility reads and delete legacy paths only in a later reviewed release.

The protected HTTP job `/api/jobs/migrate-personal-tenants` accepts the same `apply`, `limit`, and `pageToken` fields with `Authorization: Bearer $CRON_SECRET`.

## Required Secrets

Store secret values in Cloud Secret Manager; never commit them or put them in public environment variables.

- Managed providers: `CLARIFT_GEMINI_API_KEY`, optionally `CLARIFT_OPENROUTER_API_KEY`
- BYOK: `CLARIFT_BYOK_ENCRYPTION_KEY` (base64 or hex encoded 32 bytes)
- Developer API: `CLARIFT_API_TOKEN_PEPPER`
- Razorpay: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, optional old webhook secret during rotation
- Jobs: `CRON_SECRET`

Create and verify secret references in staging before adding new references to `apphosting.yaml`; a missing referenced secret can prevent a rollout.

## Razorpay Gate

Use product codes from `RAZORPAY_CATALOG_JSON`. Browser clients never submit an amount, currency, credit grant, or Razorpay plan ID. A valid launch catalog must include approved INR credit packs and exactly one monthly Individual subscription.

Before enabling `ENABLE_RAZORPAY_BILLING`:

1. Complete business activation and obtain separate test/live keys.
2. Approve prices, included credits, expiry, grace, cancellation, refund, dispute, tax, and unused-credit policies.
3. Configure a raw-body webhook and preserve `x-razorpay-event-id`.
4. Pass order paid, initial subscription charge, renewal, duplicate, out-of-order, pending, halted, cancellation, completion, and invalid-signature tests.
5. Confirm duplicate events never create a second immutable credit-ledger grant.

## Operational Controls

- Configure provider hard spend caps and budget alerts outside Clarift.
- Tune `CLARIFT_USER_RPM`, `CLARIFT_TENANT_RPM`, task concurrency, Full Council concurrency, and provider timeout from staging measurements.
- Keep the launch task-cost table server-owned in `CLARIFT_TASK_COSTS_JSON`.
- Monitor failed gateway requests, reservation age, wallet/ledger reconciliation, provider latency, payment-event failures, and refresh-token failures.
- Never log prompts, converted content, provider responses, credentials, payment signatures, or full tokens.

## Release Gates

Run `npm run verify` and then complete:

- Firebase Emulator tenant-isolation and migration-idempotency suite
- Razorpay test-mode lifecycle suite
- Extension E2E on ChatGPT, Claude, Gemini, and a generic content-editable page
- Multi-instance wallet reservation, distributed rate-limit, provider-timeout, and Full Council load tests
- Source, standalone build, runtime logs, Firestore sample, and packaged-extension secret scan
- Staging rollback rehearsal and Firestore export restore verification
- `/api/health?ready=1` on the release backend

The implemented rollout order is dark schema, migration dry run, migration apply, internal managed inference, BYOK staging, extension beta, Razorpay test mode, production canary, then public release. Organization tenants, annual plans, Payment Links, large-file asynchronous conversion, and unvalidated automatic fallback remain deferred.

## Rollback

1. Disable `ENABLE_RAZORPAY_BILLING`, `ENABLE_PUBLIC_API`, `ENABLE_BYOK`, and `ENABLE_EXTENSION_ACCOUNT_LINKING`.
2. If provider cost or correctness is at risk, disable `ENABLE_MANAGED_INFERENCE`.
3. Roll App Hosting back to the last healthy revision.
4. Preserve all wallet, ledger, reservation, payment-event, and migration records for reconciliation.
5. Continue reading legacy user paths during the rollback window; never reverse tenant migration by deleting copied data.
