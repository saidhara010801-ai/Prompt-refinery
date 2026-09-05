// Synthetic browser integration checks. No account, provider, or external chat traffic.
// Use an installed playwright package, or set CLARIFT_PLAYWRIGHT_MODULE to its entry point.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CLARIFT_PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(import.meta.dirname, '..');
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  const relative = path === '/chat' ? 'tests/fixtures/extension-chat.html' : path === '/virtual-chat' ? 'tests/fixtures/extension-virtual-chat.html' : path.startsWith('/extension/') ? path.slice(1) : null;
  if (!relative || relative.includes('..')) { response.writeHead(404).end(); return; }
  try {
    response.setHeader('Content-Type', relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(await readFile(join(root, relative)));
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(process.env.CLARIFT_FIXTURE_PORT || 0), '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CLARIFT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.CLARIFT_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  await page.addInitScript(() => {
    globalThis.testMessages = [];
    globalThis.testListeners = [];
    globalThis.chrome = { runtime: {
      onMessage: { addListener: (callback) => testListeners.push(callback) },
      sendMessage: (message) => {
        testMessages.push(message);
        return new Promise((resolve) => { globalThis.resolveRefinement = resolve; });
      }
    } };
  });
  await page.goto(`${base}/chat?private=query#secret`);
  for (const file of ['context-core.js', 'context-capture.js', 'context-history.js', 'content.js']) await page.addScriptTag({ path: join(root, 'extension', file) });
  await page.addStyleTag({ path: join(root, 'extension/content.css') });
  const capture = await page.evaluate(() => ClariftCapture.capture('chat'));
  assert.equal(capture.messages.length, 5);
  assert.equal(capture.messages.filter((message) => message.text === 'Keep the ending ambiguous.').length, 2);
  assert.match(capture.messages[1].text, /chapter = 1;\nkeep_the_map/);
  assert.doesNotMatch(JSON.stringify(capture.messages), /SECRET|PRIVATE|Copy secret|Continue Mira/);
  assert.equal(capture.url, `${base}/chat`);
  const pageText = await page.evaluate(() => ClariftCapture.capture('page'));
  assert.doesNotMatch(JSON.stringify(pageText.messages), /PRIVATE|SECRET|Refine this search/);
  console.log('PASS capture: nested wrappers, repeated turns, roles, code, hidden text, composer exclusion, URL redaction');

  for (const id of ['implicit', 'search', 'plain', 'rich', 'shadow-editor']) {
    await page.locator(`#${id}`).focus();
    assert.equal(await page.locator('.clarift-extension-action').isVisible(), true, id);
  }
  for (const id of ['password', 'email', 'readonly', 'aria-only']) {
    await page.locator(`#${id}`).focus();
    await page.waitForFunction(() => document.querySelector('.clarift-extension-action').hidden);
  }
  console.log('PASS editors: implicit input, search, plaintext-only, rich text, open shadow root; sensitive and read-only exclusions');

  await page.locator('#search').focus();
  await page.locator('.clarift-extension-action').click();
  await page.locator('#implicit').focus();
  await page.evaluate(() => resolveRefinement({ ok: true, refinedPrompt: 'Refined search' }));
  await page.waitForFunction(() => document.querySelector('#search').value === 'Refined search');
  assert.equal(await page.locator('#implicit').inputValue(), 'Refine this search');
  await page.locator('#prompt').focus();
  await page.locator('.clarift-extension-action').click();
  await page.locator('#prompt').fill('New unsent draft');
  await page.evaluate(() => resolveRefinement({ ok: true, refinedPrompt: 'Do not insert this' }));
  await page.waitForFunction(() => !document.querySelector('.clarift-extension-action').disabled);
  assert.equal(await page.locator('#prompt').inputValue(), 'New unsent draft');
  assert.ok(await page.locator('.clarift-extension-status').textContent().then((text) => text.includes('preserved')));
  console.log('PASS delayed refinement: stays with original editor and preserves edits made during request');

  await page.locator('#implicit').focus();
  await page.evaluate(() => document.querySelector('#implicit').setSelectionRange(0, 6));
  await page.locator('.clarift-extension-action').click();
  await page.evaluate(() => resolveRefinement({ ok: true, refinedPrompt: 'Improve' }));
  await page.waitForFunction(() => document.querySelector('#implicit').value === 'Improve this search');
  await page.evaluate(() => {
    for (const listener of testListeners) listener({ type: 'clarift-set-context', pageKey: location.href, text: 'Mira is the narrator.' }, {}, (result) => { if (!result.ok) throw new Error(result.error); });
  });
  await page.locator('#implicit').focus();
  await page.locator('.clarift-extension-action').click();
  assert.equal(await page.evaluate(() => testMessages.at(-1).context.text), 'Mira is the narrator.');
  await page.evaluate(() => resolveRefinement({ ok: true, refinedPrompt: 'With context' }));
  await page.waitForFunction(() => !document.querySelector('.clarift-extension-action').disabled);
  await page.evaluate(() => history.pushState({}, '', '/chat?conversation=other'));
  await page.locator('#implicit').focus();
  await page.locator('.clarift-extension-action').click();
  assert.equal(await page.evaluate(() => testMessages.at(-1).context), undefined);
  await page.evaluate(() => resolveRefinement({ ok: true, refinedPrompt: 'Without context' }));
  console.log('PASS selected-text replacement and conversation-bound reviewed context');

  const frame = page.frames().find((frame) => frame !== page.mainFrame());
  for (const file of ['context-core.js', 'context-capture.js', 'content.js']) await frame.addScriptTag({ path: join(root, 'extension', file) });
  await frame.locator('textarea').focus();
  assert.equal(await frame.locator('.clarift-extension-action').isVisible(), true);
  console.log('PASS iframe editor');

  for (const lazy of [false, true]) {
    const historyPage = await browser.newPage();
    await historyPage.goto(`${base}/virtual-chat${lazy ? '?lazy=1' : ''}`);
    for (const file of ['context-core.js', 'context-capture.js', 'context-history.js']) await historyPage.addScriptTag({ path: join(root, 'extension', file) });
    await historyPage.addStyleTag({ path: join(root, 'extension/content.css') });
    const before = await historyPage.evaluate(() => ({ count: ClariftCapture.capture().messages.length, top: document.querySelector('#chat-scroll').scrollTop }));
    assert.ok(before.count <= 7);
    const job = await historyPage.evaluate(() => ClariftHistory.start({ waitMs: 30, settlePasses: 6, maxMs: 30000 }));
    await historyPage.waitForFunction((id) => ClariftHistory.progress(id).status !== 'running', job.id);
    const collected = await historyPage.evaluate((id) => ClariftHistory.progress(id), job.id);
    assert.equal(collected.status, 'complete');
    assert.equal(collected.capture.messages.length, 60, JSON.stringify(collected.capture.history));
    assert.match(collected.capture.messages[0].text, /Original project goal/);
    assert.match(collected.capture.messages.at(-1).text, /Latest next action/);
    assert.equal(collected.capture.messages.filter((message) => message.text === 'Keep the ending ambiguous.').length, 2);
    assert.equal(collected.capture.history.gaps, false);
    assert.equal(await historyPage.locator('#chat-scroll').evaluate((element) => element.scrollTop), before.top);
    assert.equal(await historyPage.locator('#chat-scroll').evaluate((element) => element.style.scrollBehavior), 'smooth');
    console.log(`PASS ${lazy ? 'lazy-loaded + ' : ''}virtualized history: ${before.count} mounted → 60 ordered turns, repeats preserved, scroll restored`);

    const cancelled = await historyPage.evaluate(() => {
      const job = ClariftHistory.start({ waitMs: 30 }); ClariftHistory.cancel(job.id); return job;
    });
    await historyPage.waitForFunction((id) => ClariftHistory.progress(id).status !== 'running', cancelled.id);
    assert.equal((await historyPage.evaluate((id) => ClariftHistory.progress(id), cancelled.id)).capture.history.reason, 'cancelled');
    assert.equal(await historyPage.locator('#chat-scroll').evaluate((element) => element.scrollTop), before.top);
    const changed = await historyPage.evaluate(() => {
      const job = ClariftHistory.start({ waitMs: 30 }); history.pushState({}, '', '/virtual-chat?another-chat'); return job;
    });
    await historyPage.waitForFunction((id) => ClariftHistory.progress(id).status !== 'running', changed.id);
    const stopped = await historyPage.evaluate((id) => ClariftHistory.progress(id), changed.id);
    assert.equal(stopped.status, 'error');
    assert.equal(stopped.capture.messages.length, 0);
    await historyPage.close();
  }
  console.log('PASS history cancellation and navigation isolation');

  const popup = await browser.newPage();
  await popup.addInitScript(() => {
    const state = globalThis.popupState = { blocked: false, injections: 0 };
    globalThis.chrome = {
      runtime: { getManifest: () => ({ version: '2.3.1' }), getURL: (path) => path, openOptionsPage() {}, sendMessage: async () => ({ frames: state.blocked ? [] : [{ frameId: 4, pageKey: 'https://www.perplexity.ai/?erp=new_tab', title: 'Perplexity' }] }) },
      tabs: { query: async () => [{ id: 11, url: 'chrome://newtab/' }], create: async () => {} },
      permissions: { contains: async () => true },
      storage: { local: { get: async () => ({}) }, session: { get: async () => ({}) } },
      scripting: { insertCSS: async () => { state.injections += 1; if (state.blocked) throw new Error('This page cannot be scripted due to an ExtensionsSettings policy.'); }, executeScript: async () => [] }
    };
  });
  await popup.goto(`${base}/extension/popup.html`);
  assert.equal(await popup.locator('#enable-page').isEnabled(), true);
  await popup.locator('#enable-page').click();
  assert.match(await popup.locator('#page-status').textContent(), /active in 1 frame/);
  await popup.evaluate(() => { popupState.blocked = true; });
  await popup.locator('#enable-page').click();
  assert.match(await popup.locator('#page-status').textContent(), /browser blocked inline access/i);
  assert.equal(await popup.locator('#enable-page').isEnabled(), true);
  await popup.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await popup.locator('#copy-handoff').click();
  assert.match(await popup.evaluate(() => navigator.clipboard.readText()), /all earlier turns available to you/);
  await popup.close();
  console.log('PASS Comet-style internal tab metadata, permitted child frame, policy rejection, and whole-chat handoff copy');

  const editor = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [];
  editor.on('pageerror', (error) => errors.push(error.message));
  await editor.goto(`${base}/extension/context.html`);
  await editor.getByText('Paste or import a transcript instead', { exact: true }).click();
  await editor.locator('#manual-transcript').fill(capture.messages.map((message) => `${message.role}: ${message.text}`).join('\n\n'));
  await editor.locator('#use-transcript').click();
  await editor.locator('#goal').fill('Finish Mira’s lighthouse mystery.');
  await editor.locator('#decisions').fill('The ending remains ambiguous.');
  await editor.locator('#next').fill('Outline chapter two.');
  await editor.locator('#build-pill').click();
  const pill = await editor.locator('#pill-output').inputValue();
  assert.match(pill, /Finish Mira’s lighthouse mystery/);
  assert.match(pill, /The ending remains ambiguous/);
  assert.match(pill, /Outline chapter two/);
  assert.equal(await editor.locator('#copy-pill').isEnabled(), true);
  await editor.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await editor.locator('#copy-pill').click();
  assert.equal((await editor.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), pill);
  const download = editor.waitForEvent('download');
  await editor.locator('#download-pill').click();
  assert.equal((await download).suggestedFilename(), 'clarift-context-pill.md');
  await mkdir(join(root, 'tmp', 'extension-context'), { recursive: true });
  await editor.screenshot({ path: join(root, 'tmp', 'extension-context', 'context-desktop.png'), fullPage: true });
  await editor.setViewportSize({ width: 390, height: 844 });
  await editor.evaluate(async () => {
    document.activeElement?.blur();
    for (const textarea of document.querySelectorAll('textarea')) textarea.scrollTop = 0;
    window.scrollTo(0, 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  assert.equal(await editor.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await editor.screenshot({ path: join(root, 'tmp', 'extension-context', 'context-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS local pill workflow, clipboard copy, Markdown download, desktop/mobile layout, no page errors');
  if (process.env.CLARIFT_EXTENSION_EXECUTABLE) {
    const extension = await chromium.launchPersistentContext('', {
      executablePath: process.env.CLARIFT_EXTENSION_EXECUTABLE, headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--disable-extensions-except=${join(root, 'extension')}`, `--load-extension=${join(root, 'extension')}`]
    });
    try {
      const worker = extension.serviceWorkers()[0] || await extension.waitForEvent('serviceworker', { timeout: 15000 });
      const extensionId = await worker.evaluate(() => chrome.runtime.id);
      const source = await extension.newPage();
      await source.goto(`http://localhost:${server.address().port}/virtual-chat?smoke=1`);
      const sourceTab = await worker.evaluate(() => chrome.tabs.query({}).then((tabs) => tabs.find((tab) => tab.url?.includes('/virtual-chat?smoke=1'))));
      assert.ok(sourceTab?.id);
      const workbench = await extension.newPage();
      const extensionErrors = [];
      workbench.on('pageerror', (error) => extensionErrors.push(error.message));
      await workbench.goto(`chrome-extension://${extensionId}/context.html?tab=${sourceTab.id}`);
      try {
        await workbench.waitForFunction(() => document.querySelector('#source-status').textContent.includes('12 captured turn') || document.querySelector('#status').dataset.error === 'true', null, { timeout: 60000 });
        assert.equal(await workbench.locator('#status').getAttribute('data-error'), 'false', await workbench.locator('#status').textContent());
      } catch (error) {
        console.log('EXTENSION UI DIAGNOSTICS', await workbench.evaluate(() => ({ source: document.querySelector('#source-status').textContent, progress: document.querySelector('#history-status').textContent, status: document.querySelector('#status').textContent })), extensionErrors);
        throw error;
      }
      assert.match(await workbench.locator('#pill-output').inputValue(), /Original project goal/);
      assert.match(await workbench.locator('#history-status').textContent(), /12 messages/);
      await workbench.locator('#copy-pill').click();
      await workbench.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Copied') || document.querySelector('#status').dataset.error === 'true');
      assert.match(await workbench.locator('#status').textContent(), /Copied/);
      assert.deepEqual(extensionErrors, []);
      console.log('PASS real unpacked extension: worker discovery, frame messaging, automatic history collection, draft creation, clipboard copy');
    } finally { await extension.close(); }
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
