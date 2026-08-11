'use client';

import { useContext, useMemo, useState } from 'react';
import { collection, orderBy, query } from 'firebase/firestore';
import { Download, Folder, Search, Send, Tags, Trash2 } from 'lucide-react';

import { deleteSavedPromptAction, updateSavedPromptMetadataAction } from '@/app/subscription-actions';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SubscriptionContext } from '@/context/subscription-context';
import { useWorkflow } from '@/context/workflow-context';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { CopyButton } from './copy-button';
import { ShareDialog } from './share-dialog';

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
  folder?: string | null;
  tags?: string[];
  saveTimestamp: { seconds: number; nanoseconds: number };
}

function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function versionsFor(prompt: SavedPrompt): PromptVersion[] {
  return prompt.versions?.length ? prompt.versions : [{
    version: 1,
    rawPrompt: prompt.originalPrompt,
    refinedPrompt: prompt.refinedPrompt,
    promptType: prompt.promptType,
    createdAt: new Date((prompt.saveTimestamp?.seconds ?? Date.now() / 1000) * 1000).toISOString(),
  }];
}

export function SavedPromptsTab() {
  const { firestore, user } = useFirebase();
  const { toast } = useToast();
  const { isPro, savedPromptCount, savedPromptLimit } = useContext(SubscriptionContext);
  const { sendToRefinery } = useWorkflow();
  const [search, setSearch] = useState('');
  const [folderFilter, setFolderFilter] = useState('__all__');
  const [drafts, setDrafts] = useState<Record<string, { name: string; folder: string; tags: string }>>({});

  const savedPromptsQuery = useMemoFirebase(() => user && firestore ? query(
    collection(firestore, `users/${user.uid}/savedPrompts`),
    orderBy('saveTimestamp', 'desc')
  ) : null, [user, firestore]);
  const { data: savedPrompts, isLoading } = useCollection<SavedPrompt>(savedPromptsQuery);

  const folders = useMemo(() => Array.from(new Set((savedPrompts ?? []).map((prompt) => prompt.folder).filter((folder): folder is string => Boolean(folder)))).sort(), [savedPrompts]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (savedPrompts ?? []).filter((prompt) => {
      const matchesFolder = folderFilter === '__all__' || (folderFilter === '__unfiled__' ? !prompt.folder : prompt.folder === folderFilter);
      const haystack = [prompt.name, prompt.originalPrompt, prompt.refinedPrompt, prompt.promptType, prompt.folder, ...(prompt.tags ?? [])].filter(Boolean).join(' ').toLowerCase();
      return matchesFolder && (!needle || haystack.includes(needle));
    });
  }, [folderFilter, savedPrompts, search]);

  const groups = useMemo(() => {
    const result = new Map<string, SavedPrompt[]>();
    filtered.forEach((prompt) => {
      const folder = prompt.folder || 'Unfiled';
      result.set(folder, [...(result.get(folder) ?? []), prompt]);
    });
    return Array.from(result.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const removePrompt = async (promptId: string) => {
    if (!user) return;
    try {
      await deleteSavedPromptAction({ firebaseIdToken: await user.getIdToken(), promptId });
      toast({ title: 'Prompt Deleted', description: 'The saved prompt has been removed.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could Not Delete Prompt', description: error instanceof Error ? error.message : 'Please try again.' });
    }
  };

  const saveMetadata = async (prompt: SavedPrompt) => {
    if (!user) return;
    const draft = drafts[prompt.id] ?? { name: prompt.name, folder: prompt.folder ?? '', tags: (prompt.tags ?? []).join(', ') };
    try {
      await updateSavedPromptMetadataAction({
        firebaseIdToken: await user.getIdToken(),
        promptId: prompt.id,
        name: draft.name,
        folder: draft.folder || null,
        tags: draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 10),
      });
      toast({ title: 'Prompt Organized', description: 'Folder and tags were saved.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could Not Update Prompt', description: error instanceof Error ? error.message : 'Please try again.' });
    }
  };

  const exportPrompts = (format: 'markdown' | 'json') => {
    if (format === 'json') {
      download(JSON.stringify(filtered, null, 2), 'clarift-saved-prompts.json', 'application/json');
      return;
    }
    const content = filtered.map((prompt) => `# ${prompt.name}\n\n- Folder: ${prompt.folder || 'Unfiled'}\n- Tags: ${(prompt.tags ?? []).join(', ') || 'None'}\n- Technique: ${prompt.promptType}\n\n## Original\n\n${prompt.originalPrompt}\n\n## Refined\n\n${prompt.refinedPrompt}`).join('\n\n---\n\n');
    download(content, 'clarift-saved-prompts.md', 'text/markdown');
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-3"><span>Your Saved Prompts</span><Badge variant="outline">{savedPromptCount}/{isPro ? 'unlimited' : savedPromptLimit}</Badge></CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search names, prompts, tags, or folders" className="pl-9" /></div>
          <Select value={folderFilter} onValueChange={setFolderFilter}><SelectTrigger className="lg:w-52"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__all__">All folders</SelectItem><SelectItem value="__unfiled__">Unfiled</SelectItem>{folders.map((folder) => <SelectItem key={folder} value={folder}>{folder}</SelectItem>)}</SelectContent></Select>
          <Button type="button" variant="outline" onClick={() => exportPrompts('markdown')} disabled={filtered.length === 0}><Download className="h-4 w-4" />Markdown</Button>
          <Button type="button" variant="outline" onClick={() => exportPrompts('json')} disabled={filtered.length === 0}><Download className="h-4 w-4" />JSON</Button>
        </div>

        {isLoading && <div className="space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>}
        {!isLoading && groups.map(([folder, prompts]) => (
          <section key={folder} className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Folder className="h-4 w-4 text-primary" />{folder}<Badge variant="secondary">{prompts.length}</Badge></h3>
            <Accordion type="single" collapsible className="space-y-2">
              {prompts.map((prompt) => {
                const draft = drafts[prompt.id] ?? { name: prompt.name, folder: prompt.folder ?? '', tags: (prompt.tags ?? []).join(', ') };
                return (
                  <AccordionItem value={prompt.id} key={prompt.id} className="rounded-md border px-4">
                    <AccordionTrigger className="hover:no-underline"><div className="flex min-w-0 flex-1 flex-col items-start gap-2 pr-3 sm:flex-row sm:items-center sm:justify-between"><span className="max-w-full truncate text-left font-semibold">{prompt.name}</span><span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"><Badge variant="outline">v{prompt.latestVersion ?? prompt.versionCount ?? 1}</Badge>{new Date(prompt.saveTimestamp.seconds * 1000).toLocaleDateString()}</span></div></AccordionTrigger>
                    <AccordionContent className="space-y-4 pt-2">
                      <div className="grid gap-3 md:grid-cols-2"><Input value={draft.name} onChange={(event) => setDrafts((current) => ({ ...current, [prompt.id]: { ...draft, name: event.target.value } }))} aria-label="Prompt name" /><Input value={draft.folder} onChange={(event) => setDrafts((current) => ({ ...current, [prompt.id]: { ...draft, folder: event.target.value } }))} placeholder="Folder" /></div>
                      <div className="flex gap-2"><Tags className="mt-2 h-4 w-4 text-primary" /><Input value={draft.tags} onChange={(event) => setDrafts((current) => ({ ...current, [prompt.id]: { ...draft, tags: event.target.value } }))} placeholder="Tags separated by commas" /></div>
                      <Button type="button" variant="outline" size="sm" onClick={() => saveMetadata(prompt)}>Save Organization</Button>
                      <div><h4 className="mb-1 text-sm font-semibold">Original Prompt</h4><p className="rounded-md border bg-background p-3 text-sm text-muted-foreground">{prompt.originalPrompt}</p></div>
                      <div><h4 className="mb-1 text-sm font-semibold">Refined Prompt</h4><div className="relative"><CopyButton textToCopy={prompt.refinedPrompt} className="absolute right-2 top-2 z-10" /><pre className="whitespace-pre-wrap rounded-md border bg-background p-3 font-code text-sm"><code>{prompt.refinedPrompt}</code></pre></div></div>
                      <Accordion type="single" collapsible><AccordionItem value={`${prompt.id}-versions`}><AccordionTrigger>Version History</AccordionTrigger><AccordionContent className="space-y-3">{versionsFor(prompt).map((version) => <div key={`${prompt.id}-${version.version}`} className="space-y-2 rounded-md border bg-background p-3"><div className="flex justify-between"><Badge variant="secondary">Version {version.version}</Badge><span className="text-xs text-muted-foreground">{new Date(version.createdAt).toLocaleDateString()}</span></div><p className="text-xs text-muted-foreground">{version.rawPrompt}</p><pre className="whitespace-pre-wrap rounded bg-muted p-2 font-code text-xs"><code>{version.refinedPrompt}</code></pre></div>)}</AccordionContent></AccordionItem></Accordion>
                      <div className="flex flex-wrap items-center justify-between gap-2"><Badge>{prompt.promptType}</Badge><div className="flex flex-wrap gap-2">{isPro && <ShareDialog resourceType="savedPrompt" resourceId={prompt.id} resourceName={prompt.name} />}<Button type="button" variant="outline" size="sm" onClick={() => { sendToRefinery({ source: 'saved-prompt', prompt: prompt.originalPrompt, attachments: [{ name: `${prompt.name}-previous.md`, mimeType: 'text/markdown', content: prompt.refinedPrompt }] }); toast({ title: 'Sent to Refinery' }); }}><Send className="h-4 w-4" />Refine Again</Button><Button type="button" variant="ghost" size="icon" onClick={() => removePrompt(prompt.id)}><Trash2 className="h-4 w-4 text-red-500" /><span className="sr-only">Delete prompt</span></Button></div></div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </section>
        ))}
        {!isLoading && filtered.length === 0 && <div className="py-12 text-center text-sm text-muted-foreground">No saved prompts match these filters.</div>}
      </CardContent>
    </Card>
  );
}
