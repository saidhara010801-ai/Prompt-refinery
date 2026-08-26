import assert from 'node:assert/strict';
import test from 'node:test';

import { ClariftClient } from '@clarift/sdk';
import { startHttpMcp } from '../packages/cli/src/mcp';
import { resolveEffectiveTokenScopes } from '../src/lib/server/api-key-service';
import { getActiveHybridMemoryContext } from '../src/lib/server/hybrid-memory-service';
import { AuthorizationError } from '../src/lib/server/user-access';

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
