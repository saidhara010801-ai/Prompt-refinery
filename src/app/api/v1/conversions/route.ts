import { NextResponse } from 'next/server';

import { authenticatePublicApi } from '@/lib/server/api-key-service';
import { convertBufferToMarkdown, MAX_BATCH_FILES, MAX_BATCH_REQUEST_BYTES, MAX_MERGED_MARKDOWN_CHARACTERS, MAX_UPLOAD_BYTES, safeConversionExtension } from '@/lib/server/markitdown-converter';
import { recordUsageEvent } from '@/lib/server/usage-analytics';
import { analyzeMarkdownStructure, buildConversionWarnings, estimateTokenCounts } from '@/lib/stage2-utils';
import { AuthorizationError } from '@/lib/server/user-access';
import { publicApiError } from '../_shared';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { uid } = await authenticatePublicApi(request);
    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_BATCH_REQUEST_BYTES) throw new AuthorizationError('Conversion requests must be 25 MB or smaller.', 413, 'ApiPayloadTooLargeError');
    const form = await request.formData();
    const files = form.getAll('files').filter((value): value is File => value instanceof File);
    if (!files.length || files.length > MAX_BATCH_FILES) throw new AuthorizationError(`Submit between 1 and ${MAX_BATCH_FILES} files using the files field.`, 400, 'ApiValidationError');
    if (files.reduce((total, file) => total + file.size, 0) > MAX_BATCH_REQUEST_BYTES) throw new AuthorizationError('Conversion requests must be 25 MB or smaller.', 413, 'ApiPayloadTooLargeError');
    const documents = [];
    for (const file of files) {
      if (!safeConversionExtension(file.name) || file.size > MAX_UPLOAD_BYTES) throw new AuthorizationError(`${file.name} is unsupported or exceeds 10 MB.`, 400, 'ApiValidationError');
      const converted = await convertBufferToMarkdown({ filename: file.name, contents: Buffer.from(await file.arrayBuffer()), markitdownCommand: process.env.MARKITDOWN_COMMAND });
      documents.push({ sourceName: file.name, content: converted.content, truncated: converted.truncated, tokenCounts: estimateTokenCounts(converted.content), warnings: buildConversionWarnings(file.name, converted.content, file.size), structure: analyzeMarkdownStructure(converted.content) });
    }
    const merged = documents.map((document) => `# ${document.sourceName}\n\n${document.content}`).join('\n\n---\n\n');
    await recordUsageEvent(uid, { kind: 'conversion', itemCount: documents.length, source: 'api' }).catch(() => undefined);
    return NextResponse.json({ documents, mergedContent: merged.slice(0, MAX_MERGED_MARKDOWN_CHARACTERS), mergedTruncated: merged.length > MAX_MERGED_MARKDOWN_CHARACTERS });
  } catch (error) { return publicApiError(error); }
}
