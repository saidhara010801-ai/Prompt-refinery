import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 11 * 1024 * 1024;
export const MAX_MARKDOWN_CHARACTERS = 12000;

const SUPPORTED_EXTENSIONS = new Set([
  '.csv',
  '.docx',
  '.htm',
  '.html',
  '.json',
  '.log',
  '.markdown',
  '.md',
  '.pdf',
  '.pptx',
  '.tsv',
  '.txt',
  '.xls',
  '.xlsx',
  '.xml',
  '.yaml',
  '.yml',
]);

const TEXT_FALLBACK_EXTENSIONS = new Set([
  '.csv',
  '.htm',
  '.html',
  '.json',
  '.log',
  '.markdown',
  '.md',
  '.tsv',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

export function safeConversionExtension(filename: string): string {
  const extension = extname(filename).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(extension) ? extension : '';
}

export function canConvertWithTextFallback(filename: string): boolean {
  return TEXT_FALLBACK_EXTENSIONS.has(safeConversionExtension(filename));
}

export function parseMarkitdownCommand(commandValue?: string) {
  const source = commandValue?.trim() || 'markitdown';
  const tokens = source.match(/"[^"]+"|'[^']+'|\S+/g)?.map((token) => {
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      return token.slice(1, -1);
    }
    return token;
  }) ?? [];

  return {
    command: tokens[0] || 'markitdown',
    args: tokens.slice(1),
  };
}

function truncateMarkdown(content: string) {
  return {
    content: content.slice(0, MAX_MARKDOWN_CHARACTERS),
    truncated: content.length > MAX_MARKDOWN_CHARACTERS,
  };
}

function decodeText(contents: Buffer): string {
  return contents.toString('utf8').replace(/^\uFEFF/, '');
}

function escapeFence(content: string): string {
  return content.replace(/```/g, '``\u200b`');
}

function parseDelimitedLine(line: string, separator: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"' && inQuotes && nextCharacter === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === separator && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  values.push(current.trim());
  return values;
}

function toMarkdownTable(text: string, separator: string): string {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((line) => parseDelimitedLine(line, separator));

  if (rows.length === 0) {
    return '';
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? ''));
  const escapeCell = (cell: string) => cell.replace(/\|/g, '\\|');
  const header = normalizedRows[0].map(escapeCell);
  const body = normalizedRows.slice(1).map((row) => `| ${row.map(escapeCell).join(' | ')} |`);

  return [
    `| ${header.join(' | ')} |`,
    `| ${Array.from({ length: columnCount }, () => '---').join(' | ')} |`,
    ...body,
  ].join('\n');
}

function htmlToMarkdownText(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|div|section|article|header|footer|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function convertTextLikeBufferToMarkdown(filename: string, contents: Buffer) {
  const extension = safeConversionExtension(filename);
  const text = decodeText(contents);

  if (extension === '.csv') {
    return truncateMarkdown(toMarkdownTable(text, ','));
  }

  if (extension === '.tsv') {
    return truncateMarkdown(toMarkdownTable(text, '\t'));
  }

  if (extension === '.json') {
    try {
      return truncateMarkdown(`\`\`\`json\n${escapeFence(JSON.stringify(JSON.parse(text), null, 2))}\n\`\`\``);
    } catch {
      return truncateMarkdown(`\`\`\`json\n${escapeFence(text)}\n\`\`\``);
    }
  }

  if (extension === '.xml') {
    return truncateMarkdown(`\`\`\`xml\n${escapeFence(text)}\n\`\`\``);
  }

  if (extension === '.yaml' || extension === '.yml') {
    return truncateMarkdown(`\`\`\`yaml\n${escapeFence(text)}\n\`\`\``);
  }

  if (extension === '.htm' || extension === '.html') {
    return truncateMarkdown(htmlToMarkdownText(text));
  }

  return truncateMarkdown(text);
}

export async function convertBufferToMarkdown(input: {
  filename: string;
  contents: Buffer;
  markitdownCommand?: string;
}) {
  const extension = safeConversionExtension(input.filename);
  if (!extension) {
    throw new Error('This document type is not supported for Markdown conversion.');
  }

  if (canConvertWithTextFallback(input.filename)) {
    return convertTextLikeBufferToMarkdown(input.filename, input.contents);
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'clarift-converter-'));
  const temporaryFile = join(temporaryDirectory, `upload${extension}`);

  try {
    await writeFile(temporaryFile, input.contents);
    const parsedCommand = parseMarkitdownCommand(input.markitdownCommand);
    const { stdout } = await execFileAsync(
      parsedCommand.command,
      [...parsedCommand.args, temporaryFile],
      {
        maxBuffer: 2 * 1024 * 1024,
        timeout: 30000,
        windowsHide: true,
      }
    );

    return truncateMarkdown(stdout);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
