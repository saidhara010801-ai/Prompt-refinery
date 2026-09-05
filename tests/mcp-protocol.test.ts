import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import test from 'node:test';

import { ClariftClient } from '@clarift/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createClariftMcpServer, startHttpMcp } from '../packages/cli/src/mcp';
import { resolveEffectiveTokenScopes } from '../src/lib/server/api-key-service';
import { getActiveHybridMemoryContext } from '../src/lib/server/hybrid-memory-service';
import { AuthorizationError } from '../src/lib/server/user-access';

async function closeHttpServer(server: ReturnType<typeof createServer>) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function environmentWith(overrides: Record<string, string>) {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    ...overrides,
  };
}

async function rawHttpPost(url: URL, headers: Record<string, string>, body: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(url, { method: 'POST', headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('A-AUTH-13: resolveEffectiveTokenScopes restricts legacy tokens (no tenantId, no scopes array) to default scope triad on first call', () => {
  const legacyKeyData = { tenantId: null, scopes: null };
  const effectiveScopes = resolveEffectiveTokenScopes(legacyKeyData);

  // Assert default triad
  assert.deepEqual(effectiveScopes, ['refinements:write', 'evaluations:write', 'conversions:write']);

  // Assert that newly introduced scopes (memory:write, memory:read, projects:write, projects:read, usage:read) are NOT permitted
  assert.equal(effectiveScopes.includes('memory:write' as any), false);
  assert.equal(effectiveScopes.includes('memory:read' as any), false);
  assert.equal(effectiveScopes.includes('projects:write' as any), false);
  assert.equal(effectiveScopes.includes('projects:read' as any), false);
  assert.equal(effectiveScopes.includes('usage:read' as any), false);

  // Explicit token with specified scopes returns exact configured scopes
  const modernKeyData = { tenantId: 'tenant-1', scopes: ['refinements:write', 'usage:read'] };
  assert.deepEqual(resolveEffectiveTokenScopes(modernKeyData), ['refinements:write', 'usage:read']);
});

test('A-TRN-15: startHttpMcp server rejects untrusted Origin headers and accepts valid loopback Origins', async () => {
  const mockClient = new ClariftClient({ apiKey: 'clf_live_test_123', baseUrl: 'http://127.0.0.1:9999/api/v1' });
  const host = '127.0.0.1';
  const port = 3231;

  // Start actual production HTTP MCP bridge from packages/cli/src/mcp.ts
  const server = await startHttpMcp(mockClient, { host, port });

  try {
    // 1. Untrusted origin request -> 403 Forbidden: untrusted origin.
    const untrustedRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Origin: 'http://evil-malicious-site.com' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
    });
    assert.equal(untrustedRes.status, 403);
    const untrustedBody = await untrustedRes.json();
    assert.equal(untrustedBody.error.message, 'Forbidden: untrusted origin.');

    // 2. Trusted origin request -> proceed to MCP handler (200 OK)
    const validRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Origin: `http://127.0.0.1:${port}` },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
    });
    assert.equal(validRes.status, 200);
  } finally {
    server.close();
  }
});

test('A-TRN-01 & A-TRN-02: HTTP MCP transport completes initialization protocol (initialize -> notifications/initialized -> tools/list) and returns 11 tools', async () => {
  const mockClient = new ClariftClient({ apiKey: 'clf_live_test_123', baseUrl: 'http://127.0.0.1:9999/api/v1' });
  const host = '127.0.0.1';
  const port = 3232;

  const server = await startHttpMcp(mockClient, { host, port });
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Origin: `http://127.0.0.1:${port}` };

  try {
    // Step 1: Send initialize request
    const initRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'mcp-test-client', version: '1.0.0' },
        },
        id: 1,
      }),
    });
    assert.equal(initRes.status, 200);
    const initData = await initRes.json();
    assert.equal(initData.jsonrpc, '2.0');
    assert.equal(initData.id, 1);
    assert.equal(initData.result?.serverInfo?.name, 'clarift');

    // Step 2: Send initialized notification (returns HTTP 202 Accepted)
    const notificationRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    });
    assert.equal(notificationRes.status, 202);

    // Step 3: Send tools/list request after initialization protocol
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 42 }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.jsonrpc, '2.0');
    assert.equal(data.id, 42);
    assert.ok(data.result?.tools);

    const tools = data.result.tools;
    assert.equal(tools.length, 11);

    const expectedToolNames = [
      'refine_prompt',
      'evaluate_prompt',
      'convert_document',
      'project_list',
      'project_create',
      'memory_search',
      'memory_list',
      'memory_get_active_context',
      'memory_write',
      'memory_set_active',
      'usage_get',
    ];

    const actualNames = tools.map((t: any) => t.name);
    for (const name of expectedToolNames) {
      assert.ok(actualNames.includes(name), `Missing tool: ${name}`);
    }
  } finally {
    server.close();
  }
});

