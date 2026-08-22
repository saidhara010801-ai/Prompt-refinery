'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { RefinedOutputPanel } from '@/components/prompt-refinery/refined-output-panel';
import type { PromptTechnique } from '@/lib/constants';
import { WorkspaceRefineryLayout, type RefinementModeOption } from './workspace-refinery-layout';
import { WorkspaceShell } from './workspace-shell';

const modeOptions: RefinementModeOption[] = [
  { value: 'quick_refine', label: 'Quick Refine', description: 'A focused pass for everyday prompts.', meta: '1 unit · 30 remain', disabled: false },
  { value: 'guided_fix', label: 'Guided Fix', description: 'Three expert passes for structure and critique.', meta: '2 units · 30 remain', disabled: false },
  { value: 'full_council', label: 'Full Council', description: 'Five specialist passes and a final synthesis.', meta: '3 units · 30 remain', disabled: false },
];

const refinedPrompt = `Act as a senior product strategist and UX researcher.

Task:
Create a release-readiness assessment for a prompt refinement workspace used by beta testers.

Include:
1. The five highest-impact usability risks, ordered by severity.
2. Evidence required to validate each risk.
3. A practical remediation with an owner and acceptance criterion.
4. A concise launch recommendation: proceed, limited canary, or hold.

Constraints:
- Preserve existing project memory and inference behavior.
- Distinguish observed evidence from assumptions.
- Use clear headings and a decision-ready summary.`;

export function WorkspaceV2Fixture() {
  const [mode, setMode] = useState<RefinementModeOption['value']>('guided_fix');
  const [template, setTemplate] = useState('');
  const [explanationMode, setExplanationMode] = useState(true);
  const [maxCharacters, setMaxCharacters] = useState('2000');
  const form = useForm<{ prompt: string; promptType: PromptTechnique }>({
    defaultValues: {
      prompt: 'Review my prompt-refinement workspace and tell me what must improve before beta release.',
      promptType: 'Role / persona',
    },
  });

  const output = (
    <RefinedOutputPanel
      variant="workspace-v2"
      modeLabel="Guided Fix"
      isLoading={false}
      refinedPrompt={refinedPrompt}
      rawPromptAtResult={form.getValues('prompt')}
      refinements={[
        { councilMember: 'The Specifier', thoughtProcess: 'Added audience, evidence, constraints, and a concrete decision format.', refinedText: refinedPrompt },
      ]}
      tokenCounts={{ gemini: 134, openai: 142, deepseek: 147, qwen: 149 }}
      isTokenizing={false}
      promptVersions={[
        { version: 1, rawPrompt: form.getValues('prompt'), refinedPrompt, promptType: 'Role / persona', createdAt: '2026-08-21T00:00:00.000Z' },
      ]}
      explanationMode
      promptType="Role / persona"
      canSave
      onSavePrompt={() => undefined}
    />
  );

  return (
    <WorkspaceShell
      activeDestination="refinery"
      onDestinationChange={() => undefined}
      isPro
      planLabel="Pro"
      savedPromptCount={12}
      savedPromptLimit={null}
      dailyUnits={30}
      monthlyUnits={600}
      availableCredits={10}
      reservedCredits={0}
      showAccountControls={false}
    >
      <div className="space-y-5">
        <div><h1 className="text-2xl font-semibold">Prompt workspace</h1><p className="mt-1 text-sm text-muted-foreground">Shape, compare, and save a stronger instruction.</p></div>
        <WorkspaceRefineryLayout
          form={form}
          onSubmit={() => undefined}
          selectedProject={null}
          projects={[]}
          isLoadingProjects={false}
          allowProjectSelection
          onSelectProject={() => undefined}
          onCreateProject={() => undefined}
          mode={mode}
          modeOptions={modeOptions}
          onModeChange={setMode}
          selectedTemplateId={template}
          onTemplateChange={setTemplate}
          onLoadTemplate={() => undefined}
          isPro
          relevantMemoryEntries={[]}
          selectedMemoryIds={[]}
          onToggleMemory={() => undefined}
          attachments={[]}
          onAttachmentChange={() => undefined}
          onRemoveAttachment={() => undefined}
          explanationMode={explanationMode}
          onExplanationModeChange={setExplanationMode}
          maxCharacters={maxCharacters}
          onMaxCharactersChange={setMaxCharacters}
          submitLabel="Refine · 2 units"
          submitDisabled={false}
          output={output}
        />
      </div>
    </WorkspaceShell>
  );
}
