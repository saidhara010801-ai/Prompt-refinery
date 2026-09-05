const DEFAULT_API_BASE = 'https://clarift--clarift-e4f6f.us-east4.hosted.app';
const REQUEST_TIMEOUT_MS = 45000;
const frameDiscoveries = new Map();

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

async function refine(current, prompt, context, retry = true) {
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
      body: JSON.stringify({ prompt, technique: current.technique, mode: current.mode, ...(context ? { context } : {}) }),
      signal: controller.signal
    });
    if (response.status === 401 && retry) return refine(await refreshSession(current), prompt, context, false);
    const result = await payload(response);
    if (!response.ok) {
      if (response.status === 402) throw new Error('Your Clarift workspace needs more managed credits.');
      if (response.status === 429) throw new Error('Clarift is busy. Wait briefly and try again.');
      throw new Error(result?.error?.message || 'Clarift could not refine this prompt.');
    }
    if (typeof result.refinedPrompt !== 'string' || !result.refinedPrompt.trim()) throw new Error('Clarift returned an incomplete refinement.');
    if (context && result.contextApplied !== true) throw new Error('This Clarift server does not support attached chat context yet. Clear attached context or update the server.');
    return {
      refinedPrompt: result.refinedPrompt,
      qualityTier: result.qualityTier || (result.provider === 'local' ? 'fallback' : 'generative'),
      basicMode: result.basicMode || null
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Clarift took too long to respond. Please try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await Promise.all([chrome.storage.sync.clear(), chrome.storage.session.clear()]);
  await syncSiteAccess();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'clarift-discovered') {
    const pending = frameDiscoveries.get(message.requestId);
    if (pending && _sender.tab?.id === pending.tabId && Number.isInteger(_sender.frameId)) {
      pending.frames.set(_sender.frameId, { frameId: _sender.frameId, pageKey: message.pageKey, title: message.title });
    }
    sendResponse({ ok: true }); return false;
  }
  if (message?.type === 'clarift-discover-tab') {
    if (!Number.isInteger(message.tabId)) { sendResponse({ frames: [] }); return false; }
    const requestId = crypto.randomUUID();
    const pending = { tabId: message.tabId, frames: new Map() };
    frameDiscoveries.set(requestId, pending);
    chrome.tabs.sendMessage(message.tabId, { type: 'clarift-discover', requestId }).catch(() => {});
    setTimeout(() => {
      frameDiscoveries.delete(requestId);
      sendResponse({ frames: [...pending.frames.values()].sort((a, b) => a.frameId - b.frameId) });
    }, 350);
    return true;
  }
  if (message?.type !== 'clarift-refine') return false;
  settings().then(async (current) => {
    if (typeof message.prompt !== 'string' || !message.prompt.trim() || message.prompt.length > 50000) throw new Error('Enter a prompt of 1 to 50,000 characters.');
    if (message.context && (message.context.consent !== true || typeof message.context.text !== 'string' || message.context.text.length > 5600)) throw new Error('Review the context before using it with Clarift.');
    if (!current.accessToken && current.refreshToken) current = await refreshSession(current);
    if (!current.accessToken) throw new Error('Open Clarift extension settings and connect your account.');
    const result = await refine(current, message.prompt, message.context);
    sendResponse({ ok: true, ...result });
  }).catch((error) => sendResponse({ ok: false, error: error.message || 'Clarift request failed.' }));
  return true;
});

// Broad access is optional and requested by the popup only after a user click.
const ALL_SITES = { origins: ['http://*/*', 'https://*/*'] };
let accessSync = Promise.resolve();
function syncSiteAccess() {
  accessSync = accessSync.catch(() => {}).then(async () => {
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: ['clarift-all-sites'] });
    const allowed = await chrome.permissions.contains(ALL_SITES);
    if (!allowed && registered.length) await chrome.scripting.unregisterContentScripts({ ids: ['clarift-all-sites'] });
    const registration = {
      id: 'clarift-all-sites', matches: ALL_SITES.origins,
      js: ['context-core.js', 'context-capture.js', 'context-history.js', 'content.js'], css: ['content.css'],
      runAt: 'document_idle', allFrames: true, matchOriginAsFallback: true, persistAcrossSessions: true
    };
    if (allowed && !registered.length) await chrome.scripting.registerContentScripts([registration]);
    if (allowed && registered.length) await chrome.scripting.updateContentScripts([registration]);
  });
  return accessSync;
}
chrome.permissions.onAdded.addListener(() => { syncSiteAccess().catch(() => {}); });
chrome.permissions.onRemoved.addListener(() => { syncSiteAccess().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { syncSiteAccess().catch(() => {}); });

chrome.omnibox.onInputStarted.addListener(() => {
  chrome.omnibox.setDefaultSuggestion({ description: 'Open Clarift to refine this prompt, then copy it to your preferred search or chatbot' });
});
chrome.omnibox.onInputEntered.addListener(async (text) => {
  // Keep prompt text out of URLs and browser history. Consume the session draft once.
  const draftId = crypto.randomUUID();
  await chrome.storage.session.set({ [`omnibox:${draftId}`]: text.slice(0, 50000) });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`context.html?draft=${draftId}`) });
});
