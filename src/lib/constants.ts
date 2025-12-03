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
