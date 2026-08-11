'use server';

import { z } from 'zod';

import {
  addProjectSessionForUser,
  createProjectForUser,
  deleteProjectForUser,
  createProjectMemoryEntryForUser,
  deleteProjectMemoryEntryForUser,
  permanentlyDeleteProjectForUser,
  restoreProjectForUser,
  searchProjectMemoryForUser,
  updateProjectMemoryEntryForUser,
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
  templateId?: string;
}) {
  const parsed = z.object({
    firebaseIdToken: z.string().min(1),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000),
    templateId: z.string().trim().max(80).optional(),
  }).parse(data);
  return createProjectForUser(parsed.firebaseIdToken, {
    name: parsed.name,
    description: parsed.description,
    templateId: parsed.templateId,
  });
}

export async function restoreProjectAction(data: z.infer<typeof authenticatedProjectSchema>) {
  const parsed = authenticatedProjectSchema.parse(data);
  return restoreProjectForUser(parsed.firebaseIdToken, parsed.projectId);
}

export async function permanentlyDeleteProjectAction(data: z.infer<typeof authenticatedProjectSchema>) {
  const parsed = authenticatedProjectSchema.parse(data);
  return permanentlyDeleteProjectForUser(parsed.firebaseIdToken, parsed.projectId);
}

const memoryEntrySchema = authenticatedProjectSchema.extend({
  entryId: z.string().min(1).max(200).optional(),
  kind: z.enum(['refinement', 'response', 'converter', 'note', 'evaluation']).optional(),
  title: z.string().trim().min(1).max(160).optional(),
  content: z.string().max(100000).optional(),
  active: z.boolean().optional(),
  sourceRef: z.string().max(200).nullable().optional(),
});

export async function createProjectMemoryEntryAction(data: z.infer<typeof memoryEntrySchema>) {
  const parsed = memoryEntrySchema.extend({
    kind: z.enum(['refinement', 'response', 'converter', 'note', 'evaluation']),
    title: z.string().trim().min(1).max(160),
    content: z.string().min(1).max(100000),
  }).parse(data);
  return createProjectMemoryEntryForUser(parsed.firebaseIdToken, parsed.projectId, {
    kind: parsed.kind,
    title: parsed.title,
    content: parsed.content,
    sourceRef: parsed.sourceRef,
  });
}

export async function updateProjectMemoryEntryAction(data: z.infer<typeof memoryEntrySchema>) {
  const parsed = memoryEntrySchema.extend({ entryId: z.string().min(1).max(200) }).parse(data);
  return updateProjectMemoryEntryForUser(parsed.firebaseIdToken, parsed.projectId, parsed.entryId, {
    title: parsed.title,
    content: parsed.content,
    active: parsed.active,
  });
}

export async function deleteProjectMemoryEntryAction(data: z.infer<typeof memoryEntrySchema>) {
  const parsed = memoryEntrySchema.extend({ entryId: z.string().min(1).max(200) }).parse(data);
  return deleteProjectMemoryEntryForUser(parsed.firebaseIdToken, parsed.projectId, parsed.entryId);
}

export async function searchProjectMemoryAction(data: { firebaseIdToken: string; search: string }) {
  const parsed = z.object({
    firebaseIdToken: z.string().min(1).max(MAX_FIREBASE_ID_TOKEN_CHARACTERS),
    search: z.string().trim().min(2).max(160),
  }).parse(data);
  return searchProjectMemoryForUser(parsed.firebaseIdToken, parsed.search);
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
