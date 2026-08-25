import { NextResponse } from 'next/server';

import { buildClariftOpenApiDocument } from '@/lib/clarift-openapi';

export async function GET(request: Request) {
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim();
  const origin = configuredBaseUrl ? new URL(configuredBaseUrl).origin : new URL(request.url).origin;
  return NextResponse.json(buildClariftOpenApiDocument(origin), {
    headers: { 'Cache-Control': 'public, max-age=300, must-revalidate' },
  });
}
