'use client';

import type { ChangeEvent } from 'react';
import { BookOpen, MessageSquareText, Paperclip, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormLabel } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { PROMPT_TEMPLATES } from '@/lib/constants';
import type { Project } from './project-types';
import type { RefinementAttachment } from './refinery-types';
import type { ProjectMemoryEntry } from './stage2-types';

interface RefineryContextControlsProps {
  selectedProject: Project | null;
  relevantMemoryEntries: ProjectMemoryEntry[];
  selectedMemoryIds: string[];
  onToggleMemory: (entryId: string) => void;
  selectedTemplateId: string;
  onTemplateChange: (templateId: string) => void;
  onLoadTemplate: () => void;
}

export function RefineryContextControls({
  selectedProject,
  relevantMemoryEntries,
  selectedMemoryIds,
  onToggleMemory,
  selectedTemplateId,
  onTemplateChange,
  onLoadTemplate,
}: RefineryContextControlsProps) {
  return (
    <>
      {selectedProject && relevantMemoryEntries.length > 0 && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-semibold">Relevant project memory</p>
          <div className="flex flex-wrap gap-2">
            {relevantMemoryEntries.map((entry) => {
              const selected = selectedMemoryIds.includes(entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  title={entry.content.slice(0, 500)}
                  onClick={() => onToggleMemory(entry.id)}
                  className={`rounded-full border px-3 py-1 text-xs ${selected ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground line-through'}`}
                >
                  {entry.title}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-3 rounded-md border bg-muted/40 p-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          <Label htmlFor="prompt-template">Prompt Template</Label>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            id="prompt-template"
            value={selectedTemplateId}
            onChange={(event) => onTemplateChange(event.target.value)}
            className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">Choose a starting point</option>
            {PROMPT_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
          <Button type="button" variant="outline" onClick={onLoadTemplate} disabled={!selectedTemplateId}>Load Template</Button>
        </div>
        {selectedTemplateId && (
          <p className="text-xs text-muted-foreground">{PROMPT_TEMPLATES.find((template) => template.id === selectedTemplateId)?.description}</p>
        )}
      </div>
    </>
  );
}

interface RefineryOptionsControlsProps {
  attachments: RefinementAttachment[];
  onAttachmentChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveAttachment: (name: string) => void;
  explanationMode: boolean;
  onExplanationModeChange: (enabled: boolean) => void;
  maxCharacters: string;
  onMaxCharactersChange: (value: string) => void;
}

export function RefineryOptionsControls({
  attachments,
  onAttachmentChange,
  onRemoveAttachment,
  explanationMode,
  onExplanationModeChange,
  maxCharacters,
  onMaxCharactersChange,
}: RefineryOptionsControlsProps) {
  return (
    <>
      <div className="space-y-3">
        <FormLabel htmlFor="attachment-upload">Reference Files</FormLabel>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" asChild>
            <label htmlFor="attachment-upload" className="cursor-pointer"><Paperclip className="h-4 w-4" />Add Files</label>
          </Button>
          <input
            id="attachment-upload"
            type="file"
            multiple
            accept=".txt,.md,.markdown,.csv,.json,.xml,.yaml,.yml,.log,.tsv,.pdf,.docx,.pptx,.xls,.xlsx,.html,.png,.jpg,.jpeg,.webp"
            onChange={onAttachmentChange}
            className="sr-only"
          />
          <span className="text-sm text-muted-foreground">Text and documents become context; images use Gemini Vision.</span>
        </div>
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <Badge key={attachment.name} variant="secondary" className="gap-1">
                <Paperclip className="h-3 w-3" />{attachment.name}
                <button type="button" onClick={() => onRemoveAttachment(attachment.name)} className="ml-1">
                  <X className="h-3 w-3" />
                  <span className="sr-only">Remove {attachment.name}</span>
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-start justify-between gap-4 rounded-md border p-3">
        <div className="space-y-1">
          <Label htmlFor="explanation-mode" className="flex items-center gap-2"><MessageSquareText className="h-4 w-4 text-primary" />Explanation Mode</Label>
          <p className="text-xs text-muted-foreground">Ask the council for clear, user-facing explanations of its refinement decisions.</p>
        </div>
        <Switch id="explanation-mode" checked={explanationMode} onCheckedChange={onExplanationModeChange} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="max-characters">Maximum Output Characters <span className="text-muted-foreground">(optional)</span></Label>
        <Input
          id="max-characters"
          type="number"
          min={100}
          max={50000}
          step={100}
          value={maxCharacters}
          onChange={(event) => onMaxCharactersChange(event.target.value)}
          placeholder="e.g., 2000"
        />
      </div>
    </>
  );
}
