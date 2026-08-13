# Clarift browser extension

This Manifest V3 extension adds **Refine with Clarift** to ChatGPT, Claude, Gemini, Copilot, Perplexity, Poe, Grok, and Google AI Studio. It uses Clarift managed inference and never asks for, stores, or transmits a Gemini or OpenRouter provider key. Short-lived access tokens remain in Chrome session storage; the rotating device refresh token is revocable from Clarift.

## Load for testing

1. Download the extension package from Clarift Settings > Extension and extract it.
2. Open `chrome://extensions` or `edge://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Select the extracted folder containing `manifest.json`.
4. Open the extension settings and choose **Connect Clarift Account**.
5. Approve the connection in the Clarift tab. The extension receives a revocable device session tied to the personal workspace.
6. Open a supported chatbot and focus its prompt editor. Use the toolbar action to enable Clarift on another compatible site.

Access tokens are short-lived and automatically refreshed. Signing out revokes the installation and removes its local session tokens.
