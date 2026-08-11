import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createResourceShare, listResourceShares, revokeResourceShare } from '@/lib/server/sharing-service';
import { AuthorizationError } from '@/lib/server/user-access';

const resourceType = z.enum(['project', 'savedPrompt']);

function errorResponse(error: unknown) {
  const status = error instanceof AuthorizationError ? error.status : error instanceof Error && (error.name === 'ProFeatureRequiredError' || error.name === 'ShareEditorRequiredError') ? 403 : error instanceof Error && error.name === 'ShareRecipientNotFoundError' ? 404 : 400;
  return NextResponse.json({ error: { message: error instanceof Error ? error.message : 'Sharing request failed.' } }, { status });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = z.object({ resourceType, resourceId: z.string().min(1).max(200) }).parse({ resourceType: url.searchParams.get('resourceType'), resourceId: url.searchParams.get('resourceId') });
    return NextResponse.json({ shares: await listResourceShares(request, parsed.resourceType, parsed.resourceId) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = z.object({ resourceType, resourceId: z.string().min(1).max(200), recipientEmail: z.string().email().max(320), permission: z.enum(['viewer', 'editor']) }).parse(await request.json());
    return NextResponse.json({ share: await createResourceShare(request, parsed) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const parsed = z.object({ shareId: z.string().min(1).max(800) }).parse(await request.json());
    return NextResponse.json(await revokeResourceShare(request, parsed.shareId));
  } catch (error) { return errorResponse(error); }
}
