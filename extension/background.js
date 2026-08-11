const DEFAULT_API_BASE = 'https://clarift--clarift-e4f6f.us-east4.hosted.app';
const REQUEST_TIMEOUT_MS = 105000;

async function readResponsePayload(response) {
  const responseText = await response.text();
  if (!responseText) return {};
  try {
    return JSON.parse(responseText);
  } catch {
    return {};
  }
}

function responseErrorMessage(response, payload) {
  if (typeof payload?.error?.message === 'string' && payload.error.message.trim()) {
    return payload.error.message;
  }
  if (response.status === 401 || response.status === 403) {
    return 'Clarift rejected an API key. Check the Clarift and provider keys in extension settings.';
  }
  if (response.status === 429) {
    return 'Clarift rate limit reached. Wait briefly and try again.';
  }
  return 'Clarift could not refine this prompt. Check extension settings and try again.';
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'clarift-refine') return false;

  chrome.storage.sync.get({
    apiBase: DEFAULT_API_BASE,
    clariftApiKey: '',
    provider: 'gemini',
    providerApiKey: '',
    technique: 'Zero-shot'
  }).then(async (settings) => {
    if (!settings.clariftApiKey || !settings.providerApiKey) {
      throw new Error('Open Clarift extension settings and add both API keys.');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    let payload;
    try {
      response = await fetch(`${String(settings.apiBase).replace(/\/$/, '')}/api/v1/refinements`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${settings.clariftApiKey}`,
          'Content-Type': 'application/json',
          'X-AI-Provider': settings.provider,
          'X-Provider-API-Key': settings.providerApiKey,
          'X-Clarift-Client': 'extension'
        },
        body: JSON.stringify({ prompt: message.prompt, technique: settings.technique }),
        signal: controller.signal
      });
      payload = await readResponsePayload(response);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Clarift took too long to respond. Please try again.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(responseErrorMessage(response, payload));
    if (typeof payload.refinedPrompt !== 'string' || !payload.refinedPrompt.trim()) {
      throw new Error('Clarift returned an incomplete refinement. Please try again.');
    }
    sendResponse({ ok: true, refinedPrompt: payload.refinedPrompt });
  }).catch((error) => sendResponse({ ok: false, error: error.message || 'Clarift request failed.' }));

  return true;
});
