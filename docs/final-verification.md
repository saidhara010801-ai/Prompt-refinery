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
- Stripe webhook valid signature, invalid signature, duplicate event, cancellation, failed payment.
- Billing portal.
- Admin owner bootstrap.
- Admin user search with redaction and pagination.
- Manual/team/beta/test Pro grant/revoke; verify revocation does not cancel Stripe.
- Account suspend/reactivate.
- Suspended/disabled account blocks checkout, managed provider calls, saved prompts, and project-memory actions.
- Legacy user document with missing role/tier/status/source defaults to user/free/active.
- Audit logs for search, entitlement read, grant, revoke, status change, health read, audit read, and unauthorized attempts.
- Health/readiness.
- Monitoring alerts.

## Known Risks

Document any residual npm audit advisories, disabled features, manual setup gaps, and production-provider limits here before launch approval.

## Latest Local Security Tests Added

- Legacy user default resolver coverage.
- Bootstrap role boundary coverage for user/support/admin/owner.
- Account status blocking coverage.
- Entitlement precedence coverage for free, Stripe Pro, manual grant, expired grant, revoked grant, manual grant surviving Stripe cancellation, and owner role.
- Firestore rule assumption coverage for privileged collection denies and server-managed user fields.
