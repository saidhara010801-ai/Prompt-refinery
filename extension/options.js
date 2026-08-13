const defaults = { apiBase: 'https://clarift--clarift-e4f6f.us-east4.hosted.app', technique: 'Zero-shot', mode: 'quick_refine', refreshToken: '', deviceId: '' };
const form = document.querySelector('#settings-form');
const status = document.querySelector('#status');
const accountStatus = document.querySelector('#account-status');
const linkStatus = document.querySelector('#link-status');
const connectButton = document.querySelector('#connect');
const signOutButton = document.querySelector('#sign-out');

async function current() {
  const [persistent, session] = await Promise.all([chrome.storage.local.get(defaults), chrome.storage.session.get({ accessToken: '' })]);
  return { ...persistent, ...session };
}
function render(settings) {
  accountStatus.textContent = settings.refreshToken ? 'Connected to Clarift' : 'Not connected';
  connectButton.hidden = Boolean(settings.refreshToken);
  signOutButton.hidden = !settings.refreshToken;
}

current().then((settings) => {
  form.elements.apiBase.value = settings.apiBase;
  form.elements.technique.value = settings.technique;
  form.elements.mode.value = settings.mode;
  render(settings);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form).entries());
  values.apiBase = String(values.apiBase).replace(/\/$/, '');
  await chrome.storage.local.set(values);
  status.textContent = 'Settings saved.';
  setTimeout(() => { status.textContent = ''; }, 3000);
});

connectButton.addEventListener('click', async () => {
  connectButton.disabled = true;
  linkStatus.textContent = 'Starting secure account link...';
  try {
    const settings = await current();
    const response = await fetch(`${String(settings.apiBase).replace(/\/$/, '')}/api/extension/device/start`, { method: 'POST' });
    const link = await response.json();
    if (!response.ok) throw new Error(link?.error?.message || 'Could not start account linking.');
    await chrome.tabs.create({ url: link.verificationUrl });
    linkStatus.textContent = `Approve code ${link.userCode} in the opened Clarift tab.`;
    const deadline = Date.now() + link.expiresIn * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(link.interval, 2) * 1000));
      const tokenResponse = await fetch(`${String(settings.apiBase).replace(/\/$/, '')}/api/extension/device/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceCode: link.deviceCode })
      });
      const token = await tokenResponse.json();
      if (token.status === 'pending') continue;
      if (!tokenResponse.ok || token.status !== 'issued') throw new Error(token?.error?.message || 'Account link expired.');
      await Promise.all([
        chrome.storage.session.set({ accessToken: token.accessToken }),
        chrome.storage.local.set({ refreshToken: token.refreshToken, deviceId: token.deviceId })
      ]);
      linkStatus.textContent = 'Clarift account connected.';
      render(await current());
      return;
    }
    throw new Error('Account link expired. Start again.');
  } catch (error) {
    linkStatus.textContent = error.message || 'Could not connect Clarift.';
  } finally {
    connectButton.disabled = false;
  }
});

signOutButton.addEventListener('click', async () => {
  let settings = await current();
  if (!settings.accessToken && settings.refreshToken) {
    try {
      const response = await fetch(`${String(settings.apiBase).replace(/\/$/, '')}/api/extension/refresh`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: settings.refreshToken })
      });
      if (response.ok) settings = { ...settings, ...await response.json() };
    } catch {
      // Local sign-out still proceeds if the server session has already expired.
    }
  }
  if (settings.accessToken) {
    await fetch(`${String(settings.apiBase).replace(/\/$/, '')}/api/extension/signout`, { method: 'POST', headers: { Authorization: `Bearer ${settings.accessToken}` } }).catch(() => undefined);
  }
  await Promise.all([chrome.storage.session.remove('accessToken'), chrome.storage.local.remove(['refreshToken', 'deviceId'])]);
  linkStatus.textContent = 'Extension signed out.';
  render(await current());
});
