const defaults = {
  apiBase: 'https://clarift--clarift-e4f6f.us-east4.hosted.app',
  clariftApiKey: '',
  provider: 'gemini',
  providerApiKey: '',
  technique: 'Zero-shot'
};

const form = document.querySelector('#settings-form');
const status = document.querySelector('#status');

chrome.storage.sync.get(defaults).then((settings) => {
  Object.entries(settings).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value;
  });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form).entries());
  values.apiBase = String(values.apiBase).replace(/\/$/, '');
  await chrome.storage.sync.set(values);
  status.textContent = 'Settings saved.';
  window.setTimeout(() => { status.textContent = ''; }, 3000);
});
