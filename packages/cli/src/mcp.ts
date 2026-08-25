import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { ClariftClient } from '@clarift/sdk';

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export function createClariftMcpServer(client: ClariftClient) {
  const server = new McpServer({ name: 'clarift', version: '0.1.0' });

  server.registerTool('refine_prompt', {
    title: 'Refine prompt',
    description: 'Refine a prompt with Clarift managed inference. Returns quality-tier and allowance metadata.',
    inputSchema: {
      prompt: z.string().min(1).max(60000),
      technique: z.enum(['Zero-shot', 'Few-shot', 'Chain-of-thought', 'Tree-of-thoughts', 'Role / persona', 'Prompt chaining', 'ReAct', 'Meta / reflection']).optional(),
      mode: z.enum(['quick_refine', 'guided_fix', 'full_council']).optional(),
      projectMemory: z.string().max(100000).optional(),
      explanationMode: z.boolean().optional(),
      maxCharacters: z.number().int().min(100).max(60000).optional(),
    },
  }, async (input) => textResult(await client.refine(input)));

  server.registerTool('evaluate_prompt', {
    title: 'Evaluate prompt',
    description: 'Evaluate a prompt against one to eight guidelines.',
    inputSchema: {
      prompt: z.string().min(1).max(60000),
      guidelines: z.array(z.string().min(1).max(8000)).min(1).max(8),
    },
  }, async (input) => textResult(await client.evaluate(input)));

  server.registerTool('convert_document', {
    title: 'Convert document',
    description: 'Convert one base64-encoded document to Markdown.',
    inputSchema: {
      filename: z.string().min(1).max(255),
      mimeType: z.string().max(120).optional(),
      dataBase64: z.string().min(1),
    },
  }, async ({ filename, mimeType, dataBase64 }) => textResult(await client.convert([{
    name: filename,
    type: mimeType,
    data: Uint8Array.from(Buffer.from(dataBase64, 'base64')),
  }])));

  server.registerTool('project_list', {
    title: 'List projects',
    description: 'List projects in the token workspace.',
    inputSchema: { includeTrashed: z.boolean().optional() },
  }, async ({ includeTrashed }) => textResult(await client.listProjects(includeTrashed)));

  server.registerTool('project_create', {
    title: 'Create project',
    description: 'Create a project in the token workspace.',
    inputSchema: { name: z.string().min(1).max(120), description: z.string().max(2000).optional() },
  }, async (input) => textResult(await client.createProject(input)));

  server.registerTool('memory_search', {
    title: 'Search shared project memory',
    description: 'Search active project memory visible to the token workspace.',
    inputSchema: {
      query: z.string().min(2).max(160),
      projectId: z.string().max(200).optional(),
      activeOnly: z.boolean().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
  }, async (input) => textResult(await client.searchMemory(input)));

  server.registerTool('memory_list', {
    title: 'List project memory',
    description: 'List memory entries for one project.',
    inputSchema: {
      projectId: z.string().min(1).max(200),
      activeOnly: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, async ({ projectId, ...options }) => textResult(await client.listMemory(projectId, options)));

  server.registerTool('memory_get_active_context', {
    title: 'Get active hybrid memory context',
    description: 'Retrieve token-budgeted vector + temporal-graph context for a project. Available only when the Hybrid Memory feature gate is enabled.',
    inputSchema: {
      projectId: z.string().min(1).max(200),
      query: z.string().min(2).max(2000),
      maxTokens: z.number().int().min(200).max(12000).optional(),
      topK: z.number().int().min(1).max(20).optional(),
    },
  }, async (input) => textResult(await client.getActiveMemoryContext(input)));

  server.registerTool('memory_write', {
    title: 'Write shared project memory',
    description: 'Write an audited memory entry. The caller must explicitly set consent=true.',
    inputSchema: {
      projectId: z.string().min(1).max(200),
      kind: z.enum(['refinement', 'response', 'converter', 'note', 'evaluation']).optional(),
      title: z.string().min(1).max(160),
      content: z.string().min(1).max(100000),
      sourceRef: z.string().max(200).nullable().optional(),
      consent: z.literal(true),
    },
  }, async ({ projectId, ...input }) => textResult(await client.createMemory(projectId, input)));

  server.registerTool('memory_set_active', {
    title: 'Activate or deactivate project memory',
    description: 'Change whether a memory entry is active. The caller must explicitly set consent=true.',
    inputSchema: {
      projectId: z.string().min(1).max(200),
      entryId: z.string().min(1).max(200),
      active: z.boolean(),
      consent: z.literal(true),
    },
  }, async ({ projectId, entryId, active, consent }) => textResult(await client.updateMemory(projectId, entryId, { active, consent })));

  server.registerTool('usage_get', {
    title: 'Get Clarift usage',
    description: 'Get the current plan, Developer entitlement, credits, and inference allowance.',
    inputSchema: {},
  }, async () => textResult(await client.getUsage()));

  return server;
}

export async function startStdioMcp(client: ClariftClient) {
  const server = createClariftMcpServer(client);
  await server.connect(new StdioServerTransport());
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 30 * 1024 * 1024) {
        reject(new Error('MCP request exceeds 30 MB.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('MCP request body must be valid JSON.')); }
    });
    request.on('error', reject);
  });
}

function sendMethodNotAllowed(response: ServerResponse) {
  response.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
  response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
}

export async function startHttpMcp(client: ClariftClient, options: { host: string; port: number }) {
  const httpServer = createServer(async (request, response) => {
    if (request.url !== '/mcp' || request.method !== 'POST') {
      sendMethodNotAllowed(response);
      return;
    }
    try {
      const body = await readJson(request);
      const mcp = createClariftMcpServer(client);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        enableDnsRebindingProtection: true,
        allowedHosts: [`${options.host}:${options.port}`, `127.0.0.1:${options.port}`, `localhost:${options.port}`],
      });
      await mcp.connect(transport);
      response.on('close', () => {
        void transport.close();
        void mcp.close();
      });
      await transport.handleRequest(request, response, body);
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: error instanceof Error ? error.message : 'MCP request failed.' }, id: null }));
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, options.host, resolve);
  });
  process.stderr.write(`Clarift MCP listening on http://${options.host}:${options.port}/mcp\n`);
}
