import { NextResponse } from 'next/server';
import { z } from 'zod';

import { executeRefinement } from '@/lib/server/ai-gateway';
import { authenticatePublicApi } from '@/lib/server/api-key-service';
import { parsePublicApiJson, publicApiError } from '../_shared';

const schema = z.object({
  prompt: z.string().min(1).max(60000),
  technique: z.enum(['Zero-shot', 'Few-shot', 'Chain-of-thought', 'Tree-of-thoughts', 'Role / persona', 'Prompt chaining', 'ReAct', 'Meta / reflection']).default('Zero-shot'),
  projectMemory: z.string().max(100000).optional(),
  explanationMode: z.boolean().optional(),
  maxCharacters: z.number().int().min(100).max(60000).optional(),
  mode: z.enum(['quick_refine', 'guided_fix', 'full_council']).default('quick_refine'),
  idempotencyKey: z.string().min(8).max(200).optional(),
});

export async function POST(request: Request) {
  try {
    const caller = await authenticatePublicApi(request, 'refinements:write');
    const input = await parsePublicApiJson(request, schema);
    const gateway = await executeRefinement({
      context: caller.context,
      task: input.mode,
      inferenceMode: 'managed',
      idempotencyKey: input.idempotencyKey || request.headers.get('idempotency-key') || `${caller.keyId}:${Date.now()}`,
      source: request.headers.get('x-clarift-client') === 'extension' ? 'extension' : 'api',
      refinement: {
        prompt: input.prompt,
        promptType: input.technique,
        projectMemory: input.projectMemory,
        explanationMode: input.explanationMode,
        maxCharacters: input.maxCharacters,
      },
    });
    return NextResponse.json({
      ...gateway.result,
      contractVersion: 2,
      requestId: gateway.requestId,
      creditsCharged: gateway.creditsCharged,
      qualityTier: gateway.qualityTier,
      allowance: gateway.allowance,
      basicMode: gateway.basicMode,
    }, { headers: { 'X-Clarift-Contract-Version': '2' } });
  } catch (error) { return publicApiError(error); }
}
