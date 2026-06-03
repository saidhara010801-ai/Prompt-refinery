import { NextResponse } from 'next/server';

import { getRuntimeReadiness } from '@/lib/server/runtime-readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const readiness = getRuntimeReadiness(process.env);
  const requireReady = new URL(request.url).searchParams.get('ready') === '1';

  return NextResponse.json({
    service: 'prompt-refinery',
    status: readiness.ready ? 'ok' : 'degraded',
    checks: readiness.checks,
  }, {
    status: requireReady && !readiness.ready ? 503 : 200,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

