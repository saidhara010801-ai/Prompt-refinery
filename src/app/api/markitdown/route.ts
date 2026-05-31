import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_MARKDOWN_CHARACTERS = 12000;
const SUPPORTED_EXTENSIONS = new Set([
  '.csv',
  '.docx',
  '.html',
  '.json',
  '.md',
  '.pdf',
  '.pptx',
  '.txt',
  '.xls',
  '.xlsx',
  '.xml',
  '.yaml',
  '.yml',
]);

function safeExtension(filename: string): string {
  const extension = extname(filename).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(extension) ? extension : '';
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Choose a file to convert.' }, { status: 400 });
  }

  const file = formData.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Choose a file to convert.' }, { status: 400 });
  }

  const extension = safeExtension(file.name);
  if (!extension) {
    return NextResponse.json({ error: 'This document type is not supported for Markdown conversion.' }, { status: 415 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'Files must be 10 MB or smaller.' }, { status: 413 });
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'prompt-refinery-'));
  const temporaryFile = join(temporaryDirectory, `upload${extension}`);

  try {
    await writeFile(temporaryFile, Buffer.from(await file.arrayBuffer()));

    const { stdout } = await execFileAsync(
      process.env.MARKITDOWN_COMMAND || 'markitdown',
      [temporaryFile],
      {
        maxBuffer: 2 * 1024 * 1024,
        timeout: 30000,
        windowsHide: true,
      }
    );

    return NextResponse.json({
      content: stdout.slice(0, MAX_MARKDOWN_CHARACTERS),
      truncated: stdout.length > MAX_MARKDOWN_CHARACTERS,
    });
  } catch (error) {
    console.error('MarkItDown conversion failed:', error);
    return NextResponse.json(
      {
        error: 'Document conversion is unavailable. Install MarkItDown on the app server or try a text-based file.',
      },
      { status: 503 }
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
