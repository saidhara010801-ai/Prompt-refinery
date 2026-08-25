import { NextResponse } from 'next/server';
import { z } from 'zod';

import { authenticatePublicApi } from '@/lib/server/api-key-service';
import { deleteDeveloperMemory, updateDeveloperMemory } from '@/lib/server/developer-project-service';
import { parsePublicApiJson, publicApiError } from '../../../../_shared';

type RouteContext = { params: Promise<{ projectId: string; entryId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const caller = await authenticatePublicApi(request, 'memory:write');
    const input = await parsePublicApiJson(request, z.object({
      title: z.string().trim().min(1).max(160).optional(),
      content: z.string().min(1).max(100000).optional(),
      active: z.boolean().optional(),
      consent: z.literal(true).optional(),
    }).refine((value) => value.title !== undefined || value.content !== undefined || value.active !== undefined));
    const params = await context.params;
    return NextResponse.json(await updateDeveloperMemory(request, caller, params.projectId, params.entryId, input));
  } catch (error) {
    return publicApiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const caller = await authenticatePublicApi(request, 'memory:write');
    let consent = request.headers.get('x-clarift-write-consent')?.toLowerCase() === 'true';
    if (!consent) {
      try {
        consent = z.object({ consent: z.literal(true) }).parse(await request.json()).consent;
      } catch {
        consent = false;
      }
    }
    const params = await context.params;
    return NextResponse.json(await deleteDeveloperMemory(request, caller, params.projectId, params.entryId, consent));
  } catch (error) {
    return publicApiError(error);
  }
}
