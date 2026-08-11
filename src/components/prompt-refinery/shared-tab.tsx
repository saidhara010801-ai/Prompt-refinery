'use client';

import { useEffect, useState } from 'react';
import { FolderKanban, RefreshCw, Send } from 'lucide-react';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useWorkflow } from '@/context/workflow-context';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';

interface SharedItem {
  id: string;
  resourceType: 'project' | 'savedPrompt';
  resourceName: string;
  ownerEmail: string;
  permission: 'viewer' | 'editor';
  resource: {
    name: string;
    description?: string;
    originalPrompt?: string;
    refinedPrompt?: string;
    promptType?: string;
    memoryEntries?: Array<{ id: string; title: string; content: string; kind: string }>;
  };
}

export function SharedTab() {
  const { user } = useFirebase();
  const { toast } = useToast();
  const { sendToRefinery } = useWorkflow();
  const [items, setItems] = useState<SharedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, { originalPrompt: string; refinedPrompt: string; title: string; content: string }>>({});

  const api = async (url: string, init?: RequestInit) => {
    if (!user) throw new Error('Sign in to continue.');
    const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}`, ...(init?.headers ?? {}) } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || 'Sharing request failed.');
    return payload;
  };

  const load = () => {
    if (!user) return;
    setLoading(true);
    api('/api/shares/inbox').then((payload) => setItems(payload.shares)).catch((error) => toast({ variant: 'destructive', title: 'Could Not Load Shared Items', description: error.message })).finally(() => setLoading(false));
  };

  useEffect(() => { load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const save = async (item: SharedItem) => {
    const draft = drafts[item.id] ?? { originalPrompt: item.resource.originalPrompt ?? '', refinedPrompt: item.resource.refinedPrompt ?? '', title: '', content: '' };
    try {
      await api(`/api/shares/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: JSON.stringify(item.resourceType === 'savedPrompt' ? { originalPrompt: draft.originalPrompt, refinedPrompt: draft.refinedPrompt } : { title: draft.title, content: draft.content }) });
      toast({ title: item.resourceType === 'project' ? 'Memory Note Added' : 'Shared Prompt Updated' });
      setDrafts((current) => ({ ...current, [item.id]: { ...draft, title: '', content: '' } }));
      load();
    } catch (error) { toast({ variant: 'destructive', title: 'Could Not Save Changes', description: error instanceof Error ? error.message : 'Please try again.' }); }
  };

  return <Card>
    <CardHeader><CardTitle className="flex items-center justify-between gap-3"><span>Shared with Me</span><Button type="button" variant="outline" size="icon" onClick={load}><RefreshCw className="h-4 w-4" /><span className="sr-only">Refresh shared items</span></Button></CardTitle></CardHeader>
    <CardContent>
      {loading ? <div className="space-y-3"><Skeleton className="h-14" /><Skeleton className="h-14" /></div> : <Accordion type="single" collapsible className="space-y-2">
        {items.map((item) => {
          const draft = drafts[item.id] ?? { originalPrompt: item.resource.originalPrompt ?? '', refinedPrompt: item.resource.refinedPrompt ?? '', title: '', content: '' };
          return <AccordionItem key={item.id} value={item.id} className="rounded-md border px-4">
            <AccordionTrigger className="hover:no-underline"><div className="flex min-w-0 flex-1 items-center gap-3 pr-3"><FolderKanban className="h-4 w-4 shrink-0 text-primary" /><div className="min-w-0 text-left"><p className="truncate font-medium">{item.resource.name || item.resourceName}</p><p className="text-xs text-muted-foreground">{item.ownerEmail}</p></div><Badge variant="outline" className="ml-auto capitalize">{item.permission}</Badge></div></AccordionTrigger>
            <AccordionContent className="space-y-4 pt-2">
              {item.resourceType === 'savedPrompt' ? <>
                <Textarea value={draft.originalPrompt} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, originalPrompt: event.target.value } }))} readOnly={item.permission !== 'editor'} aria-label="Shared original prompt" />
                <Textarea value={draft.refinedPrompt} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, refinedPrompt: event.target.value } }))} readOnly={item.permission !== 'editor'} className="min-h-40 font-code" aria-label="Shared refined prompt" />
                <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => sendToRefinery({ source: 'saved-prompt', prompt: draft.originalPrompt, attachments: [{ name: `${item.resource.name}-shared.md`, mimeType: 'text/markdown', content: draft.refinedPrompt }] })}><Send className="h-4 w-4" />Refine</Button>{item.permission === 'editor' && <Button type="button" onClick={() => save(item)}>Save Content</Button>}</div>
              </> : <>
                <p className="text-sm text-muted-foreground">{item.resource.description}</p>
                <div className="max-h-72 space-y-2 overflow-y-auto">{(item.resource.memoryEntries ?? []).map((entry) => <div key={entry.id} className="rounded-md border bg-background p-3"><div className="flex items-center justify-between gap-2"><p className="font-medium">{entry.title}</p><Badge variant="secondary">{entry.kind}</Badge></div><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{entry.content}</p></div>)}</div>
                {item.permission === 'editor' && <div className="space-y-2 border-t pt-4"><Input value={draft.title} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, title: event.target.value } }))} placeholder="Memory note title" /><Textarea value={draft.content} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, content: event.target.value } }))} placeholder="Add content to project memory" /><Button type="button" onClick={() => save(item)} disabled={!draft.content.trim()}>Add Memory Note</Button></div>}
              </>}
            </AccordionContent>
          </AccordionItem>;
        })}
      </Accordion>}
      {!loading && items.length === 0 && <div className="py-12 text-center text-sm text-muted-foreground">Items shared with your Clarift account will appear here.</div>}
    </CardContent>
  </Card>;
}
