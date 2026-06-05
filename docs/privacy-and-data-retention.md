# Privacy And Data Retention

## Stored Data

The app may store account metadata, subscription metadata, saved prompts, projects, project sessions, entitlement grants, audit logs, and privacy-safe usage metadata.

## Data Not Stored By Default

- User BYOK Gemini/OpenRouter API keys.
- Raw Firebase, Stripe, Gemini, or OpenRouter secrets.
- Full payment card data.
- Raw provider responses in logs.
- Uploaded document contents in logs.
- Prompt, saved prompt, or project memory content in analytics by default.

## Usage Metadata

Usage analytics must track metadata only: user ID, provider, model ID, estimated tokens, success/failure, error category, cost estimate, and timestamps. It must not include prompt text, uploaded contents, BYOK keys, project memory, saved prompts, or raw provider responses by default.

## Support Access

Support/admin users must not view sensitive user content unless a later scoped support-access flow gives temporary explicit user approval. Minimal admin v1 is limited to account metadata, entitlement state, audit logs, and system health.

## Deletion And Export

Before launch, add an account export/deletion procedure covering saved prompts, projects, project sessions, usage metadata, Stripe customer references, entitlement records, and audit-log retention.

## Retention Defaults

- Audit logs: retain for security and compliance review.
- Usage events: aggregate daily/monthly; delete or compact raw events after the chosen retention window.
- Support requests: retain for support accountability.
- Deleted accounts: mark as `deleted_pending` before final deletion workflow.
