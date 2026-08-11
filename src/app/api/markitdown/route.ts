import { NextResponse } from 'next/server';

import { consumeRequestLimit, getClientIp } from '@/lib/server/request-rate-limit';
import {
  convertBufferToMarkdown,
  isMarkitdownRuntimeUnavailableError,
  MAX_BATCH_FILES,
  MAX_BATCH_REQUEST_BYTES,
  MAX_MERGED_MARKDOWN_CHARACTERS,
  MAX_UPLOAD_BYTES,
  safeConversionExtension,
} from '@/lib/server/markitdown-converter';
import { analyzeMarkdownStructure, buildConversionWarnings, estimateTokenCounts } from '@/lib/stage2-utils';
import { assertProFeatureAccess } from '@/lib/server/account-service';
import { getBearerTokenFromRequest } from '@/lib/server/user-access';
import { recordUsageEventFromToken } from '@/lib/server/usage-analytics';

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
  if (Number.isFinite(contentLength) && contentLength > MAX_BATCH_REQUEST_BYTES) {
    return NextResponse.json({ error: 'Conversion requests must be 25 MB or smaller.' }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Choose a file to convert.' }, { status: 400 });
  }

  const legacyFile = formData.get('file');
  const batchFiles = formData.getAll('files').filter((value): value is File => value instanceof File);
  const files = batchFiles.length > 0
    ? batchFiles
    : legacyFile instanceof File ? [legacyFile] : [];

  if (files.length === 0) {
    return NextResponse.json({ error: 'Choose a file to convert.' }, { status: 400 });
  }

  if (files.length > MAX_BATCH_FILES) {
    return NextResponse.json({ error: `Convert up to ${MAX_BATCH_FILES} files at a time.` }, { status: 400 });
  }

  if (files.length > 1) {
    try {
      await assertProFeatureAccess(getBearerTokenFromRequest(request), 'Batch conversion is available on Pro.');
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Batch conversion is available on Pro.' }, { status: 403 });
    }
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > MAX_BATCH_REQUEST_BYTES) {
    return NextResponse.json({ error: 'The selected files exceed the 25 MB batch limit.' }, { status: 413 });
  }

  for (const file of files) {
    if (!safeConversionExtension(file.name)) {
      return NextResponse.json({ error: `${file.name} is not a supported document type.` }, { status: 415 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: `${file.name} is larger than 10 MB.` }, { status: 413 });
    }
  }

  try {
    const documents = [];
    for (const file of files) {
      const result = await convertBufferToMarkdown({
        filename: file.name,
        contents: Buffer.from(await file.arrayBuffer()),
        markitdownCommand: process.env.MARKITDOWN_COMMAND,
      });
      documents.push({
        id: crypto.randomUUID(),
        sourceName: file.name,
        mimeType: file.type || 'application/octet-stream',
        content: result.content,
        truncated: result.truncated,
        tokenCounts: estimateTokenCounts(result.content),
        warnings: buildConversionWarnings(file.name, result.content, file.size),
        structure: analyzeMarkdownStructure(result.content),
      });
    }
    await recordUsageEventFromToken(getBearerTokenFromRequest(request), { kind: 'conversion', itemCount: documents.length });

    if (batchFiles.length === 0 && documents.length === 1) {
      return NextResponse.json({
        content: documents[0].content,
        truncated: documents[0].truncated,
        warnings: documents[0].warnings,
        tokenCounts: documents[0].tokenCounts,
        structure: documents[0].structure,
      });
    }

    const completeMergedContent = documents
      .map((document) => `# ${document.sourceName}\n\n${document.content}`)
      .join('\n\n---\n\n');
    return NextResponse.json({
      documents,
      mergedContent: completeMergedContent.slice(0, MAX_MERGED_MARKDOWN_CHARACTERS),
      mergedTruncated: completeMergedContent.length > MAX_MERGED_MARKDOWN_CHARACTERS,
    });
  } catch (error) {
    console.error('MarkItDown conversion failed:', error);
    if (isMarkitdownRuntimeUnavailableError(error)) {
      return NextResponse.json(
        {
          error: 'Document conversion is temporarily unavailable. Try again shortly or use a text-based file.',
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        error: 'Clarift could not read this document. Check that the file is valid and not password protected.',
      },
      { status: 422 }
    );
  }
}
