export interface Refinement {
  councilMember: string;
  thoughtProcess: string;
  refinedText: string;
}

export interface TokenCounts {
  gemini: number;
  openai: number;
  deepseek: number;
  qwen: number;
}

export interface RefinementAttachment {
  name: string;
  mimeType: string;
  content: string;
  dataUri?: string;
}

export interface PromptVersion {
  version: number;
  rawPrompt: string;
  refinedPrompt: string;
  promptType: string;
  createdAt: string;
}
