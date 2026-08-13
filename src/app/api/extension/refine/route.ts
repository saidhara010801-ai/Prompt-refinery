import { NextResponse } from 'next/server';
import { z } from 'zod';

import { executeRefinement } from '@/lib/server/ai-gateway';
import { authenticateExtension } from '@/lib/server/extension-auth-service';
import { extensionCorsHeaders } from '../_shared';

const schema = z.object({
  prompt: z.string().min(1).max(60000),
  technique: z.enum(['Zero-shot', 'Few-shot', 'Chain-of-thought', 'Tree-of-thoughts', 'Role / persona', 'Prompt chaining', 'ReAct', 'Meta / reflection']).default('Zero-shot'),
  mode: z.enum(['quick_refine', 'guided_fix', 'full_council']).default('quick_refine'),
});

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: extensionCorsHeaders }); }
export async function POST(request: Request) {
  try {
    if (process.env.ENABLE_EXTENSION_ACCOUNT_LINKING !== 'true') {
      return NextResponse.json({ error: { message: 'The Clarift extension is not enabled.' } }, { status: 503, headers: extensionCorsHeaders });
    }
    const caller = await authenticateExtension(request);
    const input = schema.parse(await request.json());
    const gateway = await executeRefinement({
      context: caller.context,
      task: input.mode,
      inferenceMode: 'managed',
      idempotencyKey: request.headers.get('idempotency-key') || `${caller.deviceId}:${Date.now()}`,
      source: 'extension',
      refinement: { prompt: input.prompt, promptType: input.technique, explanationMode: false },
    });
    return NextResponse.json({
      contractVersion: 2,
      refinedPrompt: gateway.result.refinedPrompt,
      requestId: gateway.requestId,
      creditsCharged: gateway.creditsCharged,
      qualityTier: gateway.qualityTier,
      allowance: gateway.allowance,
      basicMode: gateway.basicMode,
    }, { headers: { ...extensionCorsHeaders, 'X-Clarift-Contract-Version': '2' } });
  } catch (error) {
    const name = error instanceof Error ? error.name : 'ExtensionRequestError';
    const status = name === 'ExtensionAuthenticationError' ? 401 : name === 'InsufficientCreditsError' ? 402 : name.includes('Limit') ? 429 : 502;
    return NextResponse.json({ error: { code: name, message: error instanceof Error ? error.message : 'Clarift could not refine this prompt.' } }, { status, headers: extensionCorsHeaders });
  }
}
