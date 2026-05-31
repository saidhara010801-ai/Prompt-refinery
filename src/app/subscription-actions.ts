'use server';

import { z } from 'zod';

import { deleteSavedPromptForUser, savePromptForUser } from '@/lib/server/account-service';

const promptVersionSchema = z.object({
  version: z.number().int().positive(),
  rawPrompt: z.string(),
  refinedPrompt: z.string(),
  promptType: z.string(),
  createdAt: z.string(),
});

const savePromptSchema = z.object({
  firebaseIdToken: z.string().min(1),
  prompt: z.object({
    name: z.string().min(1),
    originalPrompt: z.string().min(1),
    refinedPrompt: z.string().min(1),
    promptType: z.string().min(1),
    latestVersion: z.number().int().positive(),
    versionCount: z.number().int().positive(),
    versions: z.array(promptVersionSchema).min(1),
  }),
});

export async function savePromptAction(data: z.infer<typeof savePromptSchema>) {
  const parsed = savePromptSchema.parse(data);
  return savePromptForUser(parsed.firebaseIdToken, parsed.prompt);
}

export async function deleteSavedPromptAction(data: { firebaseIdToken: string; promptId: string }) {
  const parsed = z.object({
    firebaseIdToken: z.string().min(1),
    promptId: z.string().min(1),
  }).parse(data);

  return deleteSavedPromptForUser(parsed.firebaseIdToken, parsed.promptId);
}
