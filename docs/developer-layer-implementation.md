# Clarift Developer Layer

Implementation baseline: 2026-08-25 updated guide.

The Developer layer is a provider-agnostic API, SDK, CLI, and MCP surface over Clarift's existing Firebase tenant control plane and managed inference gateway. It does not change the consumer freemium workspace and does not accept provider keys or model selections.

## Release status

### Phase A — implemented

- Public v1 routes cover refinement, evaluation, conversion, projects, project memory, memory search, and usage.
- Bearer tokens are HMAC-hashed at rest, limited to ten active tokens per tenant, expiry-aware, rate-limited, tenant-bound, and scope-checked before request-body parsing.
- Developer entitlement is explicit in the tenant account contract. Existing active Pro users map to Developer access, while a later Pro revocation does not leave migrated access active.
- The OpenAPI 3.1 contract is served at `/api/v1/openapi.json`.
- `@clarift/sdk` contains the typed JavaScript/TypeScript client.
- `@clarift/cli` contains the CLI and MCP server. MCP supports stdio and stateless Streamable HTTP; the HTTP bridge is restricted to loopback hosts.
- Memory create/update/activation/deactivation/delete mutations require explicit consent through the public API and produce content-free audit events.
- Memory entries carry source, agent, request ID, user ID, consent mode, timestamps, active status, and validity windows.

The repository contains publishable packages, but publishing to the npm registry is a separate release operation and is not performed by the application deployment.

### Phase B — guarded foundation implemented

- Firestore temporal graph schema:
  - Node types: `Project`, `Decision`, `Constraint`, `File`, `AgentHandoff`, `Review`, `Skill`, `EvaluationResult`.
  - Edge types: `supersedes`, `related_to`, `authored_by`, `reviewed_by`, `depends_on`, `contradicts`, `implements`.
- Explicitly consented Developer API memory writes can distill and mirror an entry into graph nodes and edges when `ENABLE_HYBRID_MEMORY=true`.
- The embedding adapter accepts an OpenAI-compatible embedding endpoint and stores only an embedding-model hash with each vector.
- Active-context retrieval combines vector similarity, normalized keyword overlap, recency, one graph hop, temporal active filtering, and token-budget truncation.
- `/api/v1/memory/context`, SDK `getActiveMemoryContext`, CLI `memory context`, and MCP `memory_get_active_context` expose the retriever.
- Firestore browser rules deny all direct graph and memory-audit access; server APIs enforce tenant isolation.

Hybrid memory remains disabled in production. Runtime readiness fails closed if it is enabled without both `CLARIFT_EMBEDDING_ENDPOINT` and `CLARIFT_EMBEDDING_MODEL`.

### Phases C–E — not enabled

- DSPy compilation service, golden-set trainset conversion, BootstrapFewShot/MIPROv2/GEPA runs, compiled-program registry, and live-vs-compiled serving.
- Permissioned `skill create` preview/confirmation flow and portable skill emission.
- Necessity/YAGNI strategy and CI regression gate.
- Cross-agent handoff/adversarial-review routing to a second configured agent family.
- Account export/deletion coverage for graph/vector data, load testing, published comparative metrics, and controlled Developer billing.

The corresponding flags remain false: `ENABLE_DSPY_OPTIMIZATION`, `ENABLE_HYBRID_MEMORY`, `ENABLE_SKILL_GENERATION`, `ENABLE_NECESSITY_CHECK`, and `ENABLE_ADVERSARIAL_REVIEW`.

## Token scopes

| Scope | Operations |
| --- | --- |
| `refinements:write` | Create managed refinements |
| `evaluations:write` | Create managed evaluations |
| `conversions:write` | Convert supported documents |
| `projects:read` | List and read projects |
| `projects:write` | Create, update, trash, or restore projects |
| `memory:read` | List, search, and retrieve project memory context |
| `memory:write` | Create, update, activate, deactivate, or delete memory with consent |
| `usage:read` | Read plan, credits, and current allowance |

## API examples

```bash
curl https://clarift.dpdns.org/api/v1/refinements \
  -H "Authorization: Bearer $CLARIFT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Plan a safe database migration","mode":"quick_refine"}'
```

Every inference response includes `contractVersion`, `requestId`, `creditsCharged`, `qualityTier`, `allowance`, and any Basic-mode reason.

Permissioned memory write:

```bash
curl https://clarift.dpdns.org/api/v1/projects/PROJECT_ID/memory \
  -H "Authorization: Bearer $CLARIFT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Clarift-Write-Consent: true" \
  -d '{"kind":"note","title":"Decision","content":"Use the existing gateway.","consent":true}'
```

## CLI and MCP

Build and run from this repository:

```powershell
npm run build:developer
$env:CLARIFT_API_TOKEN = 'clf_live_...'
node packages/cli/dist/index.js refine --prompt 'Plan a safe database migration'
node packages/cli/dist/index.js mcp --transport stdio
node packages/cli/dist/index.js mcp --transport http --host 127.0.0.1 --port 3210
```

Memory writes through the CLI require `--yes`. MCP memory-write tools require the literal input `consent: true`.

## Hybrid memory activation gates

Before enabling `ENABLE_HYBRID_MEMORY`:

1. Configure a private or approved HTTPS embedding endpoint and model.
2. Confirm the endpoint's data-retention and regional-processing terms.
3. Load-test vector generation, Firestore document size, 200-node candidate scans, one-hop expansion, and token truncation.
4. Backfill existing active memory entries with provenance and embeddings through a controlled migration.
5. Verify account export and deletion recursively cover `memoryGraphNodes`, `memoryGraphEdges`, and `projectMemoryAudit`.
6. Run with/without-memory golden tasks and require a measurable retry/token improvement before rollout.

Until these gates pass, keyword memory search remains available while hybrid retrieval returns a feature-disabled error.
