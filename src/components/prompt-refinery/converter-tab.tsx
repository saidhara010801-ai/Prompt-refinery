'use client';

import { ChangeEvent, useContext, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Eye,
  FileStack,
  FileText,
  FolderPlus,
  Send,
  Upload,
} from 'lucide-react';

import { createProjectMemoryEntryAction } from '@/app/project-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SubscriptionContext } from '@/context/subscription-context';
import { useWorkflow } from '@/context/workflow-context';
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import type { ConversionBatchResult, ConversionDocumentResult } from './stage2-types';
import type { Project } from './project-types';

interface ConverterTabProps {
  projects?: Project[] | null;
  selectedProject?: Project | null;
}

function downloadMarkdown(content: string, sourceName: string) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${sourceName.replace(/\.[^.]+$/, '') || 'converted-document'}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function canPreviewAsText(file: File) {
  return file.type.startsWith('text/') || /\.(md|csv|json|xml|yaml|yml|log|tsv|html?)$/i.test(file.name);
}

export function ConverterTab({ projects, selectedProject }: ConverterTabProps) {
  const { toast } = useToast();
  const { user } = useFirebase();
  const { isPro } = useContext(SubscriptionContext);
  const { sendToRefinery } = useWorkflow();
  const [isConverting, setIsConverting] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<ConversionBatchResult | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>('merged');
  const [hasCopied, setHasCopied] = useState(false);
  const [projectId, setProjectId] = useState(selectedProject?.id ?? '');
  const [textPreview, setTextPreview] = useState('');
  const selectedDocument = result?.documents.find((document) => document.id === selectedDocumentId) ?? null;
  const selectedIndex = selectedDocument ? result?.documents.findIndex((document) => document.id === selectedDocument.id) ?? -1 : -1;
  const selectedFile = selectedIndex >= 0 ? files[selectedIndex] : null;
  const displayedContent = selectedDocument?.content ?? result?.mergedContent ?? '';
  const displayedName = selectedDocument?.sourceName ?? (result ? 'Merged documents' : 'Markdown Output');

  useEffect(() => {
    if (selectedProject?.id) setProjectId(selectedProject.id);
  }, [selectedProject]);

  useEffect(() => {
    if (!selectedFile || !canPreviewAsText(selectedFile)) {
      setTextPreview('');
      return;
    }
    selectedFile.text().then((text) => setTextPreview(text.slice(0, 20000))).catch(() => setTextPreview(''));
  }, [selectedFile]);

  const previewUrl = useMemo(() => selectedFile ? URL.createObjectURL(selectedFile) : '', [selectedFile]);
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    let nextFiles = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (nextFiles.length === 0) return;
    if (!isPro && nextFiles.length > 1) {
      nextFiles = nextFiles.slice(0, 1);
      toast({ title: 'Single-file conversion on Free', description: 'Upgrade to Pro to convert and merge batches.' });
    }

    setIsConverting(true);
    setFiles(nextFiles);
    setResult(null);
    try {
      const formData = new FormData();
      nextFiles.forEach((file) => formData.append('files', file));
      const firebaseIdToken = await user?.getIdToken();
      const response = await fetch('/api/markitdown', {
        method: 'POST',
        headers: firebaseIdToken ? { Authorization: `Bearer ${firebaseIdToken}` } : undefined,
        body: formData,
      });
      const batch = await response.json() as ConversionBatchResult & { error?: string };
      if (!response.ok || !batch.documents?.length) throw new Error(batch.error || 'Could not convert these documents.');
      setResult(batch);
      setSelectedDocumentId(batch.documents.length === 1 ? batch.documents[0].id : 'merged');
      if (batch.documents.some((document) => document.truncated) || batch.mergedTruncated) {
        toast({ title: 'Converted with a size limit', description: 'One or more outputs were truncated for safe reuse.' });
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Conversion unavailable',
        description: error instanceof Error ? error.message : 'Could not convert these documents.',
      });
    } finally {
      setIsConverting(false);
    }
  };

  const copyMarkdown = async () => {
    await navigator.clipboard.writeText(displayedContent);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2000);
  };

  const transferToRefinery = (target: 'prompt' | 'reference') => {
    sendToRefinery({
      source: 'converter',
      prompt: target === 'prompt' ? displayedContent : undefined,
      attachments: target === 'reference' ? [{
        name: `${displayedName.replace(/\.[^.]+$/, '')}.md`,
        mimeType: 'text/markdown',
        content: displayedContent,
      }] : undefined,
      projectId: projectId || null,
    });
    toast({ title: 'Sent to Refinery', description: target === 'prompt' ? 'Markdown is ready as the prompt.' : 'Markdown is attached as reference context.' });
  };

  const attachToProject = async () => {
    if (!user || !projectId || !displayedContent) return;
    try {
      await createProjectMemoryEntryAction({
        firebaseIdToken: await user.getIdToken(),
        projectId,
        kind: 'converter',
        title: displayedName,
        content: displayedContent,
      });
      toast({ title: 'Added to Project Memory', description: `${displayedName} is now available as project context.` });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could Not Add Memory', description: error instanceof Error ? error.message : 'Please try again.' });
    }
  };

  const renderOriginalPreview = () => {
    if (!selectedFile) {
      return <p className="text-sm text-muted-foreground">Select an individual document to inspect its original.</p>;
    }
    if (selectedFile.type === 'application/pdf' || selectedFile.name.toLowerCase().endsWith('.pdf')) {
      return <iframe title={`Original ${selectedFile.name}`} src={previewUrl} className="h-[420px] w-full border-0" />;
    }
    if (selectedFile.type.startsWith('image/')) {
      return <div className="relative h-[420px] w-full"><Image src={previewUrl} alt={`Original ${selectedFile.name}`} fill unoptimized className="object-contain" /></div>;
    }
    if (textPreview) {
      return <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap p-3 font-code text-xs"><code>{textPreview}</code></pre>;
    }
    return (
      <div className="space-y-3 p-4 text-sm">
        <p className="font-semibold">{selectedFile.name}</p>
        <p className="text-muted-foreground">Native Office rendering is unavailable in the browser. Compare the extracted structure below with the source application.</p>
        {selectedDocument && (
          <dl className="grid grid-cols-3 gap-3 text-center">
            <div><dt className="text-xs text-muted-foreground">Headings</dt><dd className="font-semibold">{selectedDocument.structure.headings}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Tables</dt><dd className="font-semibold">{selectedDocument.structure.tables}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Lists</dt><dd className="font-semibold">{selectedDocument.structure.listItems}</dd></div>
          </dl>
        )}
      </div>
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="space-y-5 rounded-md border border-primary/20 bg-background p-4">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Format Converter</h2>
        </div>
        <p className="text-sm text-muted-foreground">Convert documents into reusable Markdown, project context, or a ready-to-refine prompt.</p>
        <Button type="button" className="w-full" asChild disabled={isConverting}>
          <label htmlFor="converter-upload" className="cursor-pointer">
            <Upload className="h-4 w-4" />
            {isConverting ? 'Converting...' : isPro ? 'Choose Documents' : 'Choose Document'}
          </label>
        </Button>
        <input
          id="converter-upload"
          type="file"
          multiple={isPro}
          accept=".csv,.docx,.html,.json,.md,.pdf,.pptx,.txt,.xls,.xlsx,.xml,.yaml,.yml"
          onChange={handleFileChange}
          className="sr-only"
          disabled={isConverting}
        />
        <p className="text-xs text-muted-foreground">10 MB per file, 25 MB per batch. Batch conversion is available on Pro.</p>

        {result && (
          <div className="space-y-2">
            {result.documents.length > 1 && (
              <button type="button" onClick={() => setSelectedDocumentId('merged')} className={`flex w-full items-center gap-2 rounded-md border p-2 text-left text-sm ${selectedDocumentId === 'merged' ? 'border-primary bg-primary/5' : ''}`}>
                <FileStack className="h-4 w-4 text-primary" />
                <span className="truncate">Merged output</span>
              </button>
            )}
            {result.documents.map((document) => (
              <button key={document.id} type="button" onClick={() => setSelectedDocumentId(document.id)} className={`flex w-full items-center gap-2 rounded-md border p-2 text-left text-sm ${selectedDocumentId === document.id ? 'border-primary bg-primary/5' : ''}`}>
                <FileText className="h-4 w-4 text-primary" />
                <span className="truncate">{document.sourceName}</span>
              </button>
            ))}
          </div>
        )}
      </aside>

      <section className="min-w-0 space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-xl">
              <span>{displayedName}</span>
              {displayedContent && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={copyMarkdown}>{hasCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{hasCopied ? 'Copied' : 'Copy'}</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => downloadMarkdown(displayedContent, displayedName)}><Download className="h-4 w-4" />Export</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => transferToRefinery('prompt')}><Send className="h-4 w-4" />As Prompt</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => transferToRefinery('reference')}><FileText className="h-4 w-4" />As Reference</Button>
                </div>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="min-h-[300px]">
            {isConverting && <div className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /></div>}
            {!isConverting && displayedContent && <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-4 font-code text-sm"><code>{displayedContent}</code></pre>}
            {!isConverting && result && !displayedContent && <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 text-center"><AlertTriangle className="h-6 w-6 text-amber-500" /><p className="text-sm">No extractable text was found. This document may require OCR.</p></div>}
            {!isConverting && !result && <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">Converted Markdown will appear here.</div>}
          </CardContent>
        </Card>

        {selectedDocument?.warnings.map((warning) => (
          <div key={warning} className="flex gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"><AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" /><span>{warning}</span></div>
        ))}

        {selectedDocument && (
          <div className="grid gap-4 md:grid-cols-4">
            {Object.entries(selectedDocument.tokenCounts).map(([model, count]) => (
              <div key={model} className="rounded-md border bg-background p-3 text-center"><p className="text-xs capitalize text-muted-foreground">{model}</p><p className="text-lg font-semibold">{count}</p></div>
            ))}
          </div>
        )}

        {displayedContent && isPro && projects?.length ? (
          <div className="flex flex-col gap-3 rounded-md border bg-background p-3 sm:flex-row sm:items-center">
            <Select value={projectId} onValueChange={setProjectId}><SelectTrigger className="sm:w-64"><SelectValue placeholder="Choose project" /></SelectTrigger><SelectContent>{projects.filter((project) => project.status !== 'trashed').map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select>
            <Button type="button" variant="outline" onClick={attachToProject} disabled={!projectId}><FolderPlus className="h-4 w-4" />Add to Project Memory</Button>
          </div>
        ) : null}

        {selectedDocument && (
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="overflow-hidden rounded-md border bg-background"><div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-semibold"><Eye className="h-4 w-4" />Original</div>{renderOriginalPreview()}</div>
            <div className="overflow-hidden rounded-md border bg-background"><div className="border-b px-3 py-2 text-sm font-semibold">Markdown structure</div><pre className="max-h-[420px] overflow-auto whitespace-pre-wrap p-3 font-code text-xs"><code>{selectedDocument.content}</code></pre></div>
          </div>
        )}
      </section>
    </div>
  );
}
