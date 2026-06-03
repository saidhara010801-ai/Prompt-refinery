interface RateLimitOptions {
  bucket: string;
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const MAX_RATE_LIMIT_ENTRIES = 1000;

const globalForRateLimits = globalThis as typeof globalThis & {
  promptRefineryRateLimits?: Map<string, RateLimitEntry>;
};

const rateLimits = globalForRateLimits.promptRefineryRateLimits ?? new Map<string, RateLimitEntry>();
globalForRateLimits.promptRefineryRateLimits = rateLimits;

function pruneRateLimits(now: number) {
  for (const [key, entry] of rateLimits) {
    if (entry.resetAt <= now) {
      rateLimits.delete(key);
    }
  }

  while (rateLimits.size >= MAX_RATE_LIMIT_ENTRIES) {
    const oldestKey = rateLimits.keys().next().value;
    if (!oldestKey) {
      return;
    }
    rateLimits.delete(oldestKey);
  }
}

export function getClientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
}

export function consumeRequestLimit({
  bucket,
  key,
  limit,
  windowMs,
  now = Date.now(),
}: RateLimitOptions): RateLimitResult {
  pruneRateLimits(now);

  const mapKey = `${bucket}:${key}`;
  const existing = rateLimits.get(mapKey);
  const entry = !existing || existing.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : existing;

  entry.count += 1;
  rateLimits.set(mapKey, entry);

  return {
    allowed: entry.count <= limit,
    remaining: Math.max(limit - entry.count, 0),
    retryAfterSeconds: Math.max(Math.ceil((entry.resetAt - now) / 1000), 1),
  };
}

export function clearRequestRateLimitsForTests() {
  rateLimits.clear();
}

export function getRequestRateLimitEntryCountForTests() {
  return rateLimits.size;
}
