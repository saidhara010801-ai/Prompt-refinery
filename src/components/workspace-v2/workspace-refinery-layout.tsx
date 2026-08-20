'use client';

import { type ChangeEvent, type ReactNode, useEffect, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import {
  Check,
  Eraser,
  FileText,
  FolderPlus,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Paperclip,
  Sparkles,
  X,
} from 'lucide-react';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { PROMPT_TECHNIQUES, PROMPT_TEMPLATES, type PromptTechnique } from '@/lib/constants';
import { isFreeTechnique } from '@/lib/subscription';
import { cn } from '@/lib/utils';
import type { Project } from '@/components/prompt-refinery/project-types';
import type { RefinementAttachment } from '@/components/prompt-refinery/refinery-types';
import type { ProjectMemoryEntry } from '@/components/prompt-refinery/stage2-types';

const NO_PROJECT_VALUE = '__no_project__';

type RefineryFormValues = { prompt: string; promptType: PromptTechnique };

export interface RefinementModeOption {
  value: 'quick_refine' | 'guided_fix' | 'full_council';
  label: string;
  description: string;
  meta: string;
  disabled: boolean;
  title?: string;
}

interface WorkspaceRefineryLayoutProps {
  form: UseFormReturn<RefineryFormValues>;
  onSubmit: (values: RefineryFormValues) => void | Promise<void>;
  selectedProject: Project | null;
  projects: Project[];
  isLoadingProjects: boolean;
  allowProjectSelection: boolean;
  onSelectProject?: (project: Project | null) => void;
  onCreateProject?: () => void;
  mode: RefinementModeOption['value'];
  modeOptions: RefinementModeOption[];
  onModeChange: (mode: RefinementModeOption['value']) => void;
  selectedTemplateId: string;
  onTemplateChange: (templateId: string) => void;
  onLoadTemplate: () => void;
  isPro: boolean;
  relevantMemoryEntries: ProjectMemoryEntry[];
  selectedMemoryIds: string[];
  onToggleMemory: (entryId: string) => void;
  attachments: RefinementAttachment[];
  onAttachmentChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveAttachment: (name: string) => void;
  explanationMode: boolean;
  onExplanationModeChange: (enabled: boolean) => void;
  maxCharacters: string;
  onMaxCharactersChange: (value: string) => void;
  submitLabel: string;
  submitDisabled: boolean;
  output: ReactNode;
}

function useKeyboardOpen() {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setKeyboardOpen(window.innerHeight - viewport.height > 140);
    update();
    viewport.addEventListener('resize', update);
    return () => viewport.removeEventListener('resize', update);
  }, []);

  return keyboardOpen;
}

function TemplatePicker({ selectedTemplateId, onTemplateChange, onLoadTemplate }: Pick<WorkspaceRefineryLayoutProps, 'selectedTemplateId' | 'onTemplateChange' | 'onLoadTemplate'>) {
  const selected = PROMPT_TEMPLATES.find((template) => template.id === selectedTemplateId);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3"><Label htmlFor="workspace-template">Template</Label><span className="text-xs text-muted-foreground">Optional starting point</span></div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={selectedTemplateId || '__none__'} onValueChange={(value) => onTemplateChange(value === '__none__' ? '' : value)}>
          <SelectTrigger id="workspace-template" className="min-h-11 flex-1"><SelectValue placeholder="Choose a template" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No template</SelectItem>
            {PROMPT_TEMPLATES.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" className="min-h-11" onClick={onLoadTemplate} disabled={!selectedTemplateId}>Load</Button>
      </div>
      {selected && <p className="text-xs text-muted-foreground">{selected.description}</p>}
    </div>
  );
}