test('A-GATE-01: getActiveHybridMemoryContext returns 503 HybridMemoryDisabledError when hybrid memory is off', async () => {
  delete process.env.ENABLE_HYBRID_MEMORY;

  const mockCaller: any = {
    uid: 'user-1',
    keyId: 'key-1',
    entitlement: { isPro: true, hasDeveloperAccess: true },
    context: { tenantId: 't-1', workspaceId: 'ws-1' },
    scopes: ['memory:read'],
  };

  await assert.rejects(
    async () => {
      await getActiveHybridMemoryContext(mockCaller, { projectId: 'p1', query: 'migration' });
    },
    (err: any) => {
      assert.equal(err instanceof AuthorizationError, true);
      assert.equal(err.status, 503);
      assert.equal(err.name, 'HybridMemoryDisabledError');
      return true;
    }
  );
});

test('A-TRN-06, A-TRN-08 & A-TRN-15: production HTTP bridge rejects method, malformed JSON, and invalid Host then recovers', async () => {
  const mockClient = new ClariftClient({ apiKey: 'clf_live_test_123', baseUrl: 'http://127.0.0.1:9999/api/v1' });
  const host = '127.0.0.1';
  const port = 3233;
  const server = await startHttpMcp(mockClient, { host, port });
  const endpoint = `http://${host}:${port}/mcp`;
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Origin: endpoint.replace('/mcp', '') };

  try {
    const getResponse = await fetch(endpoint);
    assert.equal(getResponse.status, 405);
    assert.equal(getResponse.headers.get('allow'), 'POST');

    const malformedResponse = await fetch(endpoint, { method: 'POST', headers, body: '{not-json' });
    assert.equal(malformedResponse.status, 400);
    const malformed = await malformedResponse.json();
    assert.equal(malformed.error?.code, -32700);

    const invalidHostResponse = await rawHttpPost(
      new URL(endpoint),
      { ...headers, Host: 'attacker.example' },
      JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 8 })
    );
    assert.equal(invalidHostResponse.status, 403);

    const recoveryResponse = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 9 }),
    });
    assert.equal(recoveryResponse.status, 200);
  } finally {
    await closeHttpServer(server);
  }
});

test('A-TRN-01, A-TRN-02 & A-TRN-11: stdio child process negotiates MCP and calls usage_get without stdout corruption', async () => {
  const token = 'clf_live_stdio_phase_a_test';
  const captured = { requestHeaders: null as Headers | null };
  const upstream = createServer((request, response) => {
    captured.requestHeaders = new Headers(request.headers as Record<string, string>);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      plan: 'Individual',
      planStatus: 'active',
      developer: { enabled: true, source: 'test', features: ['mcp'] },
      credits: { balance: 0, reserved: 0, available: 0 },
      allowance: {},
    }));
  });
  await new Promise<void>((resolve, reject) => {
    upstream.once('error', reject);
    upstream.listen(0, '127.0.0.1', resolve);
  });
  const address = upstream.address() as AddressInfo;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', path.resolve('packages/cli/src/index.ts'), 'mcp', '--transport', 'stdio'],
    cwd: process.cwd(),
    env: environmentWith({
      CLARIFT_API_TOKEN: token,
      CLARIFT_BASE_URL: `http://127.0.0.1:${address.port}/api/v1`,
      CLARIFT_AGENT_NAME: 'phase-a-stdio-test',
    }),
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => { stderr += String(chunk); });
  const client = new Client({ name: 'clarift-phase-a-test', version: '1.0.0' });

  try {
    await client.connect(transport, { timeout: 10_000 });
    assert.equal(client.getServerVersion()?.name, 'clarift');
    assert.equal((await client.listTools()).tools.length, 11);
    const result = await client.callTool({ name: 'usage_get', arguments: {} });
    assert.equal(result.isError, undefined);
    const content = result.content as Array<{ type: string; text?: string }>;
    const block = content[0];
    assert.equal(block?.type, 'text');
    if (block?.type !== 'text' || typeof block.text !== 'string') throw new Error('usage_get did not return text content.');
    assert.equal(JSON.parse(block.text).plan, 'Individual');
    assert.equal(captured.requestHeaders?.get('authorization'), `Bearer ${token}`);
    assert.equal(captured.requestHeaders?.get('x-clarift-client'), 'mcp');
  } finally {
    await client.close().catch(() => undefined);
    await closeHttpServer(upstream);
  }
  assert.doesNotMatch(stderr, /clf_live_/);
});

test('A-TRN-02 & A-VAL-01: in-memory MCP transport invokes production usage tool and rejects invalid memory consent', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const apiClient = new ClariftClient({
    apiKey: 'clf_live_in_memory_test',
    baseUrl: 'https://clarift.test/api/v1',
    clientName: 'mcp',
    fetch: async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({
        plan: 'Individual',
        planStatus: 'active',
        developer: { enabled: true, source: 'test', features: ['mcp'] },
        credits: { balance: 0, reserved: 0, available: 0 },
        allowance: {},
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const server = createClariftMcpServer(apiClient);
  const client = new Client({ name: 'clarift-in-memory-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const usage = await client.callTool({ name: 'usage_get', arguments: {} });
    assert.equal(usage.isError, undefined);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://clarift.test/api/v1/usage');

    const denied = await client.callTool({
      name: 'memory_write',
      arguments: { projectId: 'project-1', title: 'Denied', content: 'Must not dispatch.', consent: false },
    });
    assert.equal(denied.isError, true);
    assert.match(JSON.stringify(denied.content), /consent|invalid arguments/i);
    assert.equal(calls.length, 1);
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
});
