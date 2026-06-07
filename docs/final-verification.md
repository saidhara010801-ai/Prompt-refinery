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
- Revoked Firebase ID tokens are rejected server-side and return a safe reauthentication error.
- Disabled Firebase users are mapped to a safe account-disabled response.
- Firestore rules and indexes deployed.
- Gemini BYOK valid/invalid.
- OpenRouter BYOK valid/invalid.
- Stripe Checkout test and live-mode dry run.
- Stripe webhook valid signature, invalid signature, duplicate event, cancellation, failed payment.
- Billing portal.
- Admin owner bootstrap.
- Admin user search with redaction and pagination.
- Manual/team/beta/test Pro grant/revoke; verify revocation does not cancel Stripe.
- Account suspend/reactivate.
- Suspended/disabled account blocks checkout, managed provider calls, saved prompts, and project-memory actions.
- Checkout uses an explicit account-status helper and blocks disabled, suspended, and `deleted_pending` accounts.
- Legacy user document with missing role/tier/status/source defaults to user/free/active.
- Audit logs for search, entitlement read, grant, revoke, status change, health read, audit read, and unauthorized attempts.
- Admin rate limits for user search, audit-log reads, entitlement reads, health reads, grant/revoke, and account status changes.
- Admin user search and audit-log APIs reject unbounded reads with hard page-size caps.
- Audit metadata redacts prompt, content, memory, key, apiKey, secret, token, bearer, cookie, authorization, provider response, and response fields.
- Audit request metadata stores hashed IP/user-agent values only.
- Unexpected admin API wrapper failures are audit-attempted with redacted metadata only.
- `ENABLE_MOCK_AUTH=true` does not enable mock auth in production.
- `supportAccessRequests/{document=**}` is denied to browser clients until a scoped support-access flow is intentionally implemented.
- Health/readiness.
- Monitoring alerts.

## Known Risks

Document any residual npm audit advisories, disabled features, manual setup gaps, and production-provider limits here before launch approval.

## Latest Local Security Tests Added

- Legacy user default resolver coverage.
- Bootstrap role boundary coverage for user/support/admin/owner.
- Account status blocking coverage.
- Revoked-token and disabled-Firebase-user error mapping coverage.
- Explicit checkout account-status helper coverage.
- Admin rate-limit policy and max page-size coverage.
- Support/admin/owner permission-boundary coverage, including owner-only grant/revoke and status actions.
- Audit metadata redaction and request-hash coverage.
- Admin wrapper unexpected-failure audit metadata coverage.
- Production mock-auth rejection coverage.
- Entitlement precedence coverage for free, Stripe Pro, manual grant, expired grant, revoked grant, manual grant surviving Stripe cancellation, and owner role.
- Firestore rule assumption coverage for privileged collection denies and server-managed user fields.
- Firestore rule assumption coverage for `supportAccessRequests` browser denial and profile-creation protected fields.

## Phase C/D Closure Results

- Admin APIs have a shared in-memory throttle. Mutating owner-only actions are stricter than read/search endpoints.
- Admin user search is email-prefix/UID based, cursor-capable, and capped at 25 results.
- Audit-log reads are cursor-paginated and capped at 25 results.
- Firestore rule assumptions are covered by regression tests that inspect the checked-in rules file. Full emulator-based rule tests are still recommended before public launch.
- Local closure verification was run on this branch; production env verification still requires real Firebase/Stripe/App Hosting values.
- Residual dependency advisories remain accepted risk unless safe upstream package fixes become available; do not use forced downgrades or unsafe lockfile churn.
