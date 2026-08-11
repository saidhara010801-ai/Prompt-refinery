# Clarift browser extension

This Manifest V3 extension supports Chrome and Microsoft Edge. It adds an inline **Refine with Clarift** action to prompt editors on ChatGPT, Claude, Gemini, Copilot, Perplexity, Poe, Grok, and Google AI Studio. On another chatbot site, click the Clarift toolbar icon and choose **Enable on this page**.

## Load for local testing

1. Download the extension test package from Clarift Settings > Browser Extension and extract it.
2. Create a Clarift API key under Clarift Settings > Public API.
3. Open `chrome://extensions` or `edge://extensions` and enable Developer mode.
4. Choose **Load unpacked** and select the extracted folder containing `manifest.json`.
5. Pin Clarift in the browser toolbar, open its settings, and enter the Clarift key plus a Gemini or OpenRouter provider key.
6. Open a supported chatbot and focus its prompt editor. On another chatbot, click the Clarift toolbar icon and enable it for the current page.

The extension stores both keys in browser sync storage. Clarift never persists the provider key; it is forwarded only for the active refinement request.
