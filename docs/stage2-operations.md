# Clarift Stage 2 Operations

## Feature Configuration

Stage 2 production uses these runtime flags:

- `ENABLE_PROMOTION_CODES`: signup-time promo redemption and owner controls.
- `ENABLE_PROJECT_SHARING`: account-to-account project and saved-prompt sharing.
- `ENABLE_USAGE_ANALYTICS`: metadata-only user analytics dashboard.
- `ENABLE_PUBLIC_API`: Clarift API key management and `/api/v1` endpoints.

Store `PROMO_CODE_PEPPER`, `CLARIFT_API_KEY_PEPPER`, and `CRON_SECRET` in Google Cloud Secret Manager. They are referenced by `apphosting.yaml` and must never be committed as plaintext.

## Project Memory Migration

The migration is idempotent because each legacy project session maps to deterministic memory-entry IDs.

```bash
npm run migrate:project-memory
npm run migrate:project-memory -- --apply
```

The first command is a dry run. Set `MIGRATION_LIMIT` to process a controlled batch. Re-run with `--apply` until the dry run reports no previously unprocessed legacy sessions in the selected range.

When local Application Default Credentials are unavailable, call the hosted maintenance endpoint with the `CRON_SECRET`. Pass the returned `nextPageToken` into the next request until it is `null`:

```text
POST /api/jobs/migrate-project-memory
Authorization: Bearer <CRON_SECRET>
Content-Type: application/json

{"apply":true,"limit":250,"pageToken":null}
```

## Trash Purge

Projects moved to Trash receive a `purgeAt` timestamp 30 days in the future. Configure Cloud Scheduler to call:

```text
GET https://clarift--clarift-e4f6f.us-east4.hosted.app/api/jobs/purge-project-trash
Authorization: Bearer <CRON_SECRET>
```

Run daily. A response with `hasMore: true` means another invocation should follow because the job purges at most 100 projects per request.

## Public API

Create a Clarift API key in Settings. Every API request uses:

```text
Authorization: Bearer clf_live_...
X-Provider-API-Key: <Gemini or OpenRouter key>
X-AI-Provider: gemini | openrouter
```

The OpenAPI document is served at `/api/v1/openapi.json`. Provider keys are request-scoped and are not stored. Clarift API keys are stored only as HMAC hashes and can be revoked from Settings.

## Browser Extension

The Manifest V3 test build is downloadable from Clarift Settings > Browser Extension. Extract the ZIP, load the folder in Chrome or Edge developer mode, then enter a Clarift API key and provider key on its settings page. It activates automatically on ChatGPT, Claude, Gemini, Copilot, Perplexity, Poe, Grok, and Google AI Studio; use the extension popup to enable it temporarily on another web chatbot.

## Privacy Boundaries

Usage events contain feature type, technique, score, provider label, item count, source, success state, and timestamp. They do not contain prompts, converted documents, project memory, provider responses, or API keys.

Shared resources remain private in Firestore. Server APIs authenticate every read and write. Editors may change shared prompt content or append project memory notes; they cannot delete, rename, move, or administer the owner’s project.
