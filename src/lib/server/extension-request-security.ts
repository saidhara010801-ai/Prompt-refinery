import { consumeDistributedLimit } from './distributed-limits';
import { getClientIp } from './request-rate-limit';

export const MAX_EXTENSION_JSON_BYTES = 4 * 1024;

export class ExtensionRequestSecurityError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ExtensionRequestSecurityError';
  }
}

export async function readBoundedExtensionJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_EXTENSION_JSON_BYTES) {
    throw new ExtensionRequestSecurityError('The extension request is too large.', 413);
  }

  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_EXTENSION_JSON_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new ExtensionRequestSecurityError('The extension request is too large.', 413);
    }
    chunks.push(value);
  }

  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw new ExtensionRequestSecurityError('The extension request is invalid.', 400);
  }
}

export async function enforceExtensionRequestLimit(input: {
  request: Request;
  action: 'start' | 'exchange' | 'refresh';
  subject?: string;
}) {
  const policies = {
    start: { ipLimit: 8, subjectLimit: 0, windowMs: 60_000 },
    exchange: { ipLimit: 90, subjectLimit: 40, windowMs: 60_000 },
    refresh: { ipLimit: 20, subjectLimit: 5, windowMs: 60 * 60_000 },
  } as const;
  const policy = policies[input.action];
  const checks = [consumeDistributedLimit({
    bucket: `extension-${input.action}-ip`,
    key: getClientIp(input.request),
    limit: policy.ipLimit,
    windowMs: policy.windowMs,
  })];
  if (input.subject && policy.subjectLimit > 0) {
    checks.push(consumeDistributedLimit({
      bucket: `extension-${input.action}-subject`,
      key: input.subject,
      limit: policy.subjectLimit,
      windowMs: policy.windowMs,
    }));
  }
  const results = await Promise.all(checks);
  const rejected = results.find((result) => !result.allowed);
  if (rejected) {
    throw new ExtensionRequestSecurityError(
      'Too many extension requests. Wait a moment and try again.',
      429,
      Math.max(...results.map((result) => result.retryAfterSeconds)),
    );
  }
}
