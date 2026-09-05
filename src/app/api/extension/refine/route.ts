import { NextResponse } from 'next/server';
import { z } from 'zod';

import { executeRefinement } from '@/lib/server/ai-gateway';
import { authenticateExtension } from '@/lib/server/extension-auth-service';
import { extensionRefinementSchema, extensionProjectMemory } from '@/lib/server/extension-refinement';
import { ExtensionRequestSecurityError, readBoundedExtensionJson } from '@/lib/server/extension-request-security';
import { extensionCorsHeaders } from '../_shared';

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: extensionCorsHeaders }); }
export async function POST(request: Request) {
  try {
    if (process.env.ENABLE_EXTENSION_ACCOUNT_LINKING !== 'true') {
      return NextResponse.json({ error: { message: 'The Clarift extension is not enabled.' } }, { status: 503, headers: extensionCorsHeaders });
    }
    const caller = await authenticateExtension(request);
    const input = extensionRefinementSchema.parse(await readBoundedExtensionJson(request, 384 * 1024));
    const gateway = await executeRefinement({
      context: caller.context,
      task: input.mode,
      inferenceMode: 'managed',
      idempotencyKey: request.headers.get('idempotency-key') || `${caller.deviceId}:${Date.now()}`,
      source: 'extension',
      refinement: { prompt: input.prompt, promptType: input.technique, explanationMode: false, projectMemory: extensionProjectMemory(input.context) },
    });
    return NextResponse.json({
      contractVersion: 2,
      contextApplied: Boolean(input.context),
      refinedPrompt: gateway.result.refinedPrompt,
      requestId: gateway.requestId,
      creditsCharged: gateway.creditsCharged,
      qualityTier: gateway.qualityTier,
      allowance: gateway.allowance,
      basicMode: gateway.basicMode,
    }, { headers: { ...extensionCorsHeaders, 'X-Clarift-Contract-Version': '2' } });
  } catch (error) {
    const name = error instanceof Error ? error.name : 'ExtensionRequestError';
    const status = error instanceof ExtensionRequestSecurityError ? error.status : error instanceof z.ZodError ? 400 : name === 'ExtensionAuthenticationError' ? 401 : name === 'InsufficientCreditsError' ? 402 : name.includes('Limit') ? 429 : 502;
    return NextResponse.json({ error: { code: name, message: error instanceof Error ? error.message : 'Clarift could not refine this prompt.' } }, { status, headers: extensionCorsHeaders });
  }
}
