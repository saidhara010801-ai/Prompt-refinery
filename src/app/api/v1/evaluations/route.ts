import { NextResponse } from 'next/server';
import { z } from 'zod';

import { evaluatePromptGuidelinesBatch } from '@/ai/flows/evaluate-prompt-guidelines-batch';
import { authenticatePublicApi, getCallerProvider } from '@/lib/server/api-key-service';
import { AuthorizationError } from '@/lib/server/user-access';
import { recordUsageEvent } from '@/lib/server/usage-analytics';
import { publicApiError } from '../_shared';

const schema = z.object({ prompt: z.string().min(1).max(60000), guidelines: z.array(z.string().min(1).max(8000)).min(1).max(8) });

export async function POST(request: Request) {
  try {
    const [{ uid }, caller, input] = await Promise.all([authenticatePublicApi(request), Promise.resolve(getCallerProvider(request)), request.json().then((body) => schema.parse(body))]);
    if (caller.provider !== 'gemini') throw new AuthorizationError('Evaluation currently supports Gemini provider keys.', 400, 'ApiValidationError');
    const result = await evaluatePromptGuidelinesBatch({ prompt: input.prompt, guidelines: input.guidelines, apiKey: caller.providerApiKey });
    await recordUsageEvent(uid, { kind: 'evaluation', score: result.combinedScore, provider: caller.provider, source: 'api' }).catch(() => undefined);
    return NextResponse.json(result);
  } catch (error) { return publicApiError(error); }
}
