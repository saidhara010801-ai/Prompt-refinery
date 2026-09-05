# Clarift browser extension v2.3.1

Download the latest test build from **Settings > Extension** at [Clarift](https://clarift.dpdns.org). The app shows the extension version beside the download and uses a versioned link. The existing download URL also revalidates its contents.

## New capabilities

- **Refine in more places:** text and search inputs, textareas, rich text editors, and permitted embedded editors. Activate a page when needed or opt into website access. Use the `clarift` address-bar keyword or **Refine text** to open the extension editor with your draft.
- **Collect chat history automatically:** scroll through the current conversation, retain older messages as they load, track progress, stop when needed, and restore the original scroll position. Coverage reflects the text the page makes available.
- **Create a portable context pill:** combine captured text with your goal, confirmed decisions, constraints, and next action. Review and edit the draft, choose compact excerpts or all captured text, then copy it into a new conversation or another chatbot.
- **Import and export:** import text or Markdown transcripts, download the context pill as Markdown, and keep the full captured transcript as a separate reference.
- **Ask the source chatbot for a handoff summary:** **Copy whole-chat handoff request** prepares a request to paste into your current conversation. The source chatbot summarizes the context available to it; review its answer before carrying it into the next chat.
- **Keep future refinements relevant:** explicitly attach reviewed context to refinements on the source page. Update or clear that context as your project changes.

Local capture, pill editing, and export need no account. Refinement uses your linked Clarift account. Capture stays local until you choose to copy, export, or attach reviewed text to a refinement.

## Update an existing installation

1. Download the ZIP from Settings > Extension and extract it into the folder originally loaded in your browser.
2. Open the browser's Extensions page and click **Reload** for Clarift.
3. Reload your chat tabs. The extension popup should display **v2.3.1**.

For a new installation, enable Developer mode and choose **Load unpacked**, then select the extracted folder containing `manifest.json`.

See the [extension guide](../extension/README.md) for detailed workflows and the [context design note](extension-context-design.md) for future shared-project memory.
