export interface ProjectSession {
  id: string;
  projectId: string;
  rawPrompt: string;
  refinedPrompt: string;
  promptType: string;
  version?: number;
  versions?: Array<{
    version: number;
    rawPrompt: string;
    refinedPrompt: string;
    promptType: string;
    createdAt: string;
  }>;
  llmResponse?: string;
  timestamp?: {
    seconds: number;
    nanoseconds: number;
  };
}

export interface ProjectMemorySearchResult {
  id: string;
  projectId: string;
  title: string;
  kind: string;
  snippet: string;
}

export function formatProjectDate(timestamp?: { seconds: number }) {
  if (!timestamp?.seconds) {
    return 'Just now';
  }

  return new Date(timestamp.seconds * 1000).toLocaleDateString();
}

export function getProjectChatTitle(session: ProjectSession) {
  return session.rawPrompt.length > 54
    ? `${session.rawPrompt.slice(0, 54)}...`
    : session.rawPrompt;
}
