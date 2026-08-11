import { NextResponse } from 'next/server';
import { z } from 'zod';

import { updateSharedContent } from '@/lib/server/sharing-service';
import { AuthorizationError } from '@/lib/server/user-access';

export async function PATCH(request: Request, { params }: { params: Promise<{ shareId: string }> }) {
  try {
    const input = z.object({ originalPrompt: z.string().max(60000).optional(), refinedPrompt: z.string().max(60000).optional(), title: z.string().max(160).optional(), content: z.string().max(100000).optional() }).parse(await request.json());
    return NextResponse.json(await updateSharedContent(request, (await params).shareId, input));
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : 'Could not update shared content.' } }, { status: error instanceof AuthorizationError ? error.status : 400 });
  }
}
