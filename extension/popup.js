const enableButton = document.querySelector('#enable-page');
const settingsButton = document.querySelector('#open-settings');
const configurationStatus = document.querySelector('#configuration-status');
const pageStatus = document.querySelector('#page-status');
const allSitesButton = document.querySelector('#enable-all');
const contextButton = document.querySelector('#context-pill');
const ALL_SITES = { origins: ['http://*/*', 'https://*/*'] };
let allSitesEnabled = false;

function setPageStatus(message, error = false) {
  pageStatus.textContent = message;
  pageStatus.dataset.error = error ? 'true' : 'false';
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
function activationError(error) {
  if (/policy|cannot access|cannot be scripted|chrome:\/\//i.test(error.message || '')) {
    return `The browser blocked inline access: ${error.message} Use Refine text or Copy whole-chat handoff request below. Website access cannot override a browser policy.`;
  }
  return error.message || 'Page tools did not respond. Reload the page and try again.';
}
async function initialize() {
  allSitesEnabled = await chrome.permissions.contains(ALL_SITES);
  allSitesButton.textContent = allSitesEnabled ? 'Turn off access to all websites' : 'Always enable on all websites';
  const [persistent, session] = await Promise.all([
    chrome.storage.local.get({ refreshToken: '' }), chrome.storage.session.get({ accessToken: '' })
  ]);
  configurationStatus.textContent = session.accessToken || persistent.refreshToken ? 'Ready to refine prompts' : 'Connect your Clarift account';
  document.querySelector('#extension-version').textContent = `v${chrome.runtime.getManifest().version}`;
  const tab = await activeTab();
  if (!Number.isInteger(tab?.id)) { setPageStatus('Choose a source tab, or use the text and handoff tools below.'); return; }
  // Comet can expose chrome://newtab here while displaying an HTTPS document.
  // Probe permitted frames; URL metadata alone is not a capability check.
  const frames = await globalThis.ClariftPageAccess.discover(tab.id);
  enableButton.textContent = frames.length ? 'Refresh page tools' : 'Enable on this page';
  setPageStatus(frames.length ? `Tools are active in ${frames.length} frame(s). Focus a text field or collect chat history.` : 'Click Enable to check this page. Comet’s built-in page may restrict inline tools; the tools below remain available.');
}
enableButton.addEventListener('click', async () => {
  enableButton.disabled = true;
  try {
    const tab = await activeTab();
    if (!Number.isInteger(tab?.id)) throw new Error('Select a page first.');
    setPageStatus('Checking page and embedded frames…');
    const result = await globalThis.ClariftPageAccess.enable(tab.id);
    enableButton.textContent = 'Refresh page tools';
    setPageStatus(`Tools are active in ${result.frames.length} frame(s). Focus a text field or search box.`);
  } catch (error) {
    enableButton.textContent = 'Retry page activation';
    setPageStatus(activationError(error), true);
  } finally { enableButton.disabled = false; }
});
allSitesButton.addEventListener('click', async () => {
  try {
    if (allSitesEnabled) await chrome.permissions.remove(ALL_SITES);
    else if (!await chrome.permissions.request(ALL_SITES)) { setPageStatus('Website access was not granted. Enable on this page remains available.'); return; }
    await initialize();
    setPageStatus(allSitesEnabled ? 'Enabled for future page loads. Reload open pages or use Enable on this page. Browser policies still apply.' : 'Broad website access removed. Reload open pages to remove existing tools; built-in chatbot support remains.');
  } catch (error) { setPageStatus(error.message || 'Could not change website access.', true); }
});
contextButton.addEventListener('click', async () => {
  try {
    const tab = await activeTab();
    let blocked = false;
    try { if (Number.isInteger(tab?.id)) await globalThis.ClariftPageAccess.enable(tab.id); }
    catch { blocked = true; }
    const query = new URLSearchParams();
    if (Number.isInteger(tab?.id)) query.set('tab', String(tab.id));
    if (blocked) query.set('blocked', '1');
    await chrome.tabs.create({ url: chrome.runtime.getURL(`context.html?${query}`) });
  } catch (error) { setPageStatus(error.message || 'Could not open context tools.', true); }
});
document.querySelector('#refine-text').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('context.html?compose=1') }));
document.querySelector('#copy-handoff').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(globalThis.ClariftContext.handoffRequest);
    setPageStatus('Copied. Paste this once into the source chat and submit it. That chatbot will summarize the conversation available to it; copy its resulting pill into your next chat.');
  } catch (error) { setPageStatus(error.message || 'Could not copy the handoff request.', true); }
});
settingsButton.addEventListener('click', () => chrome.runtime.openOptionsPage());
initialize().catch((error) => setPageStatus(error.message || 'Could not inspect this page.', true));
