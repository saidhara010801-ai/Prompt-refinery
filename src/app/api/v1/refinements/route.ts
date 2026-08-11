import { NextResponse } from 'next/server';
import { z } from 'zod';

import { refinePromptWithAICouncil } from '@/ai/flows/refine-prompt-with-ai-council';
import { authenticatePublicApi, getCallerProvider } from '@/lib/server/api-key-service';
import { recordUsageEvent } from '@/lib/server/usage-analytics';
import { parsePublicApiJson, publicApiError } from '../_shared';

const schema = z.object({
  prompt: z.string().min(1).max(60000),
  technique: z.enum(['Zero-shot', 'Few-shot', 'Chain-of-thought', 'Tree-of-thoughts', 'Role / persona', 'Prompt chaining', 'ReAct', 'Meta / reflection']).default('Zero-shot'),
  projectMemory: z.string().max(100000).optional(),
  explanationMode: z.boolean().optional(),
  maxCharacters: z.number().int().min(100).max(60000).optional(),
  models: z.object({ specifier: z.string(), simplifier: z.string(), stylist: z.string(), critic: z.string().optional(), formatter: z.string().optional() }).optional(),
});

export async function POST(request: Request) {
  try {
    const { uid } = await authenticatePublicApi(request);
    const caller = getCallerProvider(request);
    const input = await parsePublicApiJson(request, schema);
    const result = await refinePromptWithAICouncil({
      prompt: input.prompt,
      promptType: input.technique,
      provider: caller.provider,
      apiKey: caller.provider === 'gemini' ? caller.providerApiKey : undefined,
      openRouterApiKey: caller.provider === 'openrouter' ? caller.providerApiKey : undefined,
      openRouterModels: caller.provider === 'openrouter' ? input.models : undefined,
      projectMemory: input.projectMemory,
      explanationMode: input.explanationMode,
      maxCharacters: input.maxCharacters,
    });
    await recordUsageEvent(uid, { kind: 'refinement', technique: input.technique, provider: caller.provider, source: request.headers.get('x-clarift-client') === 'extension' ? 'extension' : 'api' }).catch(() => undefined);
    return NextResponse.json(result);
  } catch (error) { return publicApiError(error); }
}
