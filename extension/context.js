const byId = (id) => document.getElementById(id);
const core = globalThis.ClariftContext;
const params = new URLSearchParams(location.search);
const tabId = params.has('tab') ? Number(params.get('tab')) : null;
let sourceTabUrl = null;
let captures = [];
let currentCapture = null;
let activeSource = null;
let captureGeneration = 0;
let historyJob = null;
let outputRevision = 0;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function status(text, error = false) { byId('status').textContent = text; byId('status').dataset.error = String(error); }
function report(error) { status(error.message || 'This action could not be completed.', true); }
function withRefinementTimeout(promise) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Clarift took too long to respond. Please try again.')), 50000);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
function updateSize() {
  const length = byId('pill-output').value.length;
  byId('pill-size').textContent = length ? `${length.toLocaleString()} characters. Token use depends on the destination model. Review the draft before sharing.` : 'Build a pill to begin.';
  byId('copy-pill').disabled = !length;
  byId('download-pill').disabled = !length;
}
function setCapture(capture) {
  currentCapture = capture;
  byId('source-preview').value = core.transcript(capture.messages);
  byId('source-status').textContent = `${capture.title} · ${capture.messages.length} captured turn(s). ${capture.warnings.join(' ')}`;
  byId('build-pill').disabled = !capture.messages.length;
  byId('download-transcript').disabled = !capture.messages.length;
  byId('attach-context').disabled = !activeSource;
  byId('clear-context').disabled = !activeSource;
  byId('collect-history').disabled = !activeSource || capture.mode === 'page' || !capture.messages.length || Boolean(historyJob);
}
function selectFrame() {
  const selected = captures.find((capture) => capture.frameId === Number(byId('source-frame').value));
  if (!selected) return;
  activeSource = { frameId: selected.frameId, pageKey: selected.capture.pageKey };
  setCapture(selected.capture);
}
async function checkSourceTab() {
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error('No accessible source tab. Paste a transcript below.');
  const tab = await chrome.tabs.get(tabId);
  const reportedUrl = tab.url || tab.pendingUrl;
  if (sourceTabUrl && reportedUrl && reportedUrl !== sourceTabUrl) throw new Error('The source tab changed conversations. Reopen Create context pill from that tab to capture it.');
  if (reportedUrl) sourceTabUrl = reportedUrl;
}
async function frameMessage(source, message) {
  const response = await chrome.tabs.sendMessage(tabId, { ...message, pageKey: source.pageKey }, { frameId: source.frameId });
  if (!response?.ok) throw new Error(response?.error || 'The source frame is unavailable. Reload it and reopen the context tool.');
  return response;
}
async function captureSource() {
  if (historyJob) return;
  const generation = ++captureGeneration;
  byId('capture').disabled = true;
  try {
    await checkSourceTab();
    const access = await globalThis.ClariftPageAccess.enable(tabId);
    if (activeSource && !access.frames.some((frame) => frame.frameId === activeSource.frameId && frame.pageKey === activeSource.pageKey)) throw new Error('The source frame changed conversations. Reopen this tool from the source tab.');
    const results = await Promise.allSettled(access.frames.map(async (frame) => ({ frameId: frame.frameId, ...(await frameMessage(frame, { type: 'clarift-capture', mode: byId('capture-mode').value })) })));
    await checkSourceTab();
    if (generation !== captureGeneration) return;
    captures = results.filter((result) => result.status === 'fulfilled' && result.value.capture).map((result) => ({ frameId: result.value.frameId, capture: result.value.capture }));
    if (!captures.length) throw new Error('No readable frame found. Paste a transcript below.');
    byId('source-frame').replaceChildren(...captures.map(({ frameId, capture }) => {
      const option = document.createElement('option'); option.value = String(frameId);
      option.textContent = `${frameId === 0 ? 'Main page' : `Frame ${frameId}`} · ${capture.provider} · ${capture.messages.length} turns`;
      return option;
    }));
    // Never merge independent frames or conversations without the user's choice.
    const populated = captures.filter((capture) => capture.capture.messages.length);
    byId('source-frame').value = String(populated.length === 1 ? populated[0].frameId : captures.find((capture) => capture.frameId === 0)?.frameId ?? captures[0].frameId);
    selectFrame();
    status(`Capture ready.${access.topOnly ? ' The browser limited access to some frames.' : ''}`);
    if (byId('auto-history').checked && currentCapture.mode === 'chat' && currentCapture.messages.length) await collectHistory();
    else if (!byId('pill-output').value) buildPill();
  } catch (error) {
    activeSource = null;
    byId('attach-context').disabled = true;
    byId('clear-context').disabled = true;
    byId('source-status').textContent = error.message;
    report(error);
  } finally { byId('capture').disabled = false; }
}

