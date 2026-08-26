# Clarift Phase A — Local Runtime Acceptance Evidence

- Date: 2026-08-27 (Asia/Calcutta).
- Branch: `codex/phase-a-runtime-acceptance`.
- Security checkpoint: `2e6aa0e` (`fix: harden MCP Phase A boundaries`).
- Status: local runtime and emulator acceptance expanded; staging and public release remain pending.
- Safety: all new tests use fake tokens, mock upstreams, loopback listeners, and an isolated Firestore emulator project. No production deployment or customer data was used.

## Implemented after the checkpoint

- HTTP malformed JSON now returns HTTP `400` with JSON-RPC parse code `-32700`; unexpected failures remain `500/-32603`.
- Actual stdio child-process MCP initialization, discovery, and `usage_get` execution through a loopback mock API.
- HTTP method, malformed-body, forged Host, recovery, and loopback Origin tests against the production bridge.
- In-memory MCP protocol invocation and consent validation before upstream dispatch.
- Upgraded `@modelcontextprotocol/sdk` from `1.18.2` to `1.30.0`, clearing the SDK's known high-severity production advisories while remaining on the supported v1 protocol line.
- Upgraded Next.js and its matching ESLint configuration from `15.5.21` to `15.5.24`, clearing the direct Next.js/Sharp high-severity production finding.
- Aligned the workspace on Zod `3.25.76` and deduplicated the dependency tree. This satisfies the MCP SDK's schema range and prevents cross-version TypeScript inference exhaustion.
- Firebase rules test dependency and a portable emulator runner that uses `FIRESTORE_EMULATOR_JAR` or the Firebase CLI emulator cache.
- Executed Firestore rules tests for own-tenant read, foreign/anonymous denial, browser mutation denial, and protected API-key/audit/graph collections.
- Executed persisted server memory create, list, keyword search, deactivate, inactive-inclusive read, reactivate, edit, delete, provenance, audit, and tenant-isolation tests.
- Executed first-request legacy-token authentication against Firestore, including denial before migration, safe default-scope persistence after an allowed request, and denial after migration.

## Commands and results

| Command | Result | Evidence scope |
| --- | --- | --- |
| `npm run verify` at checkpoint `2e6aa0e` | PASS; 80 tests, full production build | Original security candidate |
| `npm run verify` before dependency hardening | PASS; 84 tests, full production build | Runtime/emulator candidate |
| `npm run verify` after dependency hardening | PASS; lint, type-check, 84 tests, SDK/CLI and extension packaging, Next.js 15.5.24 build with 46 generated pages | Final local candidate in this phase |
| `npm test` after additions | PASS; 84 tests | Unit/regression plus seven MCP protocol tests |
| `npm run test:firestore-emulator` | PASS; 3 tests | Rules, persisted memory lifecycle, real legacy-token authentication path |
| `node --import tsx --test tests/mcp-protocol.test.ts` after dependency hardening | PASS; 7 tests | MCP SDK 1.30 HTTP, stdio, in-memory, validation, and recovery compatibility |
| `npm run build:developer` after dependency hardening | PASS | Published SDK and CLI TypeScript builds |
| `npm run typecheck` after Zod alignment | PASS in 28 seconds | Whole-workspace type compatibility |

Expected Firestore `PERMISSION_DENIED` diagnostics appear during the rules test because denied browser mutations are asserted behavior.

## Acceptance impact

| Area | Newly established local evidence | Remaining status |
| --- | --- | --- |
| A-TRN-01/02/06/08/11/15 | HTTP and stdio protocol, discovery, one real tool call, stdout integrity, method/body/Host/Origin rejection and recovery | PARTIAL: cancellation, size limit, protocol-version matrix, concurrency and multi-client cases remain |
| A-AUTH-13 | Actual first legacy-token request and migration persistence | PASS locally; staging confirmation remains |
| A-SCP-04/12 | Server tenant rejection plus executed browser Firestore rules | PARTIAL: complete 8-scope × 11-tool and workspace matrix remains |
| A-VAL-01 consent subcase | Invalid consent rejected before upstream dispatch | PARTIAL: all field/type/boundary permutations remain |
| A-MEM-02–11 core lifecycle | Persisted create/search/list/deactivate/reactivate/edit/delete and audits | PARTIAL: races, large windows, legacy fixtures, trashed-parent search and all kinds remain |
| A-GATE-01 | Direct disabled error before project/database/embedding work | PARTIAL: MCP envelope and explicit telemetry instrumentation remain |

Passing a grouped test does not mark every parameterized subcase in the Phase A plan as passed.

## Production dependency audit

The initial production-only audit reported 66 findings: 11 high and 55 moderate. It included direct high-severity findings in MCP SDK `1.18.2` and Next.js `15.5.21`.

After the compatible updates and dependency deduplication, `npm audit --omit=dev --json` reports:

- 0 critical, 8 high, 53 moderate, 61 total findings.
- No direct high-severity or critical dependency findings.
- Direct moderate findings remain in `genkit`, `@genkit-ai/google-genai`, and `@genkit-ai/next`, all currently reported without a fix.
- `firebase-admin` remains a direct moderate finding; npm only offers the semver-major `14.3.0` migration, which requires a separately scoped compatibility phase.

The remaining transitive high findings are concentrated in the current Genkit/OpenTelemetry dependency graph. They remain a staging/public-release risk requiring explicit review; this work does not claim a clean audit.

## Reproduction

Use a supported Node version. The current shell reports Node `22.11.0`; dependency installation warns that one transitive lint package requires Node `22.13.0` or newer on the Node 22 line. Prefer Node `20.19+`, `22.13+`, or a newer supported LTS before staging/CI evidence.

~~~powershell
npm ci
npm run verify
npm run test:firestore-emulator
~~~

If the runner cannot locate the emulator installed by Firebase CLI:

~~~powershell
$env:FIRESTORE_EMULATOR_JAR = "C:\path\to\cloud-firestore-emulator.jar"
npm run test:firestore-emulator
~~~

## Remaining Phase A gates before later feature phases

1. Run the complete scope, ordinary non-owner, revoked/expired token, workspace, and account-status matrix in emulator/staging.
2. Run bounded quota, idempotency, failure-settlement, cancellation, and concurrency tests with deterministic provider stubs.
3. Run all supported conversion formats and payload boundaries on the Linux staging runtime.
4. Deploy the exact candidate to an identified staging Firebase project and run the live Section 7 MCP walkthrough with approved test accounts.
5. Validate a second supported MCP client, index behavior, soak/restart/recovery, backup restoration, and rollback.
6. Record final commit/deployment revision and reviewer sign-off.

Do not enable Phase B hybrid retrieval, publish packages/extensions, or expose the local HTTP bridge publicly until the remaining Phase A P0/P1 gates pass.
