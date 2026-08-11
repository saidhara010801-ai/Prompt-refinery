import { NextResponse } from 'next/server';

import { consumeRequestLimit, getClientIp } from '@/lib/server/request-rate-limit';
import {
  convertBufferToMarkdown,
  MAX_REQUEST_BYTES,
  MAX_UPLOAD_BYTES,
  safeConversionExtension,
} from '@/lib/server/markitdown-converter';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const rateLimit = consumeRequestLimit({
    bucket: 'markitdown',
    key: getClientIp(request),
    limit: 10,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many conversion requests. Wait a minute and try again.' }, {
      status: 429,
      headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
    });
  }

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: 'Files must be 10 MB or smaller.' }, { status: 413 });
  }

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

  const extension = safeConversionExtension(file.name);
  if (!extension) {
    return NextResponse.json({ error: 'This document type is not supported for Markdown conversion.' }, { status: 415 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'Files must be 10 MB or smaller.' }, { status: 413 });
  }

  try {
    const result = await convertBufferToMarkdown({
      filename: file.name,
      contents: Buffer.from(await file.arrayBuffer()),
      markitdownCommand: process.env.MARKITDOWN_COMMAND,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('MarkItDown conversion failed:', error);
    return NextResponse.json(
      {
        error: 'Document conversion is unavailable. Install MarkItDown on the app server or try a text-based file.',
      },
      { status: 503 }
    );
  }
}
