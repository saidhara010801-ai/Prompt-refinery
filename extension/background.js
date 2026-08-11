const DEFAULT_API_BASE = 'https://clarift--clarift-e4f6f.us-east4.hosted.app';

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

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
    const response = await fetch(`${String(settings.apiBase).replace(/\/$/, '')}/api/v1/refinements`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.clariftApiKey}`,
        'Content-Type': 'application/json',
        'X-AI-Provider': settings.provider,
        'X-Provider-API-Key': settings.providerApiKey,
        'X-Clarift-Client': 'extension'
      },
      body: JSON.stringify({ prompt: message.prompt, technique: settings.technique })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || 'Clarift could not refine this prompt.');
    sendResponse({ ok: true, refinedPrompt: payload.refinedPrompt });
  }).catch((error) => sendResponse({ ok: false, error: error.message || 'Clarift request failed.' }));

  return true;
});
