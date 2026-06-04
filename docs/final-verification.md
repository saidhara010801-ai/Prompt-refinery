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
- Manual Pro grant/revoke.
- Account suspend/reactivate.
- Health/readiness.
- Monitoring alerts.

## Known Risks

Document any residual npm audit advisories, disabled features, manual setup gaps, and production-provider limits here before launch approval.
