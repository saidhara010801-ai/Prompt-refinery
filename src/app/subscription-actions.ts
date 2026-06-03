'use server';

import { z } from 'zod';

import { deleteSavedPromptForUser, savePromptForUser } from '@/lib/server/account-service';
import {
  MAX_FIREBASE_ID_TOKEN_CHARACTERS,
  MAX_PROMPT_CHARACTERS,
  MAX_PROMPT_VERSIONS,
  MAX_REFINED_PROMPT_CHARACTERS,
} from '@/lib/input-limits';

const promptVersionSchema = z.object({
  version: z.number().int().positive(),
  rawPrompt: z.string().max(MAX_PROMPT_CHARACTERS),
  refinedPrompt: z.string().max(MAX_REFINED_PROMPT_CHARACTERS),
  promptType: z.string().max(80),
  createdAt: z.string().max(80),
});

const savePromptSchema = z.object({
  firebaseIdToken: z.string().min(1).max(MAX_FIREBASE_ID_TOKEN_CHARACTERS),
  prompt: z.object({
    name: z.string().min(1).max(160),
    originalPrompt: z.string().min(1).max(MAX_PROMPT_CHARACTERS),
    refinedPrompt: z.string().min(1).max(MAX_REFINED_PROMPT_CHARACTERS),
    promptType: z.string().min(1).max(80),
    latestVersion: z.number().int().positive(),
    versionCount: z.number().int().positive(),
    versions: z.array(promptVersionSchema).min(1).max(MAX_PROMPT_VERSIONS),
  }),
});

export async function savePromptAction(data: z.infer<typeof savePromptSchema>) {
  const parsed = savePromptSchema.parse(data);
  return savePromptForUser(parsed.firebaseIdToken, parsed.prompt);
}

export async function deleteSavedPromptAction(data: { firebaseIdToken: string; promptId: string }) {
  const parsed = z.object({
    firebaseIdToken: z.string().min(1).max(MAX_FIREBASE_ID_TOKEN_CHARACTERS),
    promptId: z.string().min(1).max(200),
  }).parse(data);

  return deleteSavedPromptForUser(parsed.firebaseIdToken, parsed.promptId);
}
