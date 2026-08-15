import { NextRequest, NextResponse } from 'next/server';

function getRequestBaseUrl(request: NextRequest) {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'clarift.dpdns.org';
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

export function GET(request: NextRequest) {
  const baseUrl = getRequestBaseUrl(request);
  const body = [
    'User-Agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /extension/',
    'Disallow: /downloads/',
    '',
    `Host: ${baseUrl}`,
    `Sitemap: ${baseUrl}/sitemap.xml`,
    '',
  ].join('\n');

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300, must-revalidate',
    },
  });
}
