import type { RefinePromptWithAICouncilOutput } from '@/ai/flows/refine-prompt-with-ai-council';
import type { BatchEvaluationOutput } from '@/ai/flows/evaluate-prompt-guidelines-batch';

type LocalRefinementMode = 'quick_refine' | 'guided_fix' | 'full_council';

interface LocalRefinementInput {
  prompt: string;
  promptType: string;
  executionMode: LocalRefinementMode;
  projectMemory?: string;
  explanationMode?: boolean;
  maxCharacters?: number;
  attachments?: Array<{ name: string; mimeType: string; content: string }>;
}

function clean(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

function clip(value: string, limit: number) {
  const normalized = clean(value);
  if (normalized.length <= limit) return normalized;
  const candidate = normalized.slice(0, Math.max(0, limit - 3));
  const boundary = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf('. '), candidate.lastIndexOf(' '));
  return `${candidate.slice(0, boundary > limit * 0.65 ? boundary : candidate.length).trimEnd()}...`;
}

function techniqueInstructions(promptType: string) {
  switch (promptType) {
    case 'Few-shot':
      return ['Use any examples supplied in the task as the pattern to follow.', 'If examples are absent, state the assumptions used instead of inventing source facts.'];
    case 'Chain-of-thought':
      return ['Work through the task methodically.', 'Provide a concise rationale or verification summary without exposing hidden internal reasoning.'];
    case 'Tree-of-thoughts':
      return ['Consider multiple viable approaches.', 'Compare the strongest options against the requirements before selecting the final approach.'];
    case 'Role / persona':
      return ['Adopt the professional role most appropriate to the task.', 'Match terminology, depth, and tone to the intended audience.'];
    case 'Prompt chaining':
      return ['Complete the task in ordered stages.', 'Use each stage output as input to the next and finish with one consolidated result.'];
    case 'ReAct':
      return ['Plan the next useful action, use available tools only when needed, and observe each result before continuing.', 'Do not claim a tool result that was not actually obtained.'];
    case 'Meta / reflection':
      return ['Create a first pass, check it against every requirement, and revise once.', 'Return the revised result rather than a narration of the review.'];
    default:
      return ['Complete the task directly from the supplied information.', 'State any important assumption that materially affects the answer.'];
  }
}

function referenceContext(input: LocalRefinementInput) {
  const sections: string[] = [];
  if (input.projectMemory?.trim()) sections.push(`Project context:\n${clip(input.projectMemory, 2200)}`);
  if (input.attachments?.length) {
    const remaining = input.attachments.slice(0, 5).map((attachment) =>
      `${attachment.name} (${attachment.mimeType}):\n${clip(attachment.content, 900)}`
    );
    sections.push(`Reference material:\n${remaining.join('\n\n')}`);
  }
  return sections;
}

function buildPrompt(input: LocalRefinementInput, focus: 'specifier' | 'simplifier' | 'stylist' | 'critic' | 'formatter') {
  const method = techniqueInstructions(input.promptType);
  const focusInstructions = {
    specifier: ['Preserve the original intent while making scope, constraints, and success criteria explicit.'],
    simplifier: ['Break complex work into a short, ordered sequence of executable steps.'],
    stylist: ['Use a professional tone and a format that is easy for the intended audience to scan.'],
    critic: ['Check for ambiguity, unsupported claims, missing inputs, contradictions, and likely failure modes before answering.'],
    formatter: ['Return a complete, copy-ready answer with concise headings or bullets where they improve readability.'],
  }[focus];
  const sections = [
    'Act as the domain expert best suited to the task below.',
    `Task:\n"""\n${clean(input.prompt)}\n"""`,
    ...referenceContext(input),
    `Method:\n${[...method, ...focusInstructions].map((item, index) => `${index + 1}. ${item}`).join('\n')}`,
    'Output requirements:\n- Produce the requested deliverable, not advice about how to produce it.\n- Keep facts traceable to the supplied information; clearly label uncertainty.\n- Follow explicit constraints in the task over these general instructions.\n- Make the result actionable and self-contained.',
  ];
  let result = sections.join('\n\n');
  if (input.maxCharacters && result.length > input.maxCharacters) {
    const compact = `Task:\n${clean(input.prompt)}\n\nInstructions:\n${[...method, ...focusInstructions].map((item) => `- ${item}`).join('\n')}\n- Return a complete, accurate, actionable result.\n- State material assumptions and follow the requested output format.`;
    result = clip(compact, input.maxCharacters);
  }
  return result;
}

