# Render Fallback

Render is a fallback deployment path, not the default.

Use Render only if Firebase App Hosting cannot support a required production runtime capability, such as isolated MarkItDown conversion or custom process management.

## Requirements

- Keep Firebase Auth and Firestore as the source of identity and data.
- Configure all `NEXT_PUBLIC_FIREBASE_*` values.
- Configure private server secrets only in Render environment variables.
- Use the same `/api/health` and `/api/health?ready=1` checks.
- Keep Firestore rules and indexes deployed through Firebase CLI.
- Keep Stripe webhook URL pointed at the Render production domain.

## Security Notes

- Do not expose server secrets as public env vars.
- Do not store BYOK Gemini/OpenRouter keys.
- Keep managed providers disabled unless quotas and allowlists are live.
- Use Render logs only with redacted application logging.
