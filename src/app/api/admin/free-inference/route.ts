import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { readFreeInferenceHealth, setFreeInferenceBeta } from '@/lib/server/admin-service';
import { adminJson } from '../_shared';

export async function GET(request: NextRequest) {
  return adminJson(() => readFreeInferenceHealth(request), request, 'admin.free_inference_health_read');
}

export async function POST(request: NextRequest) {
  return adminJson(async () => {
    const input = z.object({ uid: z.string().min(1).max(128), enabled: z.boolean() }).parse(await request.json());
    return setFreeInferenceBeta(request, input.uid, input.enabled);
  }, request, 'admin.free_inference_beta_change');
}
