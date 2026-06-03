'use server';

import { z } from 'zod';

import {
  addProjectSessionForUser,
  createProjectForUser,
  deleteProjectForUser,
  updateProjectSessionResponseForUser,
} from '@/lib/server/account-service';
import {
  MAX_FIREBASE_ID_TOKEN_CHARACTERS,
  MAX_PROMPT_CHARACTERS,
  MAX_PROMPT_VERSIONS,
  MAX_REFINED_PROMPT_CHARACTERS,
} from '@/lib/input-limits';

const authenticatedProjectSchema = z.object({
  firebaseIdToken: z.string().min(1).max(MAX_FIREBASE_ID_TOKEN_CHARACTERS),
  projectId: z.string().min(1).max(200),
});

const promptVersionSchema = z.object({
  version: z.number().int().positive(),
  rawPrompt: z.string().min(1).max(MAX_PROMPT_CHARACTERS),
  refinedPrompt: z.string().min(1).max(MAX_REFINED_PROMPT_CHARACTERS),
  promptType: z.string().min(1).max(80),
  createdAt: z.string().min(1).max(80),
});

export async function createProjectAction(data: {
  firebaseIdToken: string;
  name: string;
  description: string;
}) {
  const parsed = z.object({
    firebaseIdToken: z.string().min(1),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000),
  }).parse(data);
  return createProjectForUser(parsed.firebaseIdToken, {
    name: parsed.name,
    description: parsed.description,
  });
}

export async function deleteProjectAction(data: z.infer<typeof authenticatedProjectSchema>) {
  const parsed = authenticatedProjectSchema.parse(data);
  return deleteProjectForUser(parsed.firebaseIdToken, parsed.projectId);
}

export async function addProjectSessionAction(data: {
  firebaseIdToken: string;
  projectId: string;
  session: {
    rawPrompt: string;
    refinedPrompt: string;
    promptType: string;
    version: number;
    versions: Array<z.infer<typeof promptVersionSchema>>;
  };
}) {
  const parsed = authenticatedProjectSchema.extend({
    session: z.object({
      rawPrompt: z.string().min(1).max(MAX_PROMPT_CHARACTERS),
      refinedPrompt: z.string().min(1).max(MAX_REFINED_PROMPT_CHARACTERS),
      promptType: z.string().min(1).max(80),
      version: z.number().int().positive(),
      versions: z.array(promptVersionSchema).min(1).max(MAX_PROMPT_VERSIONS),
    }),
  }).parse(data);
  return addProjectSessionForUser(parsed.firebaseIdToken, parsed.projectId, parsed.session);
}

export async function updateProjectSessionResponseAction(data: {
  firebaseIdToken: string;
  projectId: string;
  sessionId: string;
  llmResponse: string;
}) {
  const parsed = authenticatedProjectSchema.extend({
    sessionId: z.string().min(1).max(200),
    llmResponse: z.string().max(12000),
  }).parse(data);
  return updateProjectSessionResponseForUser(
    parsed.firebaseIdToken,
    parsed.projectId,
    parsed.sessionId,
    parsed.llmResponse
  );
}
