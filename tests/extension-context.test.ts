import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { extensionProjectMemory, extensionRefinementSchema } from '../src/lib/server/extension-refinement';
import { readBoundedExtensionJson } from '../src/lib/server/extension-request-security';

const sandbox = vm.createContext({});
vm.runInContext(readFileSync('extension/context-core.js', 'utf8'), sandbox);
const core = sandbox.ClariftContext;

test('portable pill preserves every captured turn in full mode, including repeated turns', () => {
  const messages = [{ role: 'user', text: 'Keep the ending ambiguous.' }, { role: 'assistant', text: 'Use an unreliable narrator.' }, { role: 'user', text: 'Keep the ending ambiguous.' }];
  const result = core.buildPill({ title: 'Story', provider: 'fixture', capturedAt: '2026-09-05T00:00:00Z', url: 'https://example.org/story', messages, warnings: [] }, { full: true, goal: 'Write a mystery', decisions: 'The narrator is Mira.' });
  assert.equal(result.split('Keep the ending ambiguous.').length - 1, 2);
  assert.match(result, /The narrator is Mira/);
  assert.match(result, /completeness of the original conversation is unverified/);
  assert.match(result, /Assistant suggestions are not confirmed user decisions/);
  assert.doesNotMatch(result, /https:\/\/example/);
});

test('compact capture has a bounded budget, samples early and late turns, and discloses omissions', () => {
  const messages = Array.from({ length: 100 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `TURN-${i}: ${'A'.repeat(900)} END-${i}` }));
  const compact = core.compact(messages, 4000);
  assert.ok(compact.text.length <= 4000);
  assert.ok(compact.omitted > 0);
  assert.match(compact.text, /TURN-0:/);
  assert.match(compact.text, /END-99/);
  assert.match(compact.text, /excerpt shortened/);
  const pill = core.buildPill({ title: 'Long chat', messages }, { budget: 4000 });
  assert.match(pill, /turns omitted/);
  assert.match(pill, /not a semantic summary/);
});

test('short capture and imported transcript are labelled accurately without inventing decisions', () => {
  const capture = { title: 'Imported', messages: [{ role: 'transcript', text: 'Alice: hello\nBot: hi' }], warnings: ['Speaker labels unverified.'] };
  const pill = core.buildPill(capture);
  assert.match(pill, /Alice: hello\nBot: hi/);
  assert.match(pill, /Not supplied/);
  assert.match(pill, /Speaker labels unverified/);
  assert.equal(core.compact(capture.messages).shortened, false);
});

test('attached extension context requires explicit consent and fits the gateway memory limit', () => {
  const base = { prompt: 'Continue the outline' };
  assert.equal(extensionRefinementSchema.parse(base).context, undefined);
  for (const context of [{ text: 'History' }, { text: 'History', consent: false }, { text: '', consent: true }, { text: 'a'.repeat(5601), consent: true }]) {
    assert.equal(extensionRefinementSchema.safeParse({ ...base, context }).success, false);
  }
  const input = extensionRefinementSchema.parse({ ...base, context: { text: 'a'.repeat(5600), consent: true } });
  const memory = extensionProjectMemory(input.context)!;
  assert.ok(memory.length <= 6000);
  assert.match(memory, /untrusted context/);
  assert.equal(extensionProjectMemory(), undefined);
  assert.equal(extensionRefinementSchema.safeParse({ prompt: ' ' }).success, false);
  assert.equal(extensionRefinementSchema.safeParse({ prompt: 'a'.repeat(50001) }).success, false);
});

test('refinement body accepts bounded unicode but rejects oversized chunked requests', async () => {
  const limit = 384 * 1024;
  const body = JSON.stringify({ prompt: '界'.repeat(50000), context: { text: '界'.repeat(5600), consent: true } });
  assert.ok(Buffer.byteLength(body) < limit);
  const parsed = await readBoundedExtensionJson(new Request('https://example.org/refine', { method: 'POST', body }), limit);
  assert.equal(extensionRefinementSchema.safeParse(parsed).success, true);
  await assert.rejects(() => readBoundedExtensionJson(new Request('https://example.org/refine', { method: 'POST', body: 'a'.repeat(limit + 1) }), limit), { name: 'ExtensionRequestSecurityError', status: 413 });
});

test('manifest offers optional broad access and local omnibox entry without broad required access', () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*']);
  assert.ok(!manifest.host_permissions.includes('<all_urls>'));
  assert.equal(manifest.omnibox.keyword, 'clarift');
  assert.equal(manifest.content_scripts[0].all_frames, true);
  for (const script of manifest.content_scripts[0].js) assert.ok(readFileSync(`extension/${script}`).length);
});

