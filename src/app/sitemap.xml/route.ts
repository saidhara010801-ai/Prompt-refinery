import { NextRequest, NextResponse } from 'next/server';

function getRequestBaseUrl(request: NextRequest) {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'clarift.dpdns.org';
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function GET(request: NextRequest) {
  const baseUrl = getRequestBaseUrl(request);
  const lastModified = new Date().toISOString();
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url>',
    `    <loc>${escapeXml(baseUrl)}</loc>`,
    `    <lastmod>${lastModified}</lastmod>`,
    '    <changefreq>weekly</changefreq>',
    '    <priority>1</priority>',
    '  </url>',
    '</urlset>',
    '',
  ].join('\n');

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, must-revalidate',
    },
  });
}