function TechniqueCards({ form, isPro }: Pick<WorkspaceRefineryLayoutProps, 'form' | 'isPro'>) {
  const value = form.watch('promptType');
  return (
    <FormField
      control={form.control}
      name="promptType"
      render={({ field }) => (
        <FormItem>
          <RadioGroup value={field.value} onValueChange={field.onChange} className="grid gap-2 md:grid-cols-2">
            {PROMPT_TECHNIQUES.map((tech) => {
              const disabled = !isPro && !isFreeTechnique(tech.value);
              return (
                <Label
                  key={tech.value}
                  htmlFor={`workspace-technique-${tech.value}`}
                  className={cn(
                    'flex min-h-24 cursor-pointer items-start gap-3 rounded-md border bg-card p-3 transition-colors duration-150 hover:bg-muted/45',
                    value === tech.value && 'border-primary bg-primary/5 ring-1 ring-primary/30',
                    disabled && 'cursor-not-allowed opacity-45'
                  )}
                >
                  <RadioGroupItem id={`workspace-technique-${tech.value}`} value={tech.value} disabled={disabled} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 font-medium">{tech.label}{disabled && <Badge variant="outline">Pro</Badge>}</span>
                    <span className="mt-1 line-clamp-2 text-xs font-normal text-muted-foreground">{tech.description}</span>
                    <span className="mt-2 block text-xs font-normal text-foreground/75">Best for: {tech.example.replace(/^Example:\s*/i, '')}</span>
                  </span>
                </Label>
              );
            })}
          </RadioGroup>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function ReferenceFiles({ attachments, onAttachmentChange, onRemoveAttachment, inputId }: Pick<WorkspaceRefineryLayoutProps, 'attachments' | 'onAttachmentChange' | 'onRemoveAttachment'> & { inputId: string }) {
  return (
    <div className="space-y-3">
      <Button type="button" variant="outline" asChild className="min-h-24 w-full border-dashed">
        <label htmlFor={inputId} className="flex cursor-pointer flex-col gap-2">
          <Paperclip className="h-5 w-5 text-primary" />
          <span>Add reference files</span>
          <span className="text-xs font-normal text-muted-foreground">PDF, documents, data, text, or images up to 10 MB</span>
        </label>
      </Button>
      <input
        id={inputId}
        type="file"
        multiple
        accept=".txt,.md,.markdown,.csv,.json,.xml,.yaml,.yml,.log,.tsv,.pdf,.docx,.pptx,.xls,.xlsx,.html,.png,.jpg,.jpeg,.webp"
        onChange={onAttachmentChange}
        className="sr-only"
      />
      {attachments.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {attachments.map((attachment) => (
            <div key={attachment.name} className="flex min-w-0 items-center gap-3 rounded-md border bg-card p-3">
              <FileText className="h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{attachment.name}</p><p className="truncate text-xs text-muted-foreground">{attachment.mimeType || 'Document'}</p></div>
              <Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => onRemoveAttachment(attachment.name)}>
                <X className="h-4 w-4" /><span className="sr-only">Remove {attachment.name}</span>
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdvancedOptions({ explanationMode, onExplanationModeChange, maxCharacters, onMaxCharactersChange }: Pick<WorkspaceRefineryLayoutProps, 'explanationMode' | 'onExplanationModeChange' | 'maxCharacters' | 'onMaxCharactersChange'>) {
  return (
    <Accordion type="single" collapsible className="rounded-md border px-4">
      <AccordionItem value="advanced" className="border-0">
        <AccordionTrigger>Advanced options</AccordionTrigger>
        <AccordionContent className="space-y-5 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div><Label htmlFor="workspace-explanation" className="flex items-center gap-2"><MessageSquareText className="h-4 w-4 text-primary" />Explanation mode</Label><p className="mt-1 text-xs text-muted-foreground">Include clear, user-facing explanations of the refinement decisions.</p></div>
            <Switch id="workspace-explanation" checked={explanationMode} onCheckedChange={onExplanationModeChange} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="workspace-output-limit">Maximum output characters</Label>
            <Input id="workspace-output-limit" type="number" min={100} max={50000} step={100} value={maxCharacters} onChange={(event) => onMaxCharactersChange(event.target.value)} placeholder="No custom limit" />
            <p className="text-xs text-muted-foreground">Optional. Use 100 to 50,000 characters.</p>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export function WorkspaceRefineryLayout({
  form,
  onSubmit,
  selectedProject,
  projects,
  isLoadingProjects,
  allowProjectSelection,
  onSelectProject,
  onCreateProject,
  mode,
  modeOptions,
  onModeChange,
  selectedTemplateId,
  onTemplateChange,
  onLoadTemplate,
  isPro,
  relevantMemoryEntries,
  selectedMemoryIds,
  onToggleMemory,
  attachments,
  onAttachmentChange,
  onRemoveAttachment,
  explanationMode,
  onExplanationModeChange,
  maxCharacters,
  onMaxCharactersChange,
  submitLabel,
  submitDisabled,
  output,
}: WorkspaceRefineryLayoutProps) {
  const [expandedPrompt, setExpandedPrompt] = useState(false);
  const keyboardOpen = useKeyboardOpen();
  const prompt = form.watch('prompt');

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid max-w-[1600px] gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:items-start">
        <div className="contents xl:block xl:space-y-5">
          <Card className="order-1 border-primary/25 xl:order-none">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-lg"><Sparkles className="h-5 w-5 text-primary" />Configure refinement</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {allowProjectSelection && onSelectProject && (
                <div className="order-1 space-y-2">
                  <div className="flex items-center justify-between gap-3"><Label htmlFor="workspace-project">Project</Label>{onCreateProject && <Button type="button" variant="ghost" size="sm" onClick={onCreateProject}><FolderPlus className="h-4 w-4" />Create project</Button>}</div>
                  <Select value={selectedProject?.id ?? NO_PROJECT_VALUE} onValueChange={(projectId) => onSelectProject(projectId === NO_PROJECT_VALUE ? null : projects.find((project) => project.id === projectId) ?? null)} disabled={isLoadingProjects}>
                    <SelectTrigger id="workspace-project" className="min-h-11"><SelectValue placeholder="Choose a project" /></SelectTrigger>
                    <SelectContent><SelectItem value={NO_PROJECT_VALUE}>No project</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}

              <FormField
                control={form.control}
                name="prompt"
                render={({ field }) => (
                  <FormItem className="order-2 md:order-4">
                    <div className="flex items-center justify-between gap-3">
                      <FormLabel>Your prompt</FormLabel>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span>{field.value.length.toLocaleString()} characters</span>
                        <Button type="button" variant="ghost" size="icon" className="h-10 w-10" onClick={() => form.setValue('prompt', '')}><Eraser className="h-4 w-4" /><span className="sr-only">Clear prompt</span></Button>
                        <Button type="button" variant="ghost" size="icon" className="h-10 w-10" onClick={() => setExpandedPrompt((current) => !current)}>{expandedPrompt ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}<span className="sr-only">{expandedPrompt ? 'Collapse' : 'Expand'} prompt editor</span></Button>
                      </div>
                    </div>
                    <FormControl>
                      <Textarea
                        placeholder="Describe the result you need, the audience, constraints, and preferred format."
                        className={cn('min-h-[180px] resize-y font-code text-base placeholder:text-muted-foreground/90 md:min-h-[240px] xl:min-h-[320px]', expandedPrompt && 'min-h-[55vh]')}
                        {...field}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">Clarift keeps the original intent while making scope, context, and success criteria explicit.</p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="order-3 space-y-2 md:order-2">
                <Label>Refinement mode</Label>
                <div className="grid grid-cols-3 gap-1 rounded-md border bg-muted/50 p-1 md:gap-2 md:border-0 md:bg-transparent md:p-0">
                  {modeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      disabled={option.disabled}
                      title={option.title}
                      onClick={() => onModeChange(option.value)}
                      className={cn(
                        'relative min-h-11 rounded-md px-2 py-2 text-center text-sm font-medium transition duration-150 active:scale-[0.98] disabled:opacity-45 md:min-h-28 md:border md:bg-card md:p-3 md:text-left',
                        mode === option.value && 'bg-primary text-primary-foreground md:border-primary md:bg-primary/5 md:text-foreground md:ring-1 md:ring-primary/30'
                      )}
                    >
                      <span className="flex items-center justify-center gap-1.5 md:justify-between">{option.label}{mode === option.value && <Check className="hidden h-4 w-4 text-primary md:block" />}</span>
                      <span className="mt-2 hidden text-xs font-normal text-muted-foreground md:block">{option.description}</span>
                      <span className="mt-2 hidden text-xs font-normal text-foreground/75 md:block">{option.meta}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="order-4 hidden md:block md:order-3"><TemplatePicker selectedTemplateId={selectedTemplateId} onTemplateChange={onTemplateChange} onLoadTemplate={onLoadTemplate} /></div>

              {selectedProject && relevantMemoryEntries.length > 0 && (
                <div className="order-5 space-y-2 rounded-md border p-3">
                  <p className="text-sm font-medium">Project memory</p>
                  <div className="flex flex-wrap gap-2">
                    {relevantMemoryEntries.map((entry) => {
                      const selected = selectedMemoryIds.includes(entry.id);
                      return <button key={entry.id} type="button" onClick={() => onToggleMemory(entry.id)} className={cn('min-h-10 rounded-full border px-3 text-xs', selected ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground line-through')}>{entry.title}</button>;
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="order-4 md:order-2 xl:order-none">
            <CardContent className="space-y-5 p-4 md:p-5">
              <div className="hidden space-y-5 md:block">
                <div className="space-y-2"><Label>Technique</Label><TechniqueCards form={form} isPro={isPro} /></div>
                <div className="space-y-2"><Label>Reference files</Label><ReferenceFiles attachments={attachments} onAttachmentChange={onAttachmentChange} onRemoveAttachment={onRemoveAttachment} inputId="workspace-files-desktop" /></div>
              </div>

              <Accordion type="multiple" className="md:hidden">
                <AccordionItem value="template"><AccordionTrigger>Template</AccordionTrigger><AccordionContent><TemplatePicker selectedTemplateId={selectedTemplateId} onTemplateChange={onTemplateChange} onLoadTemplate={onLoadTemplate} /></AccordionContent></AccordionItem>
                <AccordionItem value="technique"><AccordionTrigger>Technique</AccordionTrigger><AccordionContent><TechniqueCards form={form} isPro={isPro} /></AccordionContent></AccordionItem>
                <AccordionItem value="files"><AccordionTrigger>Reference files</AccordionTrigger><AccordionContent><ReferenceFiles attachments={attachments} onAttachmentChange={onAttachmentChange} onRemoveAttachment={onRemoveAttachment} inputId="workspace-files-mobile" /></AccordionContent></AccordionItem>
              </Accordion>
              <AdvancedOptions explanationMode={explanationMode} onExplanationModeChange={onExplanationModeChange} maxCharacters={maxCharacters} onMaxCharactersChange={onMaxCharactersChange} />
            </CardContent>
          </Card>

          {!keyboardOpen && (
            <div data-testid="workspace-refine-bar" className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 order-2 rounded-md border bg-background/95 p-2 shadow-lg backdrop-blur md:bottom-3 md:order-3 xl:order-none xl:bottom-4 xl:mt-5">
              <Button type="submit" disabled={submitDisabled} className="min-h-12 w-full bg-accent text-accent-foreground hover:bg-accent/90">
                <Sparkles className="h-4 w-4" />{submitLabel}
              </Button>
            </div>
          )}
        </div>

        <div className="order-3 min-w-0 md:order-4 xl:order-none xl:sticky xl:top-[8.75rem]">{output}</div>
      </form>
    </Form>
  );
}
