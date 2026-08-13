const DEFAULT_API_BASE = 'https://clarift--clarift-e4f6f.us-east4.hosted.app';
const REQUEST_TIMEOUT_MS = 105000;

async function settings() {
  const [persistent, session] = await Promise.all([chrome.storage.local.get({
    apiBase: DEFAULT_API_BASE,
    refreshToken: '',
    technique: 'Zero-shot',
    mode: 'quick_refine'
  }), chrome.storage.session.get({ accessToken: '' })]);
  return { ...persistent, ...session };
}

async function payload(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

async function refreshSession(current) {
  if (!current.refreshToken) throw new Error('Reconnect the extension to your Clarift account.');
  const response = await fetch(`${String(current.apiBase).replace(/\/$/, '')}/api/extension/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: current.refreshToken })
  });
  const result = await payload(response);
  if (!response.ok || !result.accessToken || !result.refreshToken) {
    await Promise.all([chrome.storage.session.remove('accessToken'), chrome.storage.local.remove(['refreshToken', 'deviceId'])]);
    throw new Error(result?.error?.message || 'Reconnect the extension to your Clarift account.');
  }
  await Promise.all([
    chrome.storage.session.set({ accessToken: result.accessToken }),
    chrome.storage.local.set({ refreshToken: result.refreshToken, deviceId: result.deviceId })
  ]);
  return { ...current, ...result };
}

async function refine(current, prompt, retry = true) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${String(current.apiBase).replace(/\/$/, '')}/api/extension/refine`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${current.accessToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify({ prompt, technique: current.technique, mode: current.mode }),
      signal: controller.signal
    });
    if (response.status === 401 && retry) return refine(await refreshSession(current), prompt, false);
    const result = await payload(response);
    if (!response.ok) {
      if (response.status === 402) throw new Error('Your Clarift workspace needs more managed credits.');
      if (response.status === 429) throw new Error('Clarift is busy. Wait briefly and try again.');
      throw new Error(result?.error?.message || 'Clarift could not refine this prompt.');
    }
    if (typeof result.refinedPrompt !== 'string' || !result.refinedPrompt.trim()) throw new Error('Clarift returned an incomplete refinement.');
    return { refinedPrompt: result.refinedPrompt, provider: result.provider || 'managed' };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Clarift took too long to respond. Please try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await Promise.all([chrome.storage.sync.clear(), chrome.storage.session.clear()]);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'clarift-refine') return false;
  settings().then(async (current) => {
    if (!current.accessToken && current.refreshToken) current = await refreshSession(current);
    if (!current.accessToken) throw new Error('Open Clarift extension settings and connect your account.');
    const result = await refine(current, message.prompt);
    sendResponse({ ok: true, ...result });
  }).catch((error) => sendResponse({ ok: false, error: error.message || 'Clarift request failed.' }));
  return true;
});
