'use client';

import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy, doc } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { CopyButton } from './copy-button';
import { Skeleton } from '../ui/skeleton';
import { deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '../ui/badge';

interface PromptVersion {
  version: number;
  rawPrompt: string;
  refinedPrompt: string;
  promptType: string;
  createdAt: string;
}

interface SavedPrompt {
  id: string;
  name: string;
  originalPrompt: string;
  refinedPrompt: string;
  promptType: string;
  latestVersion?: number;
  versionCount?: number;
  versions?: PromptVersion[];
  saveTimestamp: {
    seconds: number;
    nanoseconds: number;
  };
}

function getPromptVersions(prompt: SavedPrompt): PromptVersion[] {
  if (prompt.versions?.length) {
    return prompt.versions;
  }

  return [{
    version: 1,
    rawPrompt: prompt.originalPrompt,
    refinedPrompt: prompt.refinedPrompt,
    promptType: prompt.promptType,
    createdAt: prompt.saveTimestamp?.seconds
      ? new Date(prompt.saveTimestamp.seconds * 1000).toISOString()
      : new Date().toISOString(),
  }];
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
                    <span className="flex items-center gap-2 text-sm text-muted-foreground pr-4">
                        <Badge variant="outline">v{prompt.latestVersion ?? prompt.versionCount ?? 1}</Badge>
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
                    <Accordion type="single" collapsible className="w-full">
                      <AccordionItem value={`${prompt.id}-versions`}>
                        <AccordionTrigger>Version History</AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3">
                            {getPromptVersions(prompt).map((version) => (
                              <div key={`${prompt.id}-${version.version}`} className="rounded-md border bg-background p-3 space-y-2">
                                <div className="flex items-center justify-between gap-3">
                                  <Badge variant="secondary">Version {version.version}</Badge>
                                  <span className="text-xs text-muted-foreground">
                                    {new Date(version.createdAt).toLocaleDateString()}
                                  </span>
                                </div>
                                <div>
                                  <h5 className="font-semibold text-xs mb-1">Raw Prompt</h5>
                                  <p className="text-xs text-muted-foreground">{version.rawPrompt}</p>
                                </div>
                                <div>
                                  <h5 className="font-semibold text-xs mb-1">Refined Prompt</h5>
                                  <pre className="whitespace-pre-wrap font-code text-xs bg-muted p-2 rounded-md">
                                    <code>{version.refinedPrompt}</code>
                                  </pre>
                                </div>
                              </div>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
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
