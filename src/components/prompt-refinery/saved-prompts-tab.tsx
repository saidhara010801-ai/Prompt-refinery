'use client';

import { useMemo } from 'react';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { CopyButton } from './copy-button';
import { Skeleton } from '../ui/skeleton';
import { deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';

interface SavedPrompt {
  id: string;
  name: string;
  originalPrompt: string;
  refinedPrompt: string;
  promptType: string;
  saveTimestamp: {
    seconds: number;
    nanoseconds: number;
  };
}

export function SavedPromptsTab() {
  const { firestore, user } = useFirebase();
  const { toast } = useToast();

  const savedPromptsQuery = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    return query(
        collection(firestore, `users/${user.uid}/savedPrompts`),
        orderBy('saveTimestamp', 'desc')
    );
  }, [user, firestore]);

  const { data: savedPrompts, isLoading } = useCollection<SavedPrompt>(savedPromptsQuery);
  
  const handleDelete = (promptId: string) => {
    if (!user || !firestore) return;
    const docRef = doc(firestore, `users/${user.uid}/savedPrompts`, promptId);
    deleteDocumentNonBlocking(docRef);
    toast({
        title: "Prompt Deleted",
        description: "The saved prompt has been removed.",
    })
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Saved Prompts</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && (
            <div className="space-y-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
            </div>
        )}
        {!isLoading && savedPrompts && savedPrompts.length > 0 && (
          <Accordion type="single" collapsible className="w-full space-y-4">
            {savedPrompts.map((prompt) => (
              <AccordionItem value={prompt.id} key={prompt.id} className="border rounded-lg px-4">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex justify-between items-center w-full">
                    <span className="font-semibold text-left">{prompt.name}</span>
                    <span className="text-sm text-muted-foreground pr-4">
                        {new Date(prompt.saveTimestamp.seconds * 1000).toLocaleDateString()}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-2">
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-semibold text-sm mb-1">Original Prompt</h4>
                      <p className="text-sm text-muted-foreground p-3 bg-background rounded-md border">{prompt.originalPrompt}</p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm mb-1">Refined Prompt</h4>
                      <div className="relative">
                         <CopyButton textToCopy={prompt.refinedPrompt} className="absolute top-2 right-2 z-10" />
                         <pre className="whitespace-pre-wrap font-code text-sm bg-background p-3 rounded-md border"><code>{prompt.refinedPrompt}</code></pre>
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-1 rounded-full">{prompt.promptType}</span>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(prompt.id)}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                            <span className="sr-only">Delete prompt</span>
                        </Button>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
        {!isLoading && (!savedPrompts || savedPrompts.length === 0) && (
            <div className="text-center text-muted-foreground py-12">
                <p>You haven't saved any prompts yet.</p>
                <p>Refine a prompt in the "Refinery" tab and save it to see it here.</p>
            </div>
        )}
      </CardContent>
    </Card>
  );
}
