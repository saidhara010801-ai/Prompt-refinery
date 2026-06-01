export const PROMPT_TECHNIQUES = [
  {
    value: 'Zero-shot',
    label: 'Zero-shot',
    description: 'Just instructions, no examples. Best for simple/common tasks, fast prototyping.',
  },
  {
    value: 'Few-shot',
    label: 'Few-shot',
    description: 'Add a few examples. Best for custom labels, formats, styles.',
  },
  {
    value: 'Chain-of-thought',
    label: 'Chain-of-thought',
    description: 'Show step-by-step reasoning. Best for math, logic, multi-step reasoning.',
  },
  {
    value: 'Tree-of-thoughts',
    label: 'Tree-of-thoughts',
    description: 'Explore multiple reasoning branches. Best for planning, search-like problems.',
  },
  {
    value: 'Role / persona',
    label: 'Role / persona',
    description: '“Act as X” role control. Best for tone/domain control, simulations.',
  },
  {
    value: 'Prompt chaining',
    label: 'Prompt chaining',
    description: 'Multi-prompt pipelines. Best for complex apps and workflows.',
  },
  {
    value: 'ReAct',
    label: 'ReAct',
    description: 'Interleave reasoning and tool use. Best for agents that call APIs/tools/databases.',
  },
  {
    value: 'Meta / reflection',
    label: 'Meta / reflection',
    description: 'Model reasons about its own process. Best for explanations, quality and safety refinement.',
  },
] as const;

export type PromptTechnique = (typeof PROMPT_TECHNIQUES)[number]['value'];

export const PROMPT_TEMPLATES = [
  {
    id: 'content-brief',
    name: 'Content brief',
    description: 'Plan a focused article for a defined audience.',
    promptType: 'Role / persona',
    prompt: `Act as a senior content strategist. Create a detailed content brief for an article about [topic].

Audience: [target audience]
Primary goal: [goal]
Tone: [tone]

Include a recommended title, search intent, key points, supporting evidence to gather, an outline, and a clear call to action.`,
  },
  {
    id: 'data-analysis',
    name: 'Data analysis',
    description: 'Turn a dataset question into a structured analysis request.',
    promptType: 'Zero-shot',
    prompt: `Analyze the provided dataset to answer: [business question].

Context: [describe the dataset and business decision]
Important fields: [list columns or metrics]

Return the key findings, notable trends, possible data-quality issues, and three recommended next actions. Use a concise table where useful.`,
  },
  {
    id: 'product-requirements',
    name: 'Product requirements',
    description: 'Draft a practical product feature specification.',
    promptType: 'Role / persona',
    prompt: `Act as a product manager. Draft a product requirements document for [feature].

User problem: [problem]
Target user: [user]
Constraints: [constraints]

Include goals, non-goals, user stories, acceptance criteria, edge cases, analytics events, and open questions.`,
  },
  {
    id: 'research-plan',
    name: 'Research plan',
    description: 'Build a clear research workflow with deliverables.',
    promptType: 'Few-shot',
    prompt: `Create a research plan for: [research question].

Audience: [audience]
Scope: [scope]
Deadline: [deadline]

Break the work into ordered steps. For each step, include the purpose, suggested sources, validation checks, and expected deliverable. End with a synthesis outline.`,
  },
  {
    id: 'code-review',
    name: 'Code review',
    description: 'Ask for a risk-focused engineering review.',
    promptType: 'Role / persona',
    prompt: `Act as a senior software engineer. Review the following code change for correctness and production risk.

Context: [describe the feature or bug fix]
Code: [paste code or attach files]

Prioritize bugs, security issues, regressions, and missing tests. List findings by severity with precise references, then summarize residual risk.`,
  },
] as const satisfies ReadonlyArray<{
  id: string;
  name: string;
  description: string;
  promptType: PromptTechnique;
  prompt: string;
}>;

export const LLM_COUNCIL_GUIDELINES = [
    { value: 'Be specific and provide context', label: 'Be specific and provide context' },
    { value: 'Use delimiters', label: 'Use delimiters' },
    { value: 'Specify the desired output format', label: 'Specify the desired output format' },
    { value: 'Provide examples (few-shot prompting)', label: 'Provide examples (few-shot)' },
    { value: 'Break down complex tasks into smaller steps', label: 'Break down complex tasks' },
    { value: 'Use a persona or role for the model', label: 'Use a persona/role' },
    { value: 'Check your assumptions', label: 'Check your assumptions' },
    { value: 'Iterate and refine', label: 'Iterate and refine' },
] as const;
  
export type LlmCouncilGuideline = (typeof LLM_COUNCIL_GUIDELINES)[number]['value'];
