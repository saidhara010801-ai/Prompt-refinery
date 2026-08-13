import { NextResponse } from 'next/server';
import { z } from 'zod';

import { executeEvaluation } from '@/lib/server/ai-gateway';
import { authenticatePublicApi } from '@/lib/server/api-key-service';
import { parsePublicApiJson, publicApiError } from '../_shared';

const schema = z.object({ prompt: z.string().min(1).max(60000), guidelines: z.array(z.string().min(1).max(8000)).min(1).max(8) });

export async function POST(request: Request) {
  try {
    const caller = await authenticatePublicApi(request, 'evaluations:write');
    const input = await parsePublicApiJson(request, schema);
    const gateway = await executeEvaluation({
      context: caller.context,
      task: 'evaluate',
      inferenceMode: 'managed',
      idempotencyKey: request.headers.get('idempotency-key') || `${caller.keyId}:evaluation:${Date.now()}`,
      source: 'api',
      prompt: input.prompt,
      guidelines: input.guidelines,
    });
    return NextResponse.json({ ...gateway.result, requestId: gateway.requestId, creditsCharged: gateway.creditsCharged, provider: gateway.provider });
  } catch (error) { return publicApiError(error); }
}
