import { NextResponse } from 'next/server';

import { processRazorpayWebhook } from '@/lib/server/razorpay-billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 1024 * 1024) return NextResponse.json({ error: { message: 'Webhook rejected.' } }, { status: 413 });
  const rawBody = await request.text();
  if (rawBody.length > 1024 * 1024) return NextResponse.json({ error: { message: 'Webhook rejected.' } }, { status: 413 });
  try {
    const result = await processRazorpayWebhook(
      rawBody,
      request.headers.get('x-razorpay-signature') || '',
      request.headers.get('x-razorpay-event-id') || ''
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('Razorpay webhook failed.', { name: error instanceof Error ? error.name : 'UnknownError' });
    return NextResponse.json({ error: { message: 'Webhook rejected.' } }, {
      status: error instanceof Error && error.name === 'RazorpaySignatureError' ? 400 : 500,
    });
  }
}
