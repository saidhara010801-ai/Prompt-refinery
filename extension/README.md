# Clarift browser extension

This Manifest V3 extension supports Chrome and Microsoft Edge. It adds an inline **Refine with Clarift** action to prompt editors on ChatGPT, Gemini, and Claude.

## Load for local testing

1. Create a Clarift API key under Clarift Settings > Public API.
2. Open `chrome://extensions` or `edge://extensions` and enable Developer mode.
3. Choose **Load unpacked** and select this `extension` directory.
4. Open the extension settings and enter the Clarift key plus a Gemini or OpenRouter provider key.

The extension stores both keys in browser sync storage. Clarift never persists the provider key; it is forwarded only for the active refinement request.
