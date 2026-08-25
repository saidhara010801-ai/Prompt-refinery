import { NextResponse } from 'next/server';

import { buildClariftOpenApiDocument } from '@/lib/clarift-openapi';

export async function GET(request: Request) {
  return NextResponse.json(buildClariftOpenApiDocument(new URL(request.url).origin), {
    headers: { 'Cache-Control': 'public, max-age=300, must-revalidate' },
  });
}
