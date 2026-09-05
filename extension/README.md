# Clarift browser extension

Version 2.3.1 adds automatic chat-history collection, whole-chat handoff requests, and a standalone text editor to the local context-pill workflow. ChatGPT, Claude, Gemini, Copilot, Perplexity, Poe, Grok, and Google AI Studio have built-in activation where the browser permits it. Other HTTP(S) pages can be activated with **Enable on this page** or optional **Always enable on all websites**.

Refinement uses Clarift managed inference and never requires a provider key. Short-lived access tokens remain in Chrome session storage; the rotating device refresh token is revocable from Clarift. Local capture, pill creation, and export need no account and do not send transcripts to Clarift. Scrolling may cause the source website to load earlier messages through its normal history requests.

## Load for testing

1. Download the extension package from Clarift Settings > Extension and extract it.
2. Open `chrome://extensions` or `edge://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Select the extracted folder containing `manifest.json`.
4. Open the extension settings and choose **Connect Clarift Account**.
5. Approve the connection in the Clarift tab. The extension receives a revocable device session tied to the personal workspace.
6. Focus a text input, search box, textarea, or editable rich-text region. Open shadow roots and permitted embedded frames are supported. Password, email, disabled/read-only inputs, and non-editable ARIA textboxes are excluded.

Access tokens are short-lived and automatically refreshed. Signing out revokes the installation and removes its local session tokens.

## Search bars and website access

- **In-page search / AI search:** click **Enable on this page**, then focus the field. This uses temporary `activeTab` access. Sites with custom editors may need compatibility work.
- **All websites:** the separate button requests optional HTTP(S) access and registers scripts for later page loads. Enable the current page or reload existing tabs. Turn it off from the same button; reload to remove already-injected tools. Built-in chatbot activation remains.
- **Native address bar:** type `clarift`, press Tab or Space, enter a prompt, and press Enter. A new local extension tab opens with the prompt. Click **Refine prompt**, review, and copy it into your chosen search/chat. This does not intercept ordinary address-bar typing or automatically submit queries. Draft text is handed off through session storage and consumed on opening, not put in the URL.
- Browser-internal pages, browser stores, native side panels, closed shadow roots, and unpermitted cross-origin frames cannot be universally accessed. Open the chatbot as a normal web tab or paste a transcript when needed.

### Refine copied text and prepare a whole-chat handoff

- **Refine text** opens the extension's own editor. Paste your prompt, refine it, then copy it into your chosen search or chat.
- **Copy whole-chat handoff request** copies a prepared request. Paste it once into the source conversation and submit it. That chatbot summarizes earlier turns available to it into a continuation pill, which you can copy to the destination chatbot. This avoids repeated screenshot/scroll capture and uses the source model's conversation context. Clarift does not submit the request or verify the resulting summary automatically. The request asks the model to disclose inaccessible history and preserve decisions, corrections, story canon, and next steps.

You can save the handoff request as a Comet shortcut: type `/`, select **Create a shortcut**, and save the request as a context-pill shortcut. Comet documents shortcuts across the search bar, sidecar, and new-tab inputs. See the [official shortcut guide](https://www.perplexity.ai/help-center/en/articles/11897890-comet-shortcuts).

## Create a portable context pill

1. Open the conversation; wait for responses to finish streaming.
2. In the extension popup, choose **Create context pill**. This pins the source tab, so activating the pill editor does not switch capture to a different page.
3. **Collect chat history automatically** is on by default. Clarift scrolls backward and forward through the chat, keeps messages across virtualized windows, then restores the starting scroll offset. Progress shows messages, characters, and scroll steps. **Stop collection**, scrolling the source yourself, or closing the context tab cancels the scan; a partial result remains when possible. The scan stops after 3 minutes / 400 steps, 500,000 characters, or 2,000 turns. It cannot force a site to load inaccessible history, switch branches, or bypass browser policy.
4. Review **Chat messages**. Recognition uses DOM heuristics and is not guaranteed for every chatbot version. Select a source frame for embedded chat, use **Page text** if recognition fails, or paste/import a text or Markdown export. A new pill draft is built automatically after collection; existing draft edits are preserved. Uncheck automatic collection for a quick loaded-text snapshot.
5. Add the project goal, confirmed decisions, constraints, and next action. These notes distinguish user decisions from chatbot suggestions.
6. Build **Compact excerpts** (4,000 / 10,000 / 24,000 characters of conversation extracts) or **All captured text**. Compact mode is local extractive shortening, not an AI semantic summary. Notes and metadata are additional to the excerpt budget. Use the whole-chat handoff request for a source-model summary.
7. Edit the draft, then **Copy context pill** or **Download Markdown**. Paste it into another chat. Download the full captured transcript as a separate reference for details that do not fit the pill.

Capture is bounded to 500,000 characters / 2,000 recognized messages per frame. Coverage warnings accompany the exported pill. Repeated identical messages remain separate. Hidden branches, unloaded turns, non-text attachments, and native browser panels are not recovered. Pasted transcripts remain a single labelled block; compact mode may omit their middle, so use full mode or add essential facts to the notes. Never claim a complete original chat solely from a DOM capture.

Source URLs are off by default; enabling them includes origin and path but strips query and fragment. The path/title may still identify a private chat. Nothing is automatically saved or shared; copy/download before closing the editor.

## Use context in future refinements

In the pill editor, expand **Use reviewed context for refinements on the source page**. Enter up to 5,600 characters and choose **Attach reviewed context**. This explicitly authorizes sending that text alongside subsequent refinements in the selected frame. It is held in page memory and cleared on reload, conversation navigation, or **Clear attached context**. It is a fixed snapshot: update it yourself as the conversation evolves. Capture itself does not automatically transmit chat history.

The server changes in this version are required for attached context. The extension checks `contextApplied` and reports an older server instead of silently claiming context was used. Ordinary refinement and local pills still work without the new server capability. Refinement remains subject to existing account, credit, and provider limits. This is a manually loaded test build, distributed through Clarift Settings > Extension.

Research, future automatic memory, and shared-project versioning: [design note](../docs/extension-context-design.md).

## Verify

- `npm test`: regression and context schema/format/boundary tests.
- `npm run test:extension:browser`: synthetic headless browser tests. Requires Playwright and a Chromium binary. Set `CLARIFT_PLAYWRIGHT_MODULE` to a local Playwright module and `CLARIFT_CHROMIUM_EXECUTABLE` to a local browser binary if not installed in the project. The test uses no accounts and writes screenshots to `tmp/extension-context/`.
- Manually load the unpacked extension for Chrome/Edge permission prompts, address-bar keyword, actual chatbot DOM compatibility, streaming/virtualized history, and deployed-server acceptance before release. The browser fixture checks are not a substitute for those live checks.
- Set `CLARIFT_EXTENSION_EXECUTABLE` to a compatible browser binary and `CLARIFT_FIXTURE_PORT=9002` to also run real unpacked-extension messaging, automatic capture, draft, and copy checks in a temporary profile with a local synthetic chat. Port 9002 must be free; it is already permitted by the development manifest. This was exercised in Comet; no personal browsing profile is used.
- `node scripts/package-extension.mjs --sync-unpacked` also refreshes the existing `public/downloads/clarift-browser-extension` test copy, replacing only files that still match the previous ZIP. User-modified and unrelated files are preserved. Reload the extension and source pages after updating.