function workerHarness() {
  const event = () => ({ listeners: [] as ((...args: any[]) => any)[], addListener(listener: (...args: any[]) => any) { this.listeners.push(listener); } });
  const state = { allowed: false, scripts: [] as any[], session: {} as Record<string, unknown>, urls: [] as string[], requests: [] as any[], acknowledgeContext: true };
  const chrome = {
    runtime: { onInstalled: event(), onStartup: event(), onMessage: event(), getURL: (path: string) => `chrome-extension://fixture/${path}` },
    storage: {
      local: { get: async (defaults: object) => defaults },
      session: { get: async () => ({ accessToken: 'synthetic-access-token' }), set: async (values: object) => Object.assign(state.session, values), clear: async () => {} },
      sync: { clear: async () => {} },
    },
    permissions: { contains: async () => state.allowed, onAdded: event(), onRemoved: event() },
    scripting: {
      getRegisteredContentScripts: async () => state.scripts,
      registerContentScripts: async (scripts: any[]) => { state.scripts.push(...scripts); },
      updateContentScripts: async (scripts: any[]) => { state.scripts = scripts; },
      unregisterContentScripts: async () => { state.scripts = []; },
    },
    omnibox: { onInputStarted: event(), onInputEntered: event(), setDefaultSuggestion: async () => {} },
    tabs: { create: async ({ url }: { url: string }) => { state.urls.push(url); } },
  };
  const context = vm.createContext({ chrome, AbortController, setTimeout, clearTimeout, crypto, fetch: async (_url: string, options: any) => {
    state.requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ refinedPrompt: 'Refined', contextApplied: state.acknowledgeContext }));
  } });
  vm.runInContext(readFileSync('extension/background.js', 'utf8'), context);
  const send = (message: object) => new Promise<any>((resolve) => chrome.runtime.onMessage.listeners[0](message, {}, resolve));
  return { chrome, context, state, send };
}

test('broad activation registers only after permission and unregisters on revocation', async () => {
  const { chrome, context, state } = workerHarness();
  chrome.runtime.onStartup.listeners[0]();
  await vm.runInContext('accessSync', context);
  assert.equal(state.scripts.length, 0);
  state.allowed = true;
  chrome.permissions.onAdded.listeners[0]();
  await vm.runInContext('accessSync', context);
  assert.equal(state.scripts.length, 1);
  assert.equal(state.scripts[0].allFrames, true);
  chrome.permissions.onAdded.listeners[0]();
  await vm.runInContext('accessSync', context);
  assert.equal(state.scripts.length, 1);
  state.allowed = false;
  chrome.permissions.onRemoved.listeners[0]();
  await vm.runInContext('accessSync', context);
  assert.equal(state.scripts.length, 0);
});

test('omnibox handoff keeps prompt text out of the navigation URL and makes no inference call', async () => {
  const { chrome, state } = workerHarness();
  await chrome.omnibox.onInputEntered.listeners[0]('A private story idea & twist');
  assert.equal(Object.values(state.session)[0], 'A private story idea & twist');
  assert.match(state.urls[0], /^chrome-extension:\/\/fixture\/context.html\?draft=[a-f\d-]{36}$/);
  assert.equal(state.requests.length, 0);
});

test('worker sends only consented context and detects servers that silently ignore it', async () => {
  const { state, send } = workerHarness();
  const rejected = await send({ type: 'clarift-refine', prompt: 'Continue', context: { text: 'History', consent: false } });
  assert.equal(rejected.ok, false);
  assert.equal(state.requests.length, 0);
  assert.equal((await send({ type: 'clarift-refine', prompt: 'Continue' })).ok, true);
  assert.equal(state.requests[0].context, undefined);
  state.acknowledgeContext = false;
  const oldServer = await send({ type: 'clarift-refine', prompt: 'Continue', context: { text: 'Mira is the narrator.', consent: true } });
  assert.equal(oldServer.ok, false);
  assert.match(oldServer.error, /does not support attached chat context/);
  assert.equal(state.requests[1].context.text, 'Mira is the narrator.');
});

test('history windows merge upward and downward without removing repeated turns', () => {
  const messages = Array.from({ length: 30 }, (_, i) => ({ id: `m-${i}`, role: i % 2 ? 'assistant' : 'user', text: i === 4 || i === 6 ? 'Same repeated request' : `Message ${i}` }));
  let result = messages.slice(24);
  for (let start = 20; start >= 0; start -= 4) result = core.mergeWindows(result, messages.slice(start, start + 8), 'up').messages;
  for (let start = 0; start < 30; start += 4) result = core.mergeWindows(result, messages.slice(start, start + 8), 'down').messages;
  assert.deepEqual(JSON.parse(JSON.stringify(result)), messages);
  const edited = core.mergeWindows(result, [{ ...messages[4], text: 'Corrected request' }], 'down');
  assert.equal(edited.messages[4].text, 'Corrected request');
  assert.equal(edited.messages.length, 30);
  const gap = [...messages.slice(0, 3), ...messages.slice(10)];
  const filled = core.mergeWindows(gap, messages.slice(2, 11), 'down');
  assert.deepEqual(JSON.parse(JSON.stringify(filled.messages)), messages);
});

test('history without stable IDs retains repeated messages inside windows and reports missing overlap', () => {
  const first = [{ role: 'user', text: 'A' }, { role: 'assistant', text: 'B' }, { role: 'user', text: 'A' }];
  const next = [{ role: 'user', text: 'A' }, { role: 'assistant', text: 'C' }];
  const merged = core.mergeWindows(first, next, 'down');
  assert.equal(merged.messages.length, 4);
  assert.equal(merged.messages.filter((message: any) => message.text === 'A').length, 2);
  assert.equal(core.mergeWindows(first, [{ role: 'user', text: 'Unconnected segment' }]).gap, true);
});
