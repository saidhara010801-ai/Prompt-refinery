'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Wand2, Sparkles, BookMarked, Save } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { PROMPT_TECHNIQUES, PromptTechnique } from '@/lib/constants';
import { refinePromptAction } from '@/app/actions';
import { CopyButton } from './copy-button';
import { useFirebase } from '@/firebase';
import { addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { collection, serverTimestamp } from 'firebase/firestore';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';

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

export function RefineryTab() {
  const [isLoading, setIsLoading] = useState(false);
  const [refinedPrompt, setRefinedPrompt] = useState<string | null>(null);
  const [refinements, setRefinements] = useState<Refinement[]>([]);
  const { toast } = useToast();
  const { firestore, user } = useFirebase();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      prompt: '',
      promptType: 'Zero-shot',
    },
  });

  const onSubmit = async (data: FormValues) => {
    setIsLoading(true);
    setRefinedPrompt(null);
    setRefinements([]);
    try {
      const result = await refinePromptAction(data);
      setRefinedPrompt(result.refinedPrompt);
      setRefinements(result.refinements);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'An error occurred',
        description: error instanceof Error ? error.message : 'Please try again later.',
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
