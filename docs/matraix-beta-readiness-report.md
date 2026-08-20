# Clarift MatrAIx Beta Readiness Report

Date: 2026-08-20
Scope: Clarift managed inference, extension linking, conversion, beta telemetry, and MatrAIx-Persona-8B compatibility

## Executive Decision

Clarift can be evaluated with MatrAIx-Persona-8B, but the first run must be a controlled beta exercise rather than unrestricted public traffic. The repository is MIT-licensed and supports Survey, Chat, Web, and OS persona simulations. Its Survey/Chat smoke path works without Docker or a model key; live persona runs require a separate test model key, and Web/OS runs require Docker through WSL2 on Windows.

The no-key MatrAIx smoke test passed. Full live persona testing is held until the remaining external gates are complete. Clarift production provider secrets must never be copied into MatrAIx, its task files, logs, or local shell history.

## Test Result

Environment:

- MatrAIx checkout: `/home/sato/MatrAIx-Clarift` inside Ubuntu on WSL2.
- Python: 3.12.3.
- uv: 0.12.5.
- Clarift verification: Node/Next.js production build on Windows.

Executed MatrAIx test:

```text
Smoke: ok
Task: application/tasks/example-survey_product-feedback
App: survey
Runtime: host json_survey / persona-json-survey
Mode: fake
Personas: 1
Calls: 1
Cost: $0
```

Executed MatrAIx Harbor Web smoke:

```text
Recipe: configs/jobs/example-job-recipe/harbor-smoke-local.yaml
Trials: 1
Completed: 1
Exceptions: 0
Retries: 0
Mean reward: 1.000
Runtime: 1m 9s
Provider tokens/cost: none reported (local smoke)
```

The content-free synthetic result is preserved in `docs/test-data/matraix-smoke-2026-08-20.json`.

Clarift verification:

- TypeScript: passed.
- ESLint: passed.
- Regression tests: 66 passed, 0 failed.
- Next.js production build: passed, including `/api/admin/beta-report`.
- Extension ZIP packaging: passed.
- MarkItDown: packaging remains Linux-only by design and will run during App Hosting deployment.

## Pre-Test Findings And Fixes

| Severity | Finding | Resolution |
| --- | --- | --- |
| High | OpenRouter used the stale/non-release model `google/gemma-4-26b-a4b-it`, causing managed requests to fall into Basic mode. | Changed the released primary to `google/gemma-3-4b-it`, corrected prices, and made readiness reject stale model or price configuration. |
| High | Public extension device start, exchange, and refresh endpoints could be flooded; start could create unbounded Firestore documents. | Added 4 KiB request limits and transactional IP/device/token rate limits with `429` and `Retry-After`. |
| High | Browser clients could create or update user profile documents containing server-owned tenant fields. | Made user-profile writes server-only in Firestore rules. |
| High | Admin throttling was process-local and ineffective across multiple App Hosting instances. | Replaced it with Firestore-transactional distributed throttling. |
| Medium | Together did not use the same strict output contract as OpenRouter. | Added strict JSON Schema response formatting and identical Zod validation. |
| Medium | Converter, evaluator, and token-count failures could log raw error objects. | Logs now retain only bounded error names. |
| Medium | Extension refresh could return an internal error message to the chatbot page. | Replaced it with a stable reconnect message. |
| Medium | Owner signup notification delivery could be abused through automated account creation. | Added a distributed global hourly delivery cap while keeping undelivered records retryable. |
| Medium | The owner had no safe way to collect beta evidence without handling tester identities or content. | Added an owner-only 30-day JSON export containing aggregate, content-free telemetry only. |
| Medium | Several vulnerable transitive package versions were present. | Pinned safe compatible releases for body-parser, brace-expansion, fast-uri, form-data, and nanoid. |

## Residual Release Gates

These items block a full live model-backed MatrAIx persona run, but not the completed Survey and Web smoke tests:

1. Create a dedicated, budget-capped model key for MatrAIx. Do not reuse Clarift production provider secrets.
2. Create a dedicated Clarift test account and tenant, label it as test/beta, and exclude it from user-product KPI reporting.
3. Enable Firebase App Check where supported, a signup CAPTCHA or equivalent bot control, password policy enforcement, and email-enumeration protection in Firebase Authentication.
4. Resolve or formally accept the remaining dependency risk: `npm audit --omit=dev` reports 9 high and 53 moderate production findings, primarily in the Genkit/OpenTelemetry dependency tree and Next.js image tooling. The affected telemetry endpoints are not exposed, and untrusted converter images bypass Next image optimization, but upstream-compatible fixes are not currently available without major framework changes.
5. Rehearse rollback before enabling additional beta tenants.

