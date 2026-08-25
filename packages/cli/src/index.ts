#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import process from 'node:process';

import { ClariftApiError, ClariftClient, type ClariftTechnique, type ProjectMemoryKind, type RefinementMode } from '@clarift/sdk';

import { startHttpMcp, startStdioMcp } from './mcp.js';

interface ParsedArgs {
  positionals: string[];
  options: Map<string, string[]>;
}

function parseArgs(values: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options = new Map<string, string[]>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }
    const [rawKey, inline] = value.slice(2).split('=', 2);
    const next = inline ?? (values[index + 1] && !values[index + 1].startsWith('--') ? values[++index] : 'true');
    options.set(rawKey, [...(options.get(rawKey) ?? []), next]);
  }
  return { positionals, options };
}

function option(args: ParsedArgs, name: string) {
  return args.options.get(name)?.at(-1);
}

function requiredOption(args: ParsedArgs, name: string) {
  const value = option(args, name);
  if (!value || value === 'true') throw new Error(`--${name} is required.`);
  return value;
}

async function stdinText() {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').trim();
}

function createClient(args: ParsedArgs, clientName: 'cli' | 'mcp') {
  const apiKey = option(args, 'api-key') ?? process.env.CLARIFT_API_TOKEN;
  if (!apiKey) throw new Error('Set CLARIFT_API_TOKEN or pass --api-key.');
  return new ClariftClient({
    apiKey,
    baseUrl: option(args, 'base-url') ?? process.env.CLARIFT_BASE_URL,
    clientName,
    agentName: option(args, 'agent') ?? process.env.CLARIFT_AGENT_NAME,
  });
}

function print(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function help() {
  process.stdout.write(`Clarift CLI\n\nCommands:\n  refine [--prompt TEXT] [--mode quick_refine|guided_fix|full_council]\n  evaluate [--prompt TEXT] --guideline TEXT [--guideline TEXT]\n  convert FILE [FILE...]\n  projects list|create [--name NAME] [--description TEXT]\n  memory list|search|context|write|activate|deactivate|delete [options]\n  usage\n  mcp [--transport stdio|http] [--host 127.0.0.1] [--port 3210]\n\nAuthentication:\n  Set CLARIFT_API_TOKEN. Optionally set CLARIFT_BASE_URL and CLARIFT_AGENT_NAME.\n  Memory writes require --yes and are audited.\n`);
}

async function main() {
  const [command = 'help', ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (command === 'help' || command === '--help' || command === '-h') {
    help();
    return;
  }
  if (command === 'mcp') {
    const client = createClient(args, 'mcp');
    const transport = option(args, 'transport') ?? 'stdio';
    if (transport === 'stdio') return startStdioMcp(client);
    if (transport !== 'http') throw new Error('--transport must be stdio or http.');
    const port = Number(option(args, 'port') ?? '3210');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be between 1 and 65535.');
    const host = option(args, 'host') ?? '127.0.0.1';
    if (!['127.0.0.1', 'localhost'].includes(host)) {
      throw new Error('The token-backed MCP HTTP bridge may only bind to 127.0.0.1 or localhost.');
    }
    return startHttpMcp(client, { host, port });
  }

  const client = createClient(args, 'cli');
  if (command === 'refine') {
    const prompt = option(args, 'prompt') ?? await stdinText();
    if (!prompt) throw new Error('Pass --prompt or pipe prompt text on stdin.');
    print(await client.refine({
      prompt,
      mode: option(args, 'mode') as RefinementMode | undefined,
      technique: option(args, 'technique') as ClariftTechnique | undefined,
      projectMemory: option(args, 'memory'),
      explanationMode: option(args, 'explain') === 'true' || undefined,
      maxCharacters: option(args, 'max-characters') ? Number(option(args, 'max-characters')) : undefined,
      idempotencyKey: option(args, 'idempotency-key'),
    }));
    return;
  }
  if (command === 'evaluate') {
    const prompt = option(args, 'prompt') ?? await stdinText();
    const guidelines = args.options.get('guideline') ?? [];
    if (!prompt || !guidelines.length) throw new Error('Provide a prompt and at least one --guideline.');
    print(await client.evaluate({ prompt, guidelines }));
    return;
  }
  if (command === 'convert') {
    if (!args.positionals.length) throw new Error('Provide at least one file path.');
    print(await client.convert(await Promise.all(args.positionals.map(async (path) => ({
      name: path.replace(/\\/g, '/').split('/').at(-1) ?? 'document',
      data: Uint8Array.from(await readFile(path)),
    })))));
    return;
  }
  if (command === 'projects') {
    const action = args.positionals[0] ?? 'list';
    if (action === 'list') return print(await client.listProjects(option(args, 'include-trashed') === 'true'));
    if (action === 'create') return print(await client.createProject({ name: requiredOption(args, 'name'), description: option(args, 'description') }));
    throw new Error('projects action must be list or create.');
  }
  if (command === 'memory') {
    const action = args.positionals[0] ?? 'list';
    if (action === 'list') return print(await client.listMemory(requiredOption(args, 'project'), { activeOnly: option(args, 'active-only') === 'true', limit: option(args, 'limit') ? Number(option(args, 'limit')) : undefined }));
    if (action === 'search') return print(await client.searchMemory({ query: requiredOption(args, 'query'), projectId: option(args, 'project'), activeOnly: option(args, 'include-inactive') !== 'true', limit: option(args, 'limit') ? Number(option(args, 'limit')) : undefined }));
    if (action === 'context') return print(await client.getActiveMemoryContext({ projectId: requiredOption(args, 'project'), query: requiredOption(args, 'query'), maxTokens: option(args, 'max-tokens') ? Number(option(args, 'max-tokens')) : undefined, topK: option(args, 'top-k') ? Number(option(args, 'top-k')) : undefined }));
    if (action === 'write') {
      if (option(args, 'yes') !== 'true') throw new Error('Memory writes require --yes to record explicit consent.');
      const content = option(args, 'content') ?? await stdinText();
      if (!content) throw new Error('Pass --content or pipe memory content on stdin.');
      return print(await client.createMemory(requiredOption(args, 'project'), { kind: option(args, 'kind') as ProjectMemoryKind | undefined, title: requiredOption(args, 'title'), content, sourceRef: option(args, 'source-ref'), consent: true }));
    }
    if (action === 'activate' || action === 'deactivate') {
      if (option(args, 'yes') !== 'true') throw new Error('Memory mutations require --yes to record explicit consent.');
      return print(await client.updateMemory(requiredOption(args, 'project'), requiredOption(args, 'entry'), { active: action === 'activate', consent: true }));
    }
    if (action === 'delete') {
      if (option(args, 'yes') !== 'true') throw new Error('Memory deletion requires --yes to record explicit consent.');
      return print(await client.deleteMemory(requiredOption(args, 'project'), requiredOption(args, 'entry'), true));
    }
    throw new Error('memory action must be list, search, context, write, activate, deactivate, or delete.');
  }
  if (command === 'usage') return print(await client.getUsage());
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  const code = error instanceof ClariftApiError ? `${error.code} (HTTP ${error.status})` : error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : 'Clarift command failed.';
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 1;
});
