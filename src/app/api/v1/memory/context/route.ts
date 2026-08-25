import { NextResponse } from 'next/server';
import { z } from 'zod';

import { authenticatePublicApi } from '@/lib/server/api-key-service';
import { getActiveHybridMemoryContext } from '@/lib/server/hybrid-memory-service';
import { parsePublicApiJson, publicApiError } from '../../_shared';

export async function POST(request: Request) {
  try {
    const caller = await authenticatePublicApi(request, 'memory:read');
    const input = await parsePublicApiJson(request, z.object({
      projectId: z.string().min(1).max(200),
      query: z.string().trim().min(2).max(2000),
      maxTokens: z.number().int().min(200).max(12000).default(3000),
      topK: z.number().int().min(1).max(20).default(8),
    }));
    return NextResponse.json(await getActiveHybridMemoryContext(caller, input));
  } catch (error) {
    return publicApiError(error);
  }
}