Completed production gates:

- Docker Desktop is running and available inside Ubuntu WSL2.
- Clarift `/api/health?ready=1` reports all checks ready on `https://clarift.dpdns.org`.
- The protected beta-report route is live and rejects unauthenticated access.
- Firestore rules and indexes are deployed; the final rules compile without warnings.

## Beta Evidence Policy

The Admin Center export aggregates only beta-enabled tenant usage events. It includes task, source, status, quality tier, provider, latency, token totals, provider cost, and bounded error categories.

It excludes tester email, Firebase UID, tenant ID, principal ID, prompts, refined output, attachment data, provider response content, API keys, and authorization headers. Raw events expire after 90 days; aggregates expire after approximately 13 months.

The current beta cohort report must be exported after the hardened build is deployed. Synthetic MatrAIx results must use a dedicated test tenant and a recorded test window so they are not mistaken for organic tester behavior.

## Live Test Protocol

1. Deploy rules and indexes, then the application build with managed inference initially limited to the owner and explicit beta tenants.
2. Confirm readiness, provider circuits, global budgets, and a successful owner Quick Refine.
3. Run 10 deterministic Survey/Chat prompts through the dedicated test tenant: five Quick, three Guided, one Full Council, and one Evaluate.
4. Validate every response contract, no duplicate quota settlement, no prompt leakage in logs, and graceful Basic mode fallback.
5. Run one Web smoke task after Docker integration is healthy. Do not run arbitrary OS tasks against the production workstation.
6. Export the 30-day beta evidence JSON before and after the test, then compare request success, generative rate, fallback rate, p95 latency, malformed output, provider failover, and spend.
7. Stop immediately if tenant isolation fails, prompts appear in telemetry, cost limits fail, malformed output reaches the client, or the provider error rate exceeds the beta threshold.

## Product Improvements

### UI And UX

- Show a compact generative/Basic status next to every result, with the public fallback reason and reset time when applicable.
- Add an owner Test Center that runs bounded synthetic checks and shows readiness, provider health, quota settlement, and request IDs in one place.
- Improve Admin Center mobile behavior with a full-height sheet, sticky tabs, and clearer loading/partial-failure states.
- Add a beta feedback action beside each result using structured categories such as relevance, specificity, faithfulness, format, and latency.
- Make project/chat selection persist across reloads and display the active project prominently before refinement.
- Add accessible focus management, status announcements, and keyboard navigation checks to all dialogs and segmented controls.

### Functionality

- Add server-owned experiment tags for model/prompt variants without exposing provider choice to normal users.
- Add golden-set evaluation for refinement quality, schema adherence, task preservation, and hallucination rate.
- Add a quarantined synthetic-test tenant type excluded from billing, signup email, and product analytics.
- Add an asynchronous conversion queue with malware scanning before increasing file limits.
- Add automated circuit and budget alerting with an owner notification when fallback rates exceed threshold.
- Add an explicit data-export deletion workflow and a tester consent record for beta research.

### Real-World Usability

- Provide goal-specific refinement presets for writing, research, code, support, sales, and data analysis.
- Add reusable organization style guides only after tenant isolation and team roles are fully tested.
- Add prompt quality history that highlights which edits improved downstream results, not only token counts.
- Add extension diagnostics that can copy a content-free support bundle containing contract version, request ID, timing, and error category.
- Add opt-in integrations through scoped tokens; never ask users to paste provider keys into chatbot pages or extension storage.

## Release Recommendation

Proceed with deployment of the hardening changes and a small owner-controlled beta. Do not start broad MatrAIx live persona traffic until the residual release gates are closed. The next evidence milestone is a successful production readiness check plus a privacy-safe before/after beta export from the owner Admin Center.

## References

- [MatrAIx-Persona-8B repository](https://github.com/MatrAIx-ai/MatrAIx-Persona-8B)
- [OpenRouter Google model catalog](https://openrouter.ai/google/)
- [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- [Together serverless model catalog](https://docs.together.ai/docs/serverless/models)