async function collectHistory() {
  if (historyJob || !activeSource) return;
  const source = { ...activeSource };
  const revision = outputRevision;
  const hadDraft = Boolean(byId('pill-output').value);
  historyJob = { id: null, source, stopRequested: false };
  for (const id of ['capture', 'collect-history', 'source-frame', 'capture-mode', 'use-transcript', 'transcript-file']) byId(id).disabled = true;
  byId('stop-history').hidden = false;
  let jobId;
  try {
    await checkSourceTab();
    const started = await frameMessage(source, { type: 'clarift-history-start' });
    jobId = started.id;
    historyJob.id = jobId;
    if (historyJob.stopRequested) await frameMessage(source, { type: 'clarift-history-cancel', id: jobId });
    const deadline = Date.now() + 210000;
    while (true) {
      const progress = await frameMessage(source, { type: 'clarift-history-progress', id: jobId });
      byId('history-status').textContent = `${progress.count.toLocaleString()} messages · ${progress.characters.toLocaleString()} characters · ${progress.phase} · ${progress.steps} scroll steps`;
      if (progress.status !== 'running') {
        if (progress.error) throw new Error(progress.error);
        currentCapture = progress.capture;
        const selected = captures.find((capture) => capture.frameId === source.frameId);
        if (selected) selected.capture = currentCapture;
        setCapture(currentCapture);
        if (!hadDraft && outputRevision === revision) buildPill();
        status(progress.status === 'complete' ? 'History scan finished. Review coverage and copy the draft pill.' : 'Collection stopped. The messages collected so far are available; review coverage before sharing.');
        break;
      }
      if (Date.now() > deadline) throw new Error('The source stopped responding to the scan. Try again while keeping the source tab open.');
      await delay(600);
    }
  } catch (error) {
    if (jobId) await frameMessage(source, { type: 'clarift-history-cancel', id: jobId }).catch(() => {});
    report(error);
  } finally {
    historyJob = null;
    for (const id of ['capture', 'source-frame', 'capture-mode', 'use-transcript', 'transcript-file']) byId(id).disabled = false;
    byId('collect-history').disabled = !activeSource || !currentCapture?.messages.length || currentCapture.mode === 'page';
    byId('stop-history').hidden = true;
  }
}
function buildPill() {
  if (!currentCapture?.messages.length) return;
  byId('pill-output').value = core.buildPill(currentCapture, {
    goal: byId('goal').value, decisions: byId('decisions').value,
    constraints: byId('constraints').value, next: byId('next').value,
    full: byId('pill-mode').value === 'full', budget: Number(byId('budget').value), includeUrl: byId('include-url').checked
  });
  updateSize();
  outputRevision += 1;
  status('Draft built locally. Review and edit it, then copy it into your next chat.');
}
async function copy(id) {
  const value = byId(id).value;
  if (!value.trim()) throw new Error('There is no text to copy yet.');
  await navigator.clipboard.writeText(value);
  status('Copied. Paste into your chosen chat or search field.');
}
function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status('Download prepared.');
}
async function attachContext(clear = false) {
  if (!activeSource) throw new Error('Capture an accessible source page first.');
  await checkSourceTab();
  const text = clear ? '' : byId('refinement-context').value.trim();
  if (!clear && !text) throw new Error('Enter the reviewed context to attach.');
  const response = await chrome.tabs.sendMessage(tabId, { type: 'clarift-set-context', text, pageKey: activeSource.pageKey }, { frameId: activeSource.frameId });
  if (!response?.ok) throw new Error(response?.error || 'The source page could not accept context.');
  status(clear ? 'Attached context cleared from the source frame.' : 'Context attached. Later refinements in this source frame will send it to Clarift.');
}

