import { NextResponse } from 'next/server';
import { z } from 'zod';

import { authenticatePublicApi } from '@/lib/server/api-key-service';
import { createDeveloperProject, listDeveloperProjects } from '@/lib/server/developer-project-service';
import { parsePublicApiJson, publicApiError } from '../_shared';

export async function GET(request: Request) {
  try {
    const caller = await authenticatePublicApi(request, 'projects:read');
    const includeTrashed = new URL(request.url).searchParams.get('includeTrashed') === 'true';
    return NextResponse.json({ projects: await listDeveloperProjects(caller, includeTrashed) });
  } catch (error) {
    return publicApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const caller = await authenticatePublicApi(request, 'projects:write');
    const input = await parsePublicApiJson(request, z.object({
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(2000).optional(),
    }));
    return NextResponse.json(await createDeveloperProject(caller, input), { status: 201 });
  } catch (error) {
    return publicApiError(error);
  }
}
