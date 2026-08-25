import { NextResponse } from 'next/server';
import { z } from 'zod';

import { authenticatePublicApi } from '@/lib/server/api-key-service';
import { createDeveloperMemory, listDeveloperMemory } from '@/lib/server/developer-project-service';
import { PROJECT_MEMORY_KINDS } from '@/lib/server/project-memory';
import { parsePublicApiJson, publicApiError } from '../../../_shared';

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const caller = await authenticatePublicApi(request, 'memory:read');
    const search = new URL(request.url).searchParams;
    return NextResponse.json({
      entries: await listDeveloperMemory(caller, (await context.params).projectId, {
        activeOnly: search.get('activeOnly') === 'true',
        limit: Number(search.get('limit')) || undefined,
      }),
    });
  } catch (error) {
    return publicApiError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const caller = await authenticatePublicApi(request, 'memory:write');
    const input = await parsePublicApiJson(request, z.object({
      kind: z.enum(PROJECT_MEMORY_KINDS).default('note'),
      title: z.string().trim().min(1).max(160),
      content: z.string().min(1).max(100000),
      sourceRef: z.string().max(200).nullable().optional(),
      consent: z.literal(true).optional(),
    }));
    return NextResponse.json(await createDeveloperMemory(request, caller, (await context.params).projectId, input), { status: 201 });
  } catch (error) {
    return publicApiError(error);
  }
}