byId('capture').addEventListener('click', captureSource);
byId('collect-history').addEventListener('click', collectHistory);
byId('stop-history').addEventListener('click', () => {
  if (historyJob) {
    historyJob.stopRequested = true;
    if (historyJob.id) frameMessage(historyJob.source, { type: 'clarift-history-cancel', id: historyJob.id }).catch(report);
  }
});
window.addEventListener('pagehide', () => {
  if (historyJob) chrome.tabs.sendMessage(tabId, { type: 'clarift-history-cancel', id: historyJob.id, pageKey: historyJob.source.pageKey }, { frameId: historyJob.source.frameId }).catch(() => {});
});
byId('source-frame').addEventListener('change', selectFrame);
byId('build-pill').addEventListener('click', buildPill);
byId('pill-output').addEventListener('input', () => { outputRevision += 1; updateSize(); });
byId('copy-pill').addEventListener('click', () => { copy('pill-output').catch(report); });
byId('download-pill').addEventListener('click', () => download(byId('pill-output').value, 'clarift-context-pill.md'));
byId('download-transcript').addEventListener('click', () => {
  if (currentCapture) download(core.buildPill(currentCapture, { full: true, includeUrl: byId('include-url').checked }), 'clarift-captured-transcript.md');
});
byId('attach-context').addEventListener('click', () => { attachContext().catch(report); });
byId('clear-context').addEventListener('click', () => { attachContext(true).catch(report); });
byId('use-transcript').addEventListener('click', () => {
  const text = byId('manual-transcript').value.trim();
  if (!text) { status('Paste a transcript first.', true); return; }
  if (text.length > core.MAX_CAPTURE_CHARACTERS) { status('Split this transcript into sections of at most 500,000 characters.', true); return; }
  captureGeneration += 1;
  setCapture({ title: 'Pasted conversation', provider: 'manual import', capturedAt: new Date().toISOString(), messages: [{ role: 'transcript', text }], warnings: ['Pasted text is user-provided; speaker labels and completeness have not been verified. Compact mode shortens this text without interpreting its speaker labels.'] });
  status('Using your pasted transcript. Add your notes and build the pill.');
  if (!byId('pill-output').value) buildPill();
});
byId('transcript-file').addEventListener('change', async () => {
  try {
    const file = byId('transcript-file').files[0];
    if (!file) return;
    if (file.size > core.MAX_CAPTURE_CHARACTERS * 4) throw new Error('The export is too large. Use a text section of at most 500,000 characters.');
    const text = await file.text();
    if (text.length > core.MAX_CAPTURE_CHARACTERS) throw new Error('The export exceeds 500,000 characters. Split it into sections.');
    byId('manual-transcript').value = text;
    byId('use-transcript').click();
  } catch (error) { report(error); }
});
byId('handoff-request').value = core.handoffRequest;
byId('copy-handoff').addEventListener('click', () => {
  navigator.clipboard.writeText(byId('handoff-request').value).then(() => status('Copied. Paste and submit it once in the source chat, then transfer the resulting context pill.')).catch(report);
});
byId('copy-search').addEventListener('click', () => { copy('search-prompt').catch(report); });
byId('refine-search').addEventListener('click', async () => {
  const original = byId('search-prompt').value;
  byId('refine-search').disabled = true;
  try {
    const response = await withRefinementTimeout(chrome.runtime.sendMessage({ type: 'clarift-refine', prompt: original }));
    if (!response?.ok) throw new Error(response?.error || 'Refinement failed.');
    if (byId('search-prompt').value !== original) throw new Error('Your prompt changed while refining. Current text was preserved; try again.');
    byId('search-prompt').value = response.refinedPrompt;
    status(response.qualityTier === 'fallback' ? 'Refined in Basic mode. Review and copy your prompt.' : 'Prompt refined. Review and copy it.');
  } catch (error) { report(error); }
  finally { byId('refine-search').disabled = false; }
});

async function initialize() {
  const draft = params.get('draft');
  if (draft && /^[0-9a-f-]{36}$/i.test(draft)) {
    const key = `omnibox:${draft}`;
    const stored = await chrome.storage.session.get(key);
    await chrome.storage.session.remove(key);
    byId('search-section').hidden = false;
    byId('search-prompt').value = stored[key] || '';
    byId('source-status').textContent = 'To build a pill, paste a transcript or open this tool from a web chat.';
    byId('capture').disabled = true;
  } else if (params.has('compose')) {
    byId('search-section').hidden = false;
    byId('source-status').textContent = 'Paste a prompt above to refine it, or use the whole-chat handoff request.';
    byId('capture').disabled = true;
  } else if (params.has('blocked')) {
    byId('source-status').textContent = 'The browser blocked page capture. Use Copy whole-chat handoff request above, or import an exported transcript. You can retry capture below.';
  } else if (tabId !== null) await captureSource();
  else { byId('source-status').textContent = 'No source page is accessible. Paste a transcript to build a pill.'; byId('capture').disabled = true; }
}
initialize().catch(report);
