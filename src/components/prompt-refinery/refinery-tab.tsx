'use client';

import { ChangeEvent, useState, useContext, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Wand2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { basicModeMessage } from '@/lib/basic-mode-message';
import { freeTaskAvailability } from '@/lib/free-inference';
import { PROMPT_TECHNIQUES, PROMPT_TEMPLATES, PromptTechnique } from '@/lib/constants';
import { refinePromptAction, getTokenCountsAction } from '@/app/actions';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { Project } from './project-types';
import { SubscriptionContext } from '@/context/subscription-context';
import { isFreeTechnique } from '@/lib/subscription';
import { savePromptAction } from '@/app/subscription-actions';
import { addProjectSessionAction } from '@/app/project-actions';
import { useWorkflow } from '@/context/workflow-context';
import type { ProjectMemoryEntry } from './stage2-types';
import { RefinedOutputPanel } from './refined-output-panel';
import type { PromptVersion, Refinement, RefinementAttachment, TokenCounts } from './refinery-types';
import { RefineryContextControls, RefineryOptionsControls } from './refinery-form-sections';

const formSchema = z.object({
  prompt: z.string().min(10, { message: 'Please enter a prompt of at least 10 characters.' }),
  promptType: z.enum(PROMPT_TECHNIQUES.map(p => p.value) as [PromptTechnique, ...PromptTechnique[]]),
});

type FormValues = z.infer<typeof formSchema>;

interface RefineryTabProps {
  selectedProject: Project | null;
  projects?: Project[] | null;
  isLoadingProjects?: boolean;
  allowProjectSelection?: boolean;
  onSelectProject?: (project: Project | null) => void;
  onProjectRefinementSaved?: (sessionId: string) => void;
  projectWorkspace?: boolean;
}

const NO_PROJECT_VALUE = '__no_project__';
const REFINEMENT_MODES = [
  ['quick_refine', 'Quick Refine'],
  ['guided_fix', 'Guided Fix'],
  ['full_council', 'Full Council'],
] as const;
type RefinementMode = (typeof REFINEMENT_MODES)[number][0];

function refinementModeLabel(mode: RefinementMode) {
  return REFINEMENT_MODES.find(([value]) => value === mode)?.[1] ?? 'This mode';
}

function resetDateTime(value: string | null) {
  return value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : null;
}

function buildProjectMemory(project: Project | null, entries: ProjectMemoryEntry[]): string | undefined {
  if (!project) {
    return undefined;
  }

  const memoryParts = [
    `Project: ${project.name}`,
    project.description ? `Project description: ${project.description}` : '',
    ...entries
      .slice()
      .reverse()
      .map((entry, index) => `Memory ${index + 1} (${entry.kind}) — ${entry.title}\n${entry.content}`),
  ].filter(Boolean);

  return memoryParts.join('\n\n').slice(0, 6000);
}

function getErrorToast(error: unknown): { title: string; description: string } {
  const errorName = error instanceof Error ? error.name : '';
  const errorMessage = error instanceof Error ? error.message : '';

  if (
    errorName === 'ProviderKeyMissingError'
  ) {
    return {
      title: 'Provider Key Missing',
      description: errorMessage,
    };
  }

  if (
    errorName === 'ApiKeyInvalidError' ||
    errorName === 'OpenRouterApiKeyInvalidError' ||
    errorMessage.includes('API key looks invalid')
  ) {
    return {
      title: errorName === 'OpenRouterApiKeyInvalidError' ? 'Invalid OpenRouter API Key' : 'Invalid API Key',
      description: errorName === 'OpenRouterApiKeyInvalidError'
        ? 'Check your OpenRouter API key in Settings and save the corrected key.'
        : 'Check your Gemini API key in Settings and save the corrected key.',
    };
  }

  if (errorName === 'ApiQuotaError' || errorName === 'OpenRouterQuotaError' || errorMessage.includes('quota')) {
    return {
      title: errorName === 'OpenRouterQuotaError' ? 'OpenRouter Quota Issue' : 'Gemini Quota Issue',
      description: errorMessage || 'Gemini is rate limited or out of quota. Try again later.',
    };
  }

  if (errorName === 'ProFeatureRequiredError') {
    return {
      title: 'Pro Feature',
      description: errorMessage,
    };
  }

  if (errorName === 'InsufficientCreditsError') {
    return { title: 'More Credits Needed', description: errorMessage };
  }

  if (errorName === 'ManagedRateLimitError' || errorName === 'ConcurrencyLimitError') {
    return {
      title: 'Clarift Is Busy',
      description: errorMessage,
    };
  }

  if (errorName === 'ProviderTimeoutError') return { title: 'Refinement Timed Out', description: errorMessage };

  if (errorName === 'AuthenticationRequiredError') {
    return {
      title: 'Sign In Again',
      description: errorMessage,
    };
  }

  return {
    title: 'An error occurred',
    description: errorMessage || 'Please try again later.',
  };
}

const TEXT_LIKE_TYPES = [
  'text/',
  'application/json',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
  'text/markdown',
];

function canReadAsText(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return TEXT_LIKE_TYPES.some((type) => file.type.startsWith(type) || file.type === type) ||
    /\.(txt|md|markdown|csv|json|xml|yaml|yml|log|tsv)$/i.test(lowerName);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function convertDocumentToMarkdown(file: File, firebaseIdToken: string): Promise<string> {
  const formData = new FormData();
  formData.set('file', file);

  const response = await fetch('/api/markitdown', {
    method: 'POST',
    headers: { Authorization: `Bearer ${firebaseIdToken}` },
    body: formData,
  });
  const result = await response.json() as { content?: string; error?: string };

  if (!response.ok || !result.content) {
    throw new Error(result.error || `Could not convert ${file.name}.`);
  }

  return result.content;
}

export function RefineryTab({
  selectedProject,
  projects,
  isLoadingProjects = false,
  allowProjectSelection = false,
  onSelectProject,
  onProjectRefinementSaved,
  projectWorkspace = false,
}: RefineryTabProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isTokenizing, setIsTokenizing] = useState(false);
  const [refinedPrompt, setRefinedPrompt] = useState<string | null>(null);
  const [rawPromptAtResult, setRawPromptAtResult] = useState<string | null>(null);
  const [refinements, setRefinements] = useState<Refinement[]>([]);
  const [tokenCounts, setTokenCounts] = useState<TokenCounts | null>(null);
  const [attachments, setAttachments] = useState<RefinementAttachment[]>([]);
  const [promptVersions, setPromptVersions] = useState<PromptVersion[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [explanationMode, setExplanationMode] = useState(true);
  const [maxCharacters, setMaxCharacters] = useState('');
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<string[]>([]);
  const [refinementMode, setRefinementMode] = useState<RefinementMode>('quick_refine');
  const [inferencePreference, setInferencePreference] = useState<{ mode: 'managed' | 'byok'; provider: 'gemini' | 'openrouter' }>({ mode: 'managed', provider: 'gemini' });
  const { toast } = useToast();
  const { firestore, user } = useFirebase();
  const { isPro, savedPromptCount, savedPromptLimit, freeTaskUnits, freeAllowance, usesFreeManagedInference, refreshTenant, updateFreeAllowance, capabilities } = useContext(SubscriptionContext);
  const { refineryTransfer, clearRefineryTransfer } = useWorkflow();
  const managedQuotaApplies = inferencePreference.mode === 'managed' && capabilities.inference === 'managed' && usesFreeManagedInference && Boolean(freeAllowance);
  const selectedAvailability = managedQuotaApplies && freeAllowance
    ? freeTaskAvailability(refinementMode, freeAllowance)
    : null;

  const projectSessionsQuery = useMemoFirebase(() => {
    if (!user || !firestore || !selectedProject) return null;
    return query(
      collection(firestore, `projects/${selectedProject.id}/memoryEntries`),
      orderBy('updatedAt', 'desc'),
      limit(25)
    );
  }, [user, firestore, selectedProject]);

  const { data: projectMemoryEntries } = useCollection<ProjectMemoryEntry>(projectSessionsQuery);
  const projectOptions = selectedProject && !projects?.some((project) => project.id === selectedProject.id)
    ? [selectedProject, ...(projects ?? [])]
    : (projects ?? []);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      prompt: '',
      promptType: 'Zero-shot',
    },
  });

  useEffect(() => {
    const readPreference = () => {
      const provider = localStorage.getItem('clariftByokProvider') === 'openrouter' ? 'openrouter' : 'gemini';
      const mode = capabilities.byok && localStorage.getItem('clariftInferenceMode') === 'byok' ? 'byok' : 'managed';
      setInferencePreference({ mode, provider });
    };
    readPreference();
    window.addEventListener('clarift-provider-preference', readPreference);
    return () => window.removeEventListener('clarift-provider-preference', readPreference);
  }, [capabilities.byok]);

  useEffect(() => {
    const technique = PROMPT_TECHNIQUES.find((candidate) => candidate.value === selectedProject?.defaultTechnique)?.value;
    if (technique) form.setValue('promptType', technique);
  }, [form, selectedProject?.defaultTechnique, selectedProject?.id]);

  const watchedPrompt = form.watch('prompt');
  const relevantMemoryEntries = useMemo(() => {
    const queryTerms = new Set(watchedPrompt.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length >= 2));
    return (projectMemoryEntries ?? [])
      .filter((entry) => entry.active !== false)
      .map((entry) => ({
        entry,
        score: entry.searchTerms?.reduce((score, term) => score + (queryTerms.has(term) ? 1 : 0), 0) ?? 0,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map(({ entry }) => entry);
  }, [projectMemoryEntries, watchedPrompt]);

  useEffect(() => {
    setSelectedMemoryIds(relevantMemoryEntries.map((entry) => entry.id));
  }, [relevantMemoryEntries]);

  useEffect(() => {
    if (!refineryTransfer) return;
    if (refineryTransfer.prompt) {
      form.setValue('prompt', refineryTransfer.prompt.slice(0, 50000), { shouldDirty: true, shouldValidate: true });
    }
    if (refineryTransfer.attachments?.length) {
      setAttachments((current) => [...current, ...refineryTransfer.attachments!].slice(0, 6));
    }
    clearRefineryTransfer(refineryTransfer.id);
  }, [clearRefineryTransfer, form, refineryTransfer]);

  useEffect(() => {
    if (!refinedPrompt) {
      return;
    }

    const fetchTokenCounts = async () => {
      setIsTokenizing(true);
      try {
        const counts = await getTokenCountsAction({ text: refinedPrompt });
        setTokenCounts(counts);
      } catch (error) {
        console.error('Error getting token counts:', error);
        toast({
          variant: 'destructive',
          title: 'Could not estimate token counts',
          description: 'The refined prompt is still ready to use.',
        });
      } finally {
        setIsTokenizing(false);
      }
    };

    fetchTokenCounts();
  }, [refinedPrompt, toast]);

  const onSubmit = async (data: FormValues) => {
    if (selectedAvailability && !selectedAvailability.available) {
      toast({
        title: `${refinementModeLabel(refinementMode)} is unavailable`,
        description: `This mode needs ${selectedAvailability.requiredUnits} generative units, but ${selectedAvailability.availableUnits} remain. Choose an available mode or wait until ${resetDateTime(selectedAvailability.resetAt) ?? 'the next allowance reset'}.`,
      });
      return;
    }
    setIsLoading(true);
    setRefinedPrompt(null);
    setRawPromptAtResult(null);
    setRefinements([]);
    setTokenCounts(null);
    try {
      const selectedEntries = (projectMemoryEntries ?? []).filter((entry) => selectedMemoryIds.includes(entry.id));
      const projectMemory = buildProjectMemory(selectedProject, selectedEntries);
      const firebaseIdToken = await user?.getIdToken();
      const result = await refinePromptAction({
        ...data,
        task: refinementMode,
        inferenceMode: inferencePreference.mode,
        provider: inferencePreference.provider,
        idempotencyKey: crypto.randomUUID(),
        projectMemory,
        explanationMode,
        maxCharacters: maxCharacters ? Number(maxCharacters) : undefined,
        attachments,
        firebaseIdToken,
      });
      setRefinedPrompt(result.refinedPrompt);
      setRawPromptAtResult(data.prompt);
      setRefinements(result.refinements);
      updateFreeAllowance(result.allowance);
      if (result.qualityTier === 'fallback') {
        toast({
          title: 'Basic mode used',
          description: basicModeMessage(result.basicMode, {
            task: refinementMode,
            taskLabel: refinementModeLabel(refinementMode),
            allowance: result.allowance,
          }),
        });
      }
      void refreshTenant().catch(() => undefined);

      const previousVersions = data.prompt === rawPromptAtResult ? promptVersions : [];
      const nextVersion: PromptVersion = {
        version: previousVersions.length + 1,
        rawPrompt: data.prompt,
        refinedPrompt: result.refinedPrompt,
        promptType: data.promptType,
        createdAt: new Date().toISOString(),
      };
      const nextVersions = [...previousVersions, nextVersion];
      setPromptVersions(nextVersions);

      if (user && firestore && selectedProject) {
        try {
          const savedSession = await addProjectSessionAction({
            firebaseIdToken: firebaseIdToken ?? await user.getIdToken(),
            projectId: selectedProject.id,
            session: {
              rawPrompt: data.prompt,
              refinedPrompt: result.refinedPrompt,
              promptType: data.promptType,
              version: nextVersion.version,
              versions: nextVersions,
            },
          });
          onProjectRefinementSaved?.(savedSession.id);
        } catch (error) {
          console.error('Could not store project session:', error);
          toast({
            variant: 'destructive',
            title: 'Project Memory Not Saved',
            description: 'The refined prompt is ready, but this session could not be added to project memory.',
          });
        }
      }
    } catch (error) {
      const errorToast = getErrorToast(error);
      toast({
        variant: 'destructive',
        title: errorToast.title,
        description: errorToast.description,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAttachmentChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';

    if (files.length === 0) {
      return;
    }

    if (!user) return;
    const firebaseIdToken = await user.getIdToken();
    const convertedAttachments = await Promise.all(files.map(async (file) => {
      try {
        if (file.size > 10 * 1024 * 1024) {
          throw new Error(`${file.name} is larger than the 10 MB upload limit.`);
        }

        if (file.type.startsWith('image/')) {
          return {
            name: file.name,
            mimeType: file.type,
            content: `Uploaded image file, ${formatFileSize(file.size)}. Inspect the image and use relevant visual details when refining the prompt.`,
            dataUri: await readFileAsDataUri(file),
          };
        }

        if (canReadAsText(file)) {
          const text = await file.text();
          return {
            name: file.name,
            mimeType: file.type || 'text/plain',
            content: text.slice(0, 12000),
          };
        }

        return {
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          content: await convertDocumentToMarkdown(file, firebaseIdToken),
        };
      } catch (error) {
        toast({
          variant: 'destructive',
          title: 'File context limited',
          description: error instanceof Error ? error.message : `Could not fully process ${file.name}.`,
        });

        return {
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          content: `Uploaded ${file.type || 'unknown file type'} file, ${formatFileSize(file.size)}. Conversion was unavailable, so use the file name and metadata as context and ask for any required document details.`,
        };
      }
    }));

    setAttachments((current) => [...current, ...convertedAttachments].slice(0, 6));
  };

  const removeAttachment = (name: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.name !== name));
  };

  const handleLoadTemplate = () => {
    const template = PROMPT_TEMPLATES.find((candidate) => candidate.id === selectedTemplateId);
    if (!template) {
      return;
    }

    form.setValue('prompt', template.prompt, { shouldDirty: true, shouldValidate: true });
    form.setValue('promptType', template.promptType, { shouldDirty: true });
  };

  const handleSavePrompt = async () => {
    if (!user || !firestore || !refinedPrompt) return;

    const rawPrompt = form.getValues('prompt');
    const promptType = form.getValues('promptType');
    const versions = promptVersions.length > 0
      ? promptVersions
      : [{
          version: 1,
          rawPrompt,
          refinedPrompt,
          promptType,
          createdAt: new Date().toISOString(),
        }];
    const latestVersion = versions.at(-1)?.version ?? 1;

    try {
      const firebaseIdToken = await user.getIdToken();
      await savePromptAction({
        firebaseIdToken,
        prompt: {
        name: `Refined: ${rawPrompt.substring(0, 30)}...`,
        originalPrompt: rawPrompt,
        refinedPrompt,
        promptType,
        latestVersion,
        versionCount: versions.length,
        versions,
        },
      });

      toast({
          title: 'Prompt Saved!',
          description: 'You can view your saved prompts in the "Saved Prompts" tab.',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: error instanceof Error && error.name === 'SavedPromptLimitError' ? 'Saved Prompt Limit Reached' : 'Could Not Save Prompt',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  };

  return (
    <div className={`grid gap-6 ${projectWorkspace ? 'xl:grid-cols-2' : 'md:grid-cols-2'}`}>
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="text-primary" />
            <span>Refine your Prompt</span>
          </CardTitle>
          {selectedProject && (
            <p className="text-sm text-muted-foreground">
              Using project memory from {selectedProject.name}
            </p>
          )}
          {allowProjectSelection && onSelectProject && (
            <div className="space-y-2 pt-2">
              <Label htmlFor="refinery-project">Project</Label>
              <Select
                value={selectedProject?.id ?? NO_PROJECT_VALUE}
                onValueChange={(projectId) => {
                  onSelectProject(
                    projectId === NO_PROJECT_VALUE
                      ? null
                      : projectOptions.find((project) => project.id === projectId) ?? null
                  );
                }}
                disabled={isLoadingProjects}
              >
                <SelectTrigger id="refinery-project">
                  <SelectValue placeholder={isLoadingProjects ? 'Loading projects...' : 'Choose a project'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROJECT_VALUE}>No project</SelectItem>
                  {projectOptions.map((project) => (
                    <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-2">
                <Label>Refinement Mode</Label>
                <div className="grid grid-cols-3 gap-1 rounded-md border bg-muted p-1">
                  {REFINEMENT_MODES.map(([value, label]) => {
                    const availability = managedQuotaApplies && freeAllowance ? freeTaskAvailability(value, freeAllowance) : null;
                    const unavailable = availability?.available === false;
                    return <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={refinementMode === value ? 'default' : 'ghost'}
                      onClick={() => setRefinementMode(value)}
                      disabled={isLoading || unavailable}
                      title={unavailable ? `${label} needs ${availability.requiredUnits} units; ${availability.availableUnits} remain.` : undefined}
                      className="h-auto min-h-9 whitespace-normal px-2 py-2"
                    >
                      {label}
                    </Button>;
                  })}
                </div>
                <p className={`text-xs ${selectedAvailability && !selectedAvailability.available ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>
                  {refinementMode === 'quick_refine' && 'A focused pass for everyday prompts.'}
                  {refinementMode === 'guided_fix' && 'Three expert passes for prompts that need structure and critique.'}
                  {refinementMode === 'full_council' && 'Five specialist passes and a final synthesis for complex work.'}
                  {' '}{inferencePreference.mode === 'managed'
                    ? capabilities.inference === 'managed'
                      ? selectedAvailability && !selectedAvailability.available
                        ? `Needs ${selectedAvailability.requiredUnits} generative units, but ${selectedAvailability.availableUnits} remain. Choose an available mode or wait until ${resetDateTime(selectedAvailability.resetAt) ?? 'the next allowance reset'}.`
                        : `Uses ${freeTaskUnits[refinementMode]} generative unit${freeTaskUnits[refinementMode] === 1 ? '' : 's'}. ${freeAllowance ? `${freeAllowance.refinement.daily.remaining} daily and ${freeAllowance.refinement.monthly.remaining} monthly units remain.` : 'No provider key is required.'}`
                      : 'Basic mode is active. No provider key is required.'
                    : `Using encrypted ${inferencePreference.provider === 'gemini' ? 'Gemini' : 'OpenRouter'} BYOK; no managed credits.`}
                </p>
              </div>
              <RefineryContextControls
                selectedProject={selectedProject}
                relevantMemoryEntries={relevantMemoryEntries}
                selectedMemoryIds={selectedMemoryIds}
                onToggleMemory={(entryId) => setSelectedMemoryIds((current) => current.includes(entryId) ? current.filter((id) => id !== entryId) : [...current, entryId])}
                selectedTemplateId={selectedTemplateId}
                onTemplateChange={setSelectedTemplateId}
                onLoadTemplate={handleLoadTemplate}
              />
              <FormField
                control={form.control}
                name="prompt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Your Prompt</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="e.g., Generate a blog post about the benefits of remote work."
                        className="min-h-[150px] font-code"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="promptType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Refinement Technique</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a technique" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PROMPT_TECHNIQUES.map((tech) => (
                          <SelectItem key={tech.value} value={tech.value} disabled={!isPro && !isFreeTechnique(tech.value)}>
                            {tech.label}{!isPro && !isFreeTechnique(tech.value) ? ' (Pro)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground pt-1">
                      {PROMPT_TECHNIQUES.find(t => t.value === form.watch('promptType'))?.description}
                    </p>
                    <div className="rounded-md border bg-muted/40 p-3 text-xs">
                      <span className="font-semibold">Example: </span>
                      {PROMPT_TECHNIQUES.find(t => t.value === form.watch('promptType'))?.example}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <RefineryOptionsControls
                attachments={attachments}
                onAttachmentChange={handleAttachmentChange}
                onRemoveAttachment={removeAttachment}
                explanationMode={explanationMode}
                onExplanationModeChange={setExplanationMode}
                maxCharacters={maxCharacters}
                onMaxCharactersChange={setMaxCharacters}
              />
              <Button type="submit" disabled={isLoading || !user || selectedAvailability?.available === false} className="w-full bg-accent hover:bg-accent/90 text-accent-foreground">
                {isLoading ? 'Refining...' : inferencePreference.mode === 'managed'
                  ? capabilities.inference === 'managed'
                    ? selectedAvailability?.available === false
                      ? 'Choose an available mode'
                      : `Refine · ${freeTaskUnits[refinementMode]} unit${freeTaskUnits[refinementMode] === 1 ? '' : 's'}`
                    : 'Refine in Basic Mode'
                  : 'Refine with My Provider Key'}
              </Button>
              {!isPro && (
                <p className="text-xs text-muted-foreground">
                  Free includes three techniques and up to {savedPromptLimit} saved prompts. You currently have {savedPromptCount}.
                </p>
              )}
            </form>
          </Form>
        </CardContent>
      </Card>

      <RefinedOutputPanel
        isLoading={isLoading}
        refinedPrompt={refinedPrompt}
        rawPromptAtResult={rawPromptAtResult}
        refinements={refinements}
        tokenCounts={tokenCounts}
        isTokenizing={isTokenizing}
        promptVersions={promptVersions}
        explanationMode={explanationMode}
        promptType={form.getValues('promptType')}
        canSave={Boolean(user)}
        onSavePrompt={handleSavePrompt}
      />
    </div>
  );
}