export function refinePromptLocally(input: LocalRefinementInput): RefinePromptWithAICouncilOutput {
  const roles = input.executionMode === 'quick_refine'
    ? ['specifier'] as const
    : input.executionMode === 'guided_fix'
      ? ['specifier', 'simplifier', 'critic'] as const
      : ['specifier', 'simplifier', 'stylist', 'critic', 'formatter'] as const;
  const labels = {
    specifier: ['Structured Specifier', 'Made the task, constraints, and success criteria explicit.'],
    simplifier: ['Structured Simplifier', 'Turned complex work into an ordered, executable method.'],
    stylist: ['Structured Stylist', 'Added audience-aware tone and readable output guidance.'],
    critic: ['Structured Critic', 'Added checks for ambiguity, unsupported claims, and missing inputs.'],
    formatter: ['Structured Formatter', 'Produced a copy-ready structure with clear output requirements.'],
  } as const;
  const refinements = roles.map((role) => ({
    councilMember: `${labels[role][0]} (Clarift beta fallback)`,
    thoughtProcess: labels[role][1],
    refinedText: buildPrompt(input, role),
  }));
  return {
    refinedPrompt: buildPrompt(input, input.executionMode === 'quick_refine' ? 'specifier' : input.executionMode === 'guided_fix' ? 'critic' : 'formatter'),
    refinements,
  };
}

function boundedScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function evaluatePromptLocally(promptValue: string, guidelines: string[]): BatchEvaluationOutput {
  const prompt = clean(promptValue);
  const words = prompt.split(/\s+/).filter(Boolean);
  const hasStructure = /(^|\n)\s*(?:[-*]|\d+[.)]|#{1,3})\s/m.test(prompt);
  const hasContext = /\b(context|background|audience|purpose|goal|because|for\s+(?:a|an|the))\b/i.test(prompt);
  const hasFormat = /\b(format|json|table|bullet|heading|markdown|list|schema|template|length|words?|characters?)\b/i.test(prompt);
  const hasSpecificity = /\b\d+\b|\bmust\b|\bshould\b|\binclude\b|\bexclude\b|\bexactly\b/i.test(prompt);
  const dimensions = {
    clarity: boundedScore(38 + Math.min(words.length, 70) * 0.55 + (/[.!?]$/.test(prompt) ? 8 : 0)),
    context: boundedScore(32 + (hasContext ? 34 : 0) + Math.min(words.length, 100) * 0.18),
    structure: boundedScore(35 + (hasStructure ? 35 : 0) + (hasFormat ? 18 : 0)),
    specificity: boundedScore(34 + (hasSpecificity ? 35 : 0) + (hasFormat ? 15 : 0)),
  };
  const results = guidelines.map((guideline) => {
    const recommendations: string[] = [];
    if (dimensions.clarity < 70) recommendations.push('State the primary task as one direct sentence.');
    if (dimensions.context < 70) recommendations.push('Add the audience, relevant background, and intended use of the result.');
    if (dimensions.structure < 70) recommendations.push('Specify an output structure such as headings, bullets, a table, or JSON.');
    if (dimensions.specificity < 70) recommendations.push('Add measurable constraints, required inclusions, and exclusions.');
    const guidelineTerms = guideline.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 5);
    const overlap = guidelineTerms.some((word) => prompt.toLowerCase().includes(word));
    const score = boundedScore((dimensions.clarity + dimensions.context + dimensions.structure + dimensions.specificity) / 4 + (overlap ? 5 : -3));
    return {
      guideline,
      shouldInclude: score < 85,
      reason: overlap
        ? 'The prompt addresses this guideline, but the score reflects how explicitly and operationally it is stated.'
        : 'The prompt does not explicitly address the main terms in this guideline; add a concrete requirement if it is relevant.',
      score,
      dimensionScores: dimensions,
      recommendations: recommendations.slice(0, 4),
    };
  });
  return {
    combinedScore: boundedScore(results.reduce((sum, result) => sum + result.score, 0) / results.length),
    results,
  };
}
