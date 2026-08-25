import { NextResponse } from 'next/server';
import { z } from 'zod';

import { authenticatePublicApi } from '@/lib/server/api-key-service';
import { getDeveloperProject, updateDeveloperProject } from '@/lib/server/developer-project-service';
import { parsePublicApiJson, publicApiError } from '../../_shared';

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const caller = await authenticatePublicApi(request, 'projects:read');
    return NextResponse.json(await getDeveloperProject(caller, (await context.params).projectId));
  } catch (error) {
    return publicApiError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const caller = await authenticatePublicApi(request, 'projects:write');
    const input = await parsePublicApiJson(request, z.object({
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().trim().max(2000).optional(),
      status: z.enum(['active', 'trashed']).optional(),
    }).refine((value) => Object.keys(value).length > 0));
    return NextResponse.json(await updateDeveloperProject(caller, (await context.params).projectId, input));
  } catch (error) {
    return publicApiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const caller = await authenticatePublicApi(request, 'projects:write');
    return NextResponse.json(await updateDeveloperProject(caller, (await context.params).projectId, { status: 'trashed' }));
  } catch (error) {
    return publicApiError(error);
  }
}
