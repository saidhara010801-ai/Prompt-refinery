import { NextResponse } from 'next/server';
import { z } from 'zod';

import { authenticatePublicApi } from '@/lib/server/api-key-service';
import { searchDeveloperMemory } from '@/lib/server/developer-project-service';
import { parsePublicApiJson, publicApiError } from '../../_shared';

export async function POST(request: Request) {
  try {
    const caller = await authenticatePublicApi(request, 'memory:read');
    const input = await parsePublicApiJson(request, z.object({
      query: z.string().trim().min(2).max(160),
      projectId: z.string().min(1).max(200).optional(),
      activeOnly: z.boolean().default(true),
      limit: z.number().int().min(1).max(50).default(20),
    }));
    return NextResponse.json({ entries: await searchDeveloperMemory(caller, input) });
  } catch (error) {
    return publicApiError(error);
  }
}
