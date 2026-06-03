export type OutputStyle = 'plain' | 'markdown' | 'json';

export function formatOutput(
  style: OutputStyle,
  prompt: string,
  originalPrompt?: string,
  promptType?: string
) {
  if (style === 'markdown') {
    return `# Refined Prompt\n\n${prompt}`;
  }

  if (style === 'json') {
    return JSON.stringify({
      promptType: promptType ?? null,
      originalPrompt: originalPrompt ?? null,
      refinedPrompt: prompt,
    }, null, 2);
  }

  return prompt;
}

