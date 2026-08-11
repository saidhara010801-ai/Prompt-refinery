export function estimateTokenCounts(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return { gemini: 0, openai: 0, deepseek: 0, qwen: 0 };
  }

  const segments = trimmed.match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
  const base = Math.max(1, Math.round((Math.ceil(trimmed.length / 4) + Math.ceil(segments.length * 1.25)) / 2));
  return {
    gemini: base,
    openai: Math.round(base * 1.05),
    deepseek: Math.round(base * 1.08),
    qwen: Math.round(base * 1.1),
  };
}

export function analyzeMarkdownStructure(content: string) {
  return {
    headings: (content.match(/^#{1,6}\s+/gm) ?? []).length,
    tables: Math.floor((content.match(/^\|.*\|\s*$/gm) ?? []).length / 2),
    listItems: (content.match(/^\s*(?:[-*+] |\d+\. )/gm) ?? []).length,
  };
}

export function normalizedSearchTerms(...values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 80)));
}

export function buildConversionWarnings(filename: string, content: string, fileSize: number): string[] {
  const visibleCharacters = content.replace(/\s/g, '').length;
  if (filename.toLowerCase().endsWith('.pdf') && (visibleCharacters < 80 || visibleCharacters < fileSize / 20000)) {
    return ['Low text-extraction confidence. This PDF may be scanned or image-based; verify it against the original preview.'];
  }
  return [];
}
