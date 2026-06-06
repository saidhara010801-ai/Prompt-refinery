import { NextResponse } from 'next/server';

import { auditUnauthorizedAdminAttempt } from '@/lib/server/admin-service';
import { consumeRequestLimit, getClientIp } from '@/lib/server/request-rate-limit';
import { AuthorizationError } from '@/lib/server/user-access';

function getAdminRateLimit(action: string): { limit: number; windowMs: number } {
  const configuredLimit = Number(process.env.ADMIN_RATE_LIMIT_MAX_REQUESTS);
  const defaultReadLimit = Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : 20;
  const minute = 60 * 1000;

  if (action === 'admin.pro_grant' || action === 'admin.pro_revoke' || action === 'admin.account_status_change') {
    return { limit: Math.min(defaultReadLimit, 10), windowMs: 60 * minute };
  }

  if (action === 'admin.user_search' || action === 'admin.audit_log_read') {
    return { limit: Math.min(defaultReadLimit, 15), windowMs: 5 * minute };
  }

  return { limit: defaultReadLimit, windowMs: 5 * minute };
}

export function getAdminRateLimitForTests(action: string) {
  return getAdminRateLimit(action);
}

export async function adminJson(handler: () => Promise<unknown>, request: Request, action: string) {
  if (process.env.ENABLE_ADMIN_CENTER === 'false') {
    return NextResponse.json({ error: { message: 'Admin center is disabled.' } }, { status: 503 });
  }

  const rateLimitPolicy = getAdminRateLimit(action);
  const rateLimit = consumeRequestLimit({
    bucket: `admin:${action}`,
    key: getClientIp(request),
    limit: rateLimitPolicy.limit,
    windowMs: rateLimitPolicy.windowMs,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: { message: 'Too many admin requests. Wait a while and retry.' } },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
    );
  }

  try {
    return NextResponse.json(await handler(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      await auditUnauthorizedAdminAttempt(request, action, error);
      return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    }

    console.error(`Admin API failed: ${action}`, error);
    return NextResponse.json({ error: { message: 'Admin request failed.' } }, { status: 500 });
  }
}
