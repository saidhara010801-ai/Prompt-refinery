'use client';

import { useState, useContext, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Wand2, Sparkles, Save, BrainCircuit, Cpu, Zap, Wind } from 'lucide-react';
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

export function RefineryTab({ selectedProject }: RefineryTabProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isTokenizing, setIsTokenizing] = useState(false);
  const [refinedPrompt, setRefinedPrompt] = useState<string | null>(null);
  const [refinements, setRefinements] = useState<Refinement[]>([]);
  const [tokenCounts, setTokenCounts] = useState<TokenCounts | null>(null);
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
      });
      setRefinedPrompt(result.refinedPrompt);
      setRefinements(result.refinements);

      if (user && firestore && selectedProject) {
        const sessionsCol = collection(firestore, `users/${user.uid}/projects/${selectedProject.id}/projectSessions`);
        addDocumentNonBlocking(sessionsCol, {
          projectId: selectedProject.id,
          rawPrompt: data.prompt,
          refinedPrompt: result.refinedPrompt,
          promptType: data.promptType,
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

  const handleSavePrompt = () => {
    if (!user || !firestore || !refinedPrompt) return;

    const savedPromptsCol = collection(firestore, `users/${user.uid}/savedPrompts`);
    addDocumentNonBlocking(savedPromptsCol, {
        name: `Refined: ${form.getValues('prompt').substring(0, 30)}...`,
        userId: user.uid,
        originalPrompt: form.getValues('prompt'),
        refinedPrompt: refinedPrompt,
        promptType: form.getValues('promptType'),
        creationTimestamp: serverTimestamp(),
        saveTimestamp: serverTimestamp(),
    });

    toast({
        title: 'Prompt Saved!',
        description: 'You can view your saved prompts in the "Saved Prompts" tab.',
    });
  };

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
