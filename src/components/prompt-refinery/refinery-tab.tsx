'use client';

import { ChangeEvent, useState, useContext, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Wand2, Sparkles, Save, BrainCircuit, Cpu, Zap, Wind, Paperclip, X, GitCompareArrows } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { PROMPT_TECHNIQUES, PromptTechnique } from '@/lib/constants';
import { refinePromptAction, getTokenCountsAction } from '@/app/actions';
import { CopyButton } from './copy-button';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { addDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { collection, doc, limit, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { ApiKeyContext } from '@/context/api-key-context';
import { SettingsContext } from '@/context/settings-context';
import { Project } from './projects-tab';
import { Badge } from '../ui/badge';

const formSchema = z.object({
  prompt: z.string().min(10, { message: 'Please enter a prompt of at least 10 characters.' }),
  promptType: z.enum(PROMPT_TECHNIQUES.map(p => p.value) as [PromptTechnique, ...PromptTechnique[]]),
});

type FormValues = z.infer<typeof formSchema>;

interface Refinement {
    councilMember: string;
    thoughtProcess: string;
    refinedText: string;
}

interface TokenCounts {
    gemini: number;
    openai: number;
    deepseek: number;
    qwen: number;
}

interface RefinementAttachment {
    name: string;
    mimeType: string;
    content: string;
    dataUri?: string;
}

interface PromptVersion {
    version: number;
    rawPrompt: string;
    refinedPrompt: string;
    promptType: string;
    createdAt: string;
}

interface ProjectSessionMemory {
    id: string;
    rawPrompt: string;
    refinedPrompt: string;
    promptType: string;
    llmResponse?: string;
    timestamp?: {
      seconds: number;
      nanoseconds: number;
    };
}

interface RefineryTabProps {
  selectedProject: Project | null;
}

function buildProjectMemory(project: Project | null, sessions: ProjectSessionMemory[] | null): string | undefined {
  if (!project) {
    return undefined;
  }

  const memoryParts = [
    `Project: ${project.name}`,
    project.description ? `Project description: ${project.description}` : '',
    ...(sessions ?? [])
      .slice()
      .reverse()
      .map((session, index) => [
        `Session ${index + 1} (${session.promptType})`,
        `Raw prompt: ${session.rawPrompt}`,
        `Refined prompt: ${session.refinedPrompt}`,
        session.llmResponse ? `LLM response / notes: ${session.llmResponse}` : '',
      ].filter(Boolean).join('\n')),
  ].filter(Boolean);

  return memoryParts.join('\n\n').slice(0, 6000);
}

function getErrorToast(error: unknown): { title: string; description: string } {
  const errorName = error instanceof Error ? error.name : '';
  const errorMessage = error instanceof Error ? error.message : '';

  if (
    errorName === 'ApiKeyMissingError' ||
    errorName === 'OpenRouterApiKeyMissingError' ||
    errorMessage.includes('API key is missing')
  ) {
    return {
      title: errorName === 'OpenRouterApiKeyMissingError' ? 'OpenRouter API Key Missing' : 'API Key Missing',
      description: errorName === 'OpenRouterApiKeyMissingError'
        ? 'Add your OpenRouter API key in Settings, then try refining again.'
        : 'Add your Gemini API key in Settings, then try refining again.',
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
      title: 'Gemini Quota Issue',
      description: errorMessage || 'Gemini is rate limited or out of quota. Try again later.',
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

async function convertDocumentToMarkdown(file: File): Promise<string> {
  const formData = new FormData();
  formData.set('file', file);

  const response = await fetch('/api/markitdown', {
    method: 'POST',
    body: formData,
  });
  const result = await response.json() as { content?: string; error?: string };

  if (!response.ok || !result.content) {
    throw new Error(result.error || `Could not convert ${file.name}.`);
  }

  return result.content;
}

function buildDiffTokens(originalPrompt: string, refinedPrompt: string) {
  const originalWords = new Set(
    originalPrompt
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.replace(/[^\w-]/g, ''))
      .filter(Boolean)
  );

  return refinedPrompt.split(/(\s+)/).map((part, index) => {
    const normalized = part.toLowerCase().replace(/[^\w-]/g, '');
    const isWhitespace = /^\s+$/.test(part);
    const isNew = normalized.length > 0 && !originalWords.has(normalized);

    return {
      id: `${part}-${index}`,
      text: part,
      isWhitespace,
      isNew,
    };
  });
}

export function RefineryTab({ selectedProject }: RefineryTabProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isTokenizing, setIsTokenizing] = useState(false);
  const [refinedPrompt, setRefinedPrompt] = useState<string | null>(null);
  const [rawPromptAtResult, setRawPromptAtResult] = useState<string | null>(null);
  const [refinements, setRefinements] = useState<Refinement[]>([]);
  const [tokenCounts, setTokenCounts] = useState<TokenCounts | null>(null);
  const [attachments, setAttachments] = useState<RefinementAttachment[]>([]);
  const [promptVersions, setPromptVersions] = useState<PromptVersion[]>([]);
  const { toast } = useToast();
  const { firestore, user } = useFirebase();
  const { apiKey, openRouterApiKey, aiProvider, openRouterModels } = useContext(ApiKeyContext);
  const { triggerAnimation } = useContext(SettingsContext);

  const projectSessionsQuery = useMemoFirebase(() => {
    if (!user || !firestore || !selectedProject) return null;
    return query(
      collection(firestore, `users/${user.uid}/projects/${selectedProject.id}/projectSessions`),
      orderBy('timestamp', 'desc'),
      limit(5)
    );
  }, [user, firestore, selectedProject]);

  const { data: projectSessions } = useCollection<ProjectSessionMemory>(projectSessionsQuery);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      prompt: '',
      promptType: 'Zero-shot',
    },
  });

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
    setIsLoading(true);
    setRefinedPrompt(null);
    setRawPromptAtResult(null);
    setRefinements([]);
    setTokenCounts(null);
    try {
      const projectMemory = buildProjectMemory(selectedProject, projectSessions);
      const result = await refinePromptAction({
        ...data,
        provider: aiProvider,
        apiKey: apiKey || undefined,
        openRouterApiKey: openRouterApiKey || undefined,
        openRouterModels,
        projectMemory,
        attachments,
      });
      setRefinedPrompt(result.refinedPrompt);
      setRawPromptAtResult(data.prompt);
      setRefinements(result.refinements);

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
        const sessionsCol = collection(firestore, `users/${user.uid}/projects/${selectedProject.id}/projectSessions`);
        addDocumentNonBlocking(sessionsCol, {
          projectId: selectedProject.id,
          rawPrompt: data.prompt,
          refinedPrompt: result.refinedPrompt,
          promptType: data.promptType,
          version: nextVersion.version,
          versions: nextVersions,
          timestamp: serverTimestamp(),
        });
        updateDocumentNonBlocking(doc(firestore, `users/${user.uid}/projects`, selectedProject.id), {
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      const errorToast = getErrorToast(error);
      if (
        error instanceof Error &&
        (
          error.name === 'ApiKeyMissingError' ||
          error.name === 'ApiKeyInvalidError' ||
          error.name === 'OpenRouterApiKeyMissingError' ||
          error.name === 'OpenRouterApiKeyInvalidError'
        )
      ) {
        triggerAnimation();
      }
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
          content: await convertDocumentToMarkdown(file),
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

  const handleSavePrompt = () => {
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

    const savedPromptsCol = collection(firestore, `users/${user.uid}/savedPrompts`);
    addDocumentNonBlocking(savedPromptsCol, {
        name: `Refined: ${rawPrompt.substring(0, 30)}...`,
        userId: user.uid,
        originalPrompt: rawPrompt,
        refinedPrompt,
        promptType,
        latestVersion,
        versionCount: versions.length,
        versions,
        creationTimestamp: serverTimestamp(),
        saveTimestamp: serverTimestamp(),
    });

    toast({
        title: 'Prompt Saved!',
        description: 'You can view your saved prompts in the "Saved Prompts" tab.',
    });
  };

  const diffTokens = rawPromptAtResult && refinedPrompt
    ? buildDiffTokens(rawPromptAtResult, refinedPrompt)
    : [];

  return (
    <div className="grid md:grid-cols-2 gap-8">
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
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
                          <SelectItem key={tech.value} value={tech.value}>
                            {tech.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground pt-1">
                      {PROMPT_TECHNIQUES.find(t => t.value === form.watch('promptType'))?.description}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="space-y-3">
                <FormLabel htmlFor="attachment-upload">Reference Files</FormLabel>
                <div className="flex items-center gap-3">
                  <Button type="button" variant="outline" asChild>
                    <label htmlFor="attachment-upload" className="cursor-pointer">
                      <Paperclip className="h-4 w-4" />
                      Add Files
                    </label>
                  </Button>
                  <input
                    id="attachment-upload"
                    type="file"
                    multiple
                    accept=".txt,.md,.markdown,.csv,.json,.xml,.yaml,.yml,.log,.tsv,.pdf,.docx,.pptx,.xls,.xlsx,.html,.png,.jpg,.jpeg,.webp"
                    onChange={handleAttachmentChange}
                    className="sr-only"
                  />
                  <span className="text-sm text-muted-foreground">Text and documents become context; images use Gemini Vision.</span>
                </div>
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {attachments.map((attachment) => (
                      <Badge key={attachment.name} variant="secondary" className="gap-1">
                        <Paperclip className="h-3 w-3" />
                        {attachment.name}
                        <button type="button" onClick={() => removeAttachment(attachment.name)} className="ml-1">
                          <X className="h-3 w-3" />
                          <span className="sr-only">Remove {attachment.name}</span>
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <Button type="submit" disabled={isLoading} className="w-full bg-accent hover:bg-accent/90 text-accent-foreground">
                {isLoading ? 'Refining...' : 'Refine with AI Council'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
            <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Sparkles className="text-primary" />
                    <span>Refined Output</span>
                    {promptVersions.length > 0 && <Badge variant="outline">v{promptVersions.at(-1)?.version}</Badge>}
                </div>
                {refinedPrompt && (
                    <Button variant="outline" size="sm" onClick={handleSavePrompt} disabled={!user}>
                        <Save className="mr-2 h-4 w-4" />
                        Save Prompt
                    </Button>
                )}
            </CardTitle>
        </CardHeader>
        <CardContent className="min-h-[300px]">
          <AnimatePresence mode="wait">
            {isLoading && (
              <motion.div
                key="loader"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                <Skeleton className="h-8 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </motion.div>
            )}
            {!isLoading && refinedPrompt && (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <div className="relative">
                  <CopyButton textToCopy={refinedPrompt} className="absolute top-0 right-0 z-10" />
                  <pre className="whitespace-pre-wrap font-code text-sm bg-muted p-4 rounded-md">
                    <code>{refinedPrompt}</code>
                  </pre>
                </div>

                {rawPromptAtResult && (
                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="diff">
                      <AccordionTrigger>
                        <span className="flex items-center gap-2">
                          <GitCompareArrows className="h-4 w-4" />
                          Before / After Diff
                        </span>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="grid lg:grid-cols-2 gap-4">
                          <div>
                            <h4 className="font-semibold text-sm mb-2">Before</h4>
                            <pre className="whitespace-pre-wrap font-code text-xs bg-background p-3 rounded-md border">
                              <code>{rawPromptAtResult}</code>
                            </pre>
                          </div>
                          <div>
                            <h4 className="font-semibold text-sm mb-2">After</h4>
                            <div className="whitespace-pre-wrap font-code text-xs bg-background p-3 rounded-md border">
                              {diffTokens.map((token) => (
                                token.isWhitespace ? token.text : (
                                  <span key={token.id} className={token.isNew ? 'rounded bg-green-500/15 text-green-700 dark:text-green-300' : undefined}>
                                    {token.text}
                                  </span>
                                )
                              ))}
                            </div>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}

                {isTokenizing && (
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-1/3" />
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <Skeleton className="h-16 w-full" />
                      <Skeleton className="h-16 w-full" />
                      <Skeleton className="h-16 w-full" />
                      <Skeleton className="h-16 w-full" />
                    </div>
                  </div>
                )}

                {tokenCounts && (
                  <div>
                    <h4 className="font-semibold mb-2">Estimated Token Counts</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                      <div className="p-3 rounded-lg bg-muted">
                        <p className="font-bold text-lg flex items-center justify-center gap-2"><BrainCircuit /> Gemini</p>
                        <p className="text-sm">{tokenCounts.gemini}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-muted">
                        <p className="font-bold text-lg flex items-center justify-center gap-2"><Zap /> OpenAI</p>
                        <p className="text-sm">{tokenCounts.openai}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-muted">
                        <p className="font-bold text-lg flex items-center justify-center gap-2"><Cpu /> DeepSeek</p>
                        <p className="text-sm">{tokenCounts.deepseek}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-muted">
                        <p className="font-bold text-lg flex items-center justify-center gap-2"><Wind /> Qwen</p>
                        <p className="text-sm">{tokenCounts.qwen}</p>
                      </div>
                    </div>
                  </div>
                )}
                
                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="item-1">
                    <AccordionTrigger>View Council's Thoughts</AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-4">
                        {refinements.map((refinement, index) => (
                          <div key={index} className="p-4 bg-background rounded-lg border">
                            <h4 className="font-semibold text-primary">{refinement.councilMember}</h4>
                            <p className="text-sm text-muted-foreground mt-1 mb-2 italic">"{refinement.thoughtProcess}"</p>
                            <pre className="whitespace-pre-wrap font-code text-xs bg-muted p-3 rounded-md"><code>{refinement.refinedText}</code></pre>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
                
              </motion.div>
            )}
            {!isLoading && !refinedPrompt && (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
                <p>Your refined prompt will appear here.</p>
              </div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </div>
  );
}
