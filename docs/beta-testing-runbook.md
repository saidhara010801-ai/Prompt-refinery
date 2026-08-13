# Clarift Beta Testing Runbook

## Beta Configuration

- Hosted app: `https://clarift--clarift-e4f6f.us-east4.hosted.app/`
- Sign-in is required. Each account receives a personal tenant, workspace, and trial wallet.
- Provider keys are not required from beta testers.
- When no Clarift-managed provider is configured, `ENABLE_LOCAL_INFERENCE_FALLBACK=true` routes Refinery and Evaluator requests through the deterministic server-side fallback.
- Local fallback requests are tenant-scoped, rate-limited, idempotent, audited as provider `local`, and charged zero credits.
- BYOK, Razorpay billing, and the public developer API remain disabled.

## Web Test

1. Sign in with Google and confirm the personal workspace loads.
2. Run Quick Refine, Guided Fix, and Full Council with a non-sensitive sample prompt.
3. Confirm the UI reports that beta fallback was used and the available-credit balance does not decrease.
4. Create a project, refine inside the project, start a second chat, switch chats, and leave or switch the project.
5. Evaluate a prompt against two or more guidelines.
6. Convert one text file and one supported office or PDF document to Markdown.
7. Sign out and confirm protected workspace data is no longer visible.

## Extension Test

1. Download `/downloads/clarift-browser-extension.zip` from the hosted app.
2. Extract it, open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Open the extension settings and connect the tester's Clarift account.
4. Approve the matching one-time code in the hosted Clarift tab.
5. Open ChatGPT, Claude, Gemini, or another supported chatbot, focus its prompt editor, and select **Refine with Clarift**.
6. Confirm the prompt is replaced and the extension reports the Clarift beta fallback.
7. Sign out from extension settings and confirm subsequent refinement requires reconnection.

The current package version is `2.1.0`. Remove older unpacked installations before testing a newly extracted package.

## Expected Fallback Quality

The local fallback is a structured prompt transformer and heuristic evaluator, not a generative model. It preserves the original task, adds role, context, method, constraints, verification, and output requirements, and supports project memory and text attachment context. It is suitable for onboarding, workflow, extension, converter, and reliability testing. Provider-backed quality comparisons and model-dependent reasoning remain blocked until a Clarift-managed credential is configured.

## Managed Provider Switch-Over

1. Store a Clarift-owned Gemini or OpenRouter credential in Cloud Secret Manager.
2. Reference the secret from `apphosting.yaml` and grant the App Hosting backend access.
3. Configure provider hard quotas and budget alerts before rollout.
4. Keep local fallback enabled during the canary so provider timeouts and outages settle at zero credits and return a usable structured refinement.
5. Verify `/api/health?ready=1`, provider usage metadata, reservation settlement, extension refinement, and cost dashboards.
6. Disable local fallback only after provider reliability meets the beta exit target.

## Beta Evidence

For each failure, record the time, surface (web or extension), action, mode, browser, request ID when shown, and a redacted description. Never include API keys, authentication tokens, payment data, private project memory, or full confidential prompts in reports.
