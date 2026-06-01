'use client';

import { ChangeEvent, useState } from 'react';
import { Check, Copy, Download, FileText, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

interface ConversionResult {
  content: string;
  truncated?: boolean;
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

export function ConverterTab() {
  const { toast } = useToast();
  const [isConverting, setIsConverting] = useState(false);
  const [sourceName, setSourceName] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [hasCopied, setHasCopied] = useState(false);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    setIsConverting(true);
    setMarkdown('');
    setSourceName(file.name);

    try {
      const formData = new FormData();
      formData.set('file', file);
      const response = await fetch('/api/markitdown', { method: 'POST', body: formData });
      const result = await response.json() as ConversionResult & { error?: string };

      if (!response.ok || !result.content) {
        throw new Error(result.error || 'Could not convert this document.');
      }

      setMarkdown(result.content);
      if (result.truncated) {
        toast({
          title: 'Converted with a size limit',
          description: 'The preview contains the first 12,000 characters of the document.',
        });
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Conversion unavailable',
        description: error instanceof Error ? error.message : 'Could not convert this document.',
      });
    } finally {
      setIsConverting(false);
    }
  };

  const copyMarkdown = async () => {
    await navigator.clipboard.writeText(markdown);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2000);
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[340px_1fr]">
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <FileText className="h-5 w-5 text-primary" />
            Format Converter
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Convert a document into clean Markdown for reuse in prompts, notes, or project memory.
          </p>
          <Button type="button" className="w-full" asChild disabled={isConverting}>
            <label htmlFor="converter-upload" className="cursor-pointer">
              <Upload className="h-4 w-4" />
              {isConverting ? 'Converting...' : 'Choose Document'}
            </label>
          </Button>
          <input
            id="converter-upload"
            type="file"
            accept=".csv,.docx,.html,.json,.md,.pdf,.pptx,.txt,.xls,.xlsx,.xml,.yaml,.yml"
            onChange={handleFileChange}
            className="sr-only"
            disabled={isConverting}
          />
          <p className="text-xs text-muted-foreground">
            Supports PDF, DOCX, PPTX, XLSX, CSV, HTML, JSON, and text documents up to 10 MB.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-xl">
            <span>{sourceName || 'Markdown Output'}</span>
            {markdown && (
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={copyMarkdown}>
                  {hasCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {hasCopied ? 'Copied' : 'Copy'}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => downloadMarkdown(markdown, sourceName)}>
                  <Download className="h-4 w-4" />
                  Export
                </Button>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="min-h-[320px]">
          {isConverting && (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          )}
          {!isConverting && markdown && (
            <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap rounded-md border bg-muted p-4 font-code text-sm">
              <code>{markdown}</code>
            </pre>
          )}
          {!isConverting && !markdown && (
            <div className="flex min-h-[260px] items-center justify-center text-center text-sm text-muted-foreground">
              Converted Markdown will appear here.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
