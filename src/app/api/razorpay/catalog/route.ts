import { NextResponse } from 'next/server';

import { isRazorpayEnabled, publicRazorpayCatalog } from '@/lib/server/razorpay-billing';

export async function GET() {
  return NextResponse.json({ enabled: isRazorpayEnabled(), products: publicRazorpayCatalog() }, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
