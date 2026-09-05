# Browser context and portable pills

Research and implementation note · 2026-09-05

Follow-up: [v2.3.1 capabilities](extension-release-2.3.1.md) supersedes the original snapshot-only capture description below with automatic history collection. Continuous background tracking and shared project synchronization remain future work.

## Product decision

Build a local, reviewable handoff first. A browser extension can capture rendered text in permitted pages, but it cannot guarantee the entire original conversation, access every native AI panel, or make an arbitrarily long chat fit into a small context window without losing information. Distinguish the full **captured transcript**, a **compact extract**, and **user-confirmed project state**.

Version 2.3 implements optional activation across HTTP(S) websites, accessible text/search/editor support, a `clarift` omnibox keyword, source-tab/frame capture, a local editable pill, full captured-text export, and explicit attachment of reviewed context to later refinements. It does not implement continuous tracking, semantic model summarization, or cross-chat synchronization.

## Research findings and consequences

| Evidence | Consequence for Clarift |
| --- | --- |
| Chrome's [activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) grants temporary access following user invocation. | Keep one-page activation. Do not assume it survives cross-origin navigation or grants all embedded origins. |
| [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) operate against a document in an isolated world; frame matching and origin permissions control injection. | Use DOM text and open shadow roots, select frames explicitly, and expose unavailable coverage. Native address bars, other extensions' sidebars, closed roots, and internal browser documents need separate routes. |
| The [omnibox API](https://developer.chrome.com/docs/extensions/reference/api/omnibox) supplies keyword-scoped input events. | Implement `clarift` + Tab/Space as an explicit entry. The generic extension API is not a way to intercept all normal AI address-bar requests. Browser-specific integration would require an official capability from that browser. |
| [Optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions) are requested through a user gesture; [scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting) can register persistent content scripts. | Offer a separate all-websites action, handle denial and revocation, and preserve temporary activation. No required wildcard host grant. |
| [MutationObserver](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver) observes changes in the DOM. | It can support future incremental capture, but cannot recover turns that were never mounted or infer unseen branch history. This completeness limit follows from observing only the page DOM. |
| Chrome [storage](https://developer.chrome.com/docs/extensions/reference/api/storage) offers different persistence/access levels, including session storage. | Keep current capture/drafts in the local editor and reviewed context in the source document's memory. Use a one-use session draft for address-bar input; do not put prompt text in URLs. Durable project memory requires a separate retention design. |

The limits around virtualized/unloaded chat history and provider-specific DOM recognition are engineering inferences from the document model, not a claim that every provider currently renders in the same way. No authenticated personal chat or undocumented private provider API was inspected in this work.

## Current capture and trust model

1. Popup activation injects an idempotent script into the source tab's permitted frames before opening the local editor. The editor pins that tab URL and rejects conversation changes during recapture.
2. Chat mode recognizes explicit author/test attributes and a small set of chatbot markup heuristics (including ChatGPT-style roles, Claude message markers, and Gemini user/model elements). Unrecognized roles stay unknown; generic page mode is clearly labelled. DOM selectors are version-sensitive and need live compatibility fixtures before advertising universal support.
3. Capture excludes form drafts, password/other input values, navigation/chrome controls, hidden text, and injected Clarift UI. Code and repeated turns are retained. Only one selected frame enters a pill; independent frame histories are never silently merged.
4. The transcript limit is 500,000 characters / 2,000 recognized messages per frame. Full means full captured text within that limit. Capture warnings survive export.
5. Compact mode spreads its excerpt budget across early, intermediate, and recent turns, shortening individual turns with visible markers and counting omitted turns. It does not extract semantic decisions. The user fills confirmed notes and reviews/edits the result. Imported raw transcripts are one block, so important middle sections need full mode or user notes.
6. Export quotes conversation as reference data and distinguishes assistant suggestions from confirmed decisions. No prompt wrapper makes arbitrary web text trustworthy; the receiving model must follow its own instructions and treat the transcript as untrusted evidence.
7. Attaching context is a separate explicit action. The worker validates it, the server requires `consent: true`, and the gateway receives a bounded `projectMemory` reference with the current prompt. No automatic memory write or activation occurs. A capability acknowledgement prevents an old server from silently ignoring the context. Existing managed-inference processing applies once the user sends a refinement.

## Recommended next step: automatic context within one conversation

Make this a visible per-conversation opt-in, with **Start tracking**, **Pause**, **Clear**, a captured-turn count, last update, and coverage status. The current snapshot feature is a useful first step but does not automatically stay current.

- **Identity:** provider + origin + conversation ID + visible branch ID. Reset on SPA route and branch changes; do not use title alone. If no stable identity exists, use a document-local session and disclose the limitation.
- **Capture:** provider adapters produce `{messageId, role, text, sequence, branch, status, capturedAt}`. Observe only the conversation container with a debounced MutationObserver. Update streaming messages by stable ID, distinguish edits/regenerations from new turns, and recheck ordering after virtualization. Do not deduplicate solely by text.
- **Completeness:** record first/last observed turns, known gaps, adapter version, omitted attachments, truncation, and stale state. Let users load history manually or import an official export. Never silently scrape private endpoints/cookies, auto-switch branches, or promise unseen history.
- **Retention:** keep tracking off by default. Offer bounded document memory first, then an explicit local IndexedDB archive with delete controls and retention limits. Account/project synchronization is a separate consent boundary. Keep transcripts out of sync storage and content-free telemetry.
- **Refinement context:** use confirmed goal/decisions/constraints, a rolling summary with source references, relevant excerpts, and recent turns. Give the user a preview of exactly what will be sent. Avoid repeatedly appending the entire transcript to every prompt.

## Recommended semantic compression

For a story, a pure extract can drop character facts or plot decisions. A useful next version would offer **Summarize with Clarift**, explicitly sending the reviewed transcript through a metered summarization operation. Do not reuse prompt refinement and assume it performs reliable summarization.

1. Chunk every captured turn using the destination model's tokenizer and reserve output/headroom. Split oversized turns with overlap and stable span IDs.
2. Summarize each chunk into goals, entities/canon, decisions, rejected ideas, constraints, open questions, artifacts, and next actions. Every factual item must cite message/span IDs, distinguish user confirmation from model proposals, and retain uncertainty.
3. Reduce those structured summaries into a token-budgeted pill. Run checks for missing chunks, unsupported assertions, lost negations, numeric/version changes, and conflicting decisions. Preserve the full local capture as the audit trail.
4. Show exact source coverage, estimated cost, and editable output. Let the user approve the canonical notes. Cancellation/failure should leave the original capture intact.
5. Evaluate with adversarial cases: long fiction canon, decisions later reversed, repeated messages, edits/branches, prompt injection, mixed languages, code, missed attachments, and incompatible constraints. Measure factual retention and source support, not just compression ratio.

This needs a separate authenticated backend task with quota, request-size limits, cancellation, idempotency, settlement, privacy/retention, and staging acceptance. It is not part of this local extension build.

## Future scope: shared project context across LLMs

Use the existing tenant/project/memory foundations behind an explicit project link. Treat each chat as a contributor on a branch, with a shared user-approved project state. Avoid silently treating all model output as canonical truth.

| Record | Suggested fields / behavior |
| --- | --- |
| Context snapshot | `schemaVersion`, tenant/project IDs, revision, parent revision, confirmed intent, decisions, constraints, artifacts, open tasks, provenance, source coverage |
| Contribution event | event ID, actor/provider, chat/task/branch ID, base revision, type (`proposal`, `decision`, `artifact`, `task-status`, `correction`), payload, source message/span IDs, timestamp |
| Patch proposal | explicit additions/removals/replacements, affected task IDs, reasons, citations, conflict flags; idempotency key |
| Merge decision | user or authorized project owner approves canon changes; overlapping or contradictory edits require review; no last-writer-wins for semantic decisions |
| Distribution | task-scoped subscriptions receive revision deltas and acknowledgement states, with periodic recovery snapshots |

Example: one chatbot outlines chapters, another maintains character canon, and a third researches setting. A proposed birth-date change is published against a base revision, checked for conflicting timeline facts, approved, then delivered to affected tasks. Each task acknowledges the new revision and proposes resulting changes to its own work. Retain prior revisions for rollback and attribution.

Important design questions for that phase: who can approve project intent, which data each task may see, how branch-specific alternatives remain isolated, when a model must pause for a conflict, how stale tasks catch up, and how deletion propagates through exports and replicas. Evaluate a single-project, two-chat manual merge before autonomous multi-client synchronization.

## Release boundary and validation

The source checkout began on `main` at `3445a41`, not the continuation pill's historical Phase A acceptance branch. Historical acceptance was not rerun or assumed to apply. Changes are on `codex/extension-context-pill`; unrelated untracked files were preserved. No staging target was supplied and no deployment, store publication, account linking, or live provider request was performed.

Local verification uses unit tests for format/limits/consent and a Playwright synthetic conversation for capture, input handling, races, navigation, iframe editing, and the pill UI. Release still needs the earlier Phase A staging gates plus unpacked-extension testing on Chrome and Edge: optional grant/denial/revocation, keyword input, worker restart, actual chatbot selectors, closed/native panels, streamed and virtualized chats, and attached-context acknowledgement against the authorized deployed server.
