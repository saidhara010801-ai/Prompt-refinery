# Deployment Decision

## Decision

Use Firebase App Hosting for production. Use Render only as a documented fallback if future document conversion requires custom runtime isolation.

| Area | Firebase App Hosting | Render |
| --- | --- | --- |
| Next.js support | First-class Firebase-oriented support | Supported as a custom Node service |
| SSR/API routes | Supported | Supported |
| Firebase Auth/Firestore integration | Strongest fit for this app | Works, but requires more manual configuration |
| Secret management | Google Secret Manager integration | Render environment/secrets |
| Environment variables | App Hosting config and console-managed values | Render dashboard/env groups |
| Stripe webhooks | Supported through API routes | Supported |
| Scaling | Managed Google/Firebase scaling | Render instance scaling |
| Monitoring/logging | Firebase/Google Cloud logs | Render logs/metrics |
| MarkItDown compatibility | Optional; may need separate service | Easier custom runtime control |
| Cost | Good fit while Firebase remains central | Potentially simple, but duplicates Firebase ops |
| Operational complexity | Lower for Firebase-centric stack | Higher because Firebase still remains required |

## Firebase App Hosting Path

- Keep private values in Secret Manager.
- Keep public Firebase config as public env values only.
- Use `/api/health` for liveness and `/api/health?ready=1` for readiness.
- Keep MarkItDown disabled until runtime installation/isolation is decided.

## Render Rejection Criteria

Do not move to Render unless Firebase App Hosting cannot support the required runtime behavior or document conversion must run in a custom isolated process.
