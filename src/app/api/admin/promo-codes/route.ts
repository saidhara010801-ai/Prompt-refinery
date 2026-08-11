import { NextRequest } from 'next/server';
import { z } from 'zod';

import { adminJson } from '../_shared';
import { createPromoCode, listPromoCodes } from '@/lib/server/promo-service';

export async function GET(request: NextRequest) {
  return adminJson(() => listPromoCodes(request), request, 'admin.promo_list');
}

export async function POST(request: NextRequest) {
  return adminJson(async () => {
    const body = z.object({
      mode: z.enum(['single', 'limited', 'unlimited']),
      maxRedemptions: z.number().int().min(2).max(10000).nullable().optional(),
      label: z.string().trim().max(120).optional(),
    }).parse(await request.json());
    return createPromoCode(request, body);
  }, request, 'admin.promo_create');
}
