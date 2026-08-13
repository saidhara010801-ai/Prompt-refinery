const enableButton = document.querySelector('#enable-page');
const settingsButton = document.querySelector('#open-settings');
const configurationStatus = document.querySelector('#configuration-status');
const pageStatus = document.querySelector('#page-status');

function setPageStatus(message, error = false) {
  pageStatus.textContent = message;
  pageStatus.dataset.error = error ? 'true' : 'false';
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function contentScriptIsReady(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'clarift-ping' });
    return response?.ready === true;
  } catch {
    return false;
  }
}

async function initialize() {
  const [persistent, session] = await Promise.all([
    chrome.storage.local.get({ refreshToken: '' }),
    chrome.storage.session.get({ accessToken: '' })
  ]);
  configurationStatus.textContent = session.accessToken || persistent.refreshToken
    ? 'Ready to refine prompts'
    : 'Connect your Clarift account';

  const tab = await activeTab();
  if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) {
    enableButton.disabled = true;
    setPageStatus('Open a web chatbot to use Clarift.');
    return;
  }

  if (await contentScriptIsReady(tab.id)) {
    enableButton.disabled = true;
    enableButton.textContent = 'Enabled on this page';
    setPageStatus('Focus the prompt editor to show the Refine button.');
  }
}

enableButton.addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab?.id) return;
  enableButton.disabled = true;
  setPageStatus('Enabling Clarift...');
  try {
    if (!await contentScriptIsReady(tab.id)) {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    }
    enableButton.textContent = 'Enabled on this page';
    setPageStatus('Focus the prompt editor to show the Refine button.');
  } catch (error) {
    enableButton.disabled = false;
    setPageStatus(error.message || 'Clarift cannot run on this page.', true);
  }
});

settingsButton.addEventListener('click', () => chrome.runtime.openOptionsPage());

initialize().catch((error) => setPageStatus(error.message || 'Could not inspect this page.', true));
