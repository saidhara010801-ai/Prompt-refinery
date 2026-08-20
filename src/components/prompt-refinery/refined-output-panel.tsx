'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BrainCircuit, Cpu, GitCompareArrows, Save, Sparkles, Wind, Zap } from 'lucide-react';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { OutputActions } from './output-actions';
import type { PromptVersion, Refinement, TokenCounts } from './refinery-types';

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
    return {
      id: `${part}-${index}`,
      text: part,
      isWhitespace: /^\s+$/.test(part),
      isNew: normalized.length > 0 && !originalWords.has(normalized),
    };
  });
}

interface RefinedOutputPanelProps {
  isLoading: boolean;
  refinedPrompt: string | null;
  rawPromptAtResult: string | null;
  refinements: Refinement[];
  tokenCounts: TokenCounts | null;
  isTokenizing: boolean;
  promptVersions: PromptVersion[];
  explanationMode: boolean;
  promptType: string;
  canSave: boolean;
  onSavePrompt: () => void;
}

export function RefinedOutputPanel({
  isLoading,
  refinedPrompt,
  rawPromptAtResult,
  refinements,
  tokenCounts,
  isTokenizing,
  promptVersions,
  explanationMode,
  promptType,
  canSave,
  onSavePrompt,
}: RefinedOutputPanelProps) {
  const [diffFromVersion, setDiffFromVersion] = useState(1);
  const [diffToVersion, setDiffToVersion] = useState(1);

  useEffect(() => {
    const latestVersion = promptVersions.at(-1)?.version ?? 1;
    setDiffFromVersion(Math.max(1, latestVersion - 1));
    setDiffToVersion(latestVersion);
  }, [promptVersions]);
  const diffTokens = useMemo(
    () => rawPromptAtResult && refinedPrompt ? buildDiffTokens(rawPromptAtResult, refinedPrompt) : [],
    [rawPromptAtResult, refinedPrompt]
  );
  const fromVersion = promptVersions.find((version) => version.version === diffFromVersion);
  const toVersion = promptVersions.find((version) => version.version === diffToVersion);
  const versionDiffTokens = useMemo(
    () => fromVersion && toVersion ? buildDiffTokens(fromVersion.refinedPrompt, toVersion.refinedPrompt) : [],
    [fromVersion, toVersion]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="text-primary" />
            <span>Refined Output</span>
            {promptVersions.length > 0 && <Badge variant="outline">v{promptVersions.at(-1)?.version}</Badge>}
          </div>
          {refinedPrompt && (
            <Button variant="outline" size="sm" onClick={onSavePrompt} disabled={!canSave}>
              <Save className="mr-2 h-4 w-4" />
              Save Prompt
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="min-h-[300px]">
        <AnimatePresence mode="wait">
          {isLoading && (
            <motion.div key="loader" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </motion.div>
          )}
          {!isLoading && refinedPrompt && (
            <motion.div key="result" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              <div className="space-y-3">
                <div className="flex justify-end">
                  <OutputActions prompt={refinedPrompt} originalPrompt={rawPromptAtResult ?? undefined} promptType={promptType} />
                </div>
                <pre className="whitespace-pre-wrap rounded-md bg-muted p-4 font-code text-sm"><code>{refinedPrompt}</code></pre>
              </div>

              {rawPromptAtResult && (
                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="diff">
                    <AccordionTrigger><span className="flex items-center gap-2"><GitCompareArrows className="h-4 w-4" />Before / After Diff</span></AccordionTrigger>
                    <AccordionContent>
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div><h4 className="mb-2 text-sm font-semibold">Before</h4><pre className="whitespace-pre-wrap rounded-md border bg-background p-3 font-code text-xs"><code>{rawPromptAtResult}</code></pre></div>
                        <div><h4 className="mb-2 text-sm font-semibold">After</h4><div className="whitespace-pre-wrap rounded-md border bg-background p-3 font-code text-xs">{diffTokens.map((token) => token.isWhitespace ? token.text : <span key={token.id} className={token.isNew ? 'rounded bg-green-500/15 text-green-700 dark:text-green-300' : undefined}>{token.text}</span>)}</div></div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}

              {promptVersions.length > 1 && (
                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="version-diff">
                    <AccordionTrigger>Compare Prompt Versions</AccordionTrigger>
                    <AccordionContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Select value={String(diffFromVersion)} onValueChange={(value) => setDiffFromVersion(Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{promptVersions.map((version) => <SelectItem key={`from-${version.version}`} value={String(version.version)}>Version {version.version}</SelectItem>)}</SelectContent></Select>
                        <Select value={String(diffToVersion)} onValueChange={(value) => setDiffToVersion(Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{promptVersions.map((version) => <SelectItem key={`to-${version.version}`} value={String(version.version)}>Version {version.version}</SelectItem>)}</SelectContent></Select>
                      </div>
                      <div className="grid gap-4 lg:grid-cols-2">
                        <pre className="whitespace-pre-wrap rounded-md border bg-background p-3 font-code text-xs"><code>{fromVersion?.refinedPrompt}</code></pre>
                        <div className="whitespace-pre-wrap rounded-md border bg-background p-3 font-code text-xs">{versionDiffTokens.map((token) => token.isWhitespace ? token.text : <span key={token.id} className={token.isNew ? 'rounded bg-green-500/15 text-green-700 dark:text-green-300' : undefined}>{token.text}</span>)}</div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}

              {isTokenizing && <div className="space-y-2"><Skeleton className="h-5 w-1/3" /><div className="grid grid-cols-2 gap-4 md:grid-cols-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div></div>}
              {tokenCounts && (
                <div>
                  <h4 className="mb-2 font-semibold">Estimated Token Counts</h4>
                  <div className="grid grid-cols-2 gap-4 text-center md:grid-cols-4">
                    <div className="rounded-lg bg-muted p-3"><p className="flex items-center justify-center gap-2 text-lg font-bold"><BrainCircuit />Gemini</p><p className="text-sm">{tokenCounts.gemini}</p></div>
                    <div className="rounded-lg bg-muted p-3"><p className="flex items-center justify-center gap-2 text-lg font-bold"><Zap />OpenAI</p><p className="text-sm">{tokenCounts.openai}</p></div>
                    <div className="rounded-lg bg-muted p-3"><p className="flex items-center justify-center gap-2 text-lg font-bold"><Cpu />DeepSeek</p><p className="text-sm">{tokenCounts.deepseek}</p></div>
                    <div className="rounded-lg bg-muted p-3"><p className="flex items-center justify-center gap-2 text-lg font-bold"><Wind />Qwen</p><p className="text-sm">{tokenCounts.qwen}</p></div>
                  </div>
                </div>
              )}
              {explanationMode && (
                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="explanations">
                    <AccordionTrigger>View Council Explanations</AccordionTrigger>
                    <AccordionContent><div className="space-y-4">{refinements.map((refinement, index) => <div key={index} className="rounded-lg border bg-background p-4"><h4 className="font-semibold text-primary">{refinement.councilMember}</h4><p className="mb-2 mt-1 text-sm italic text-muted-foreground">&quot;{refinement.thoughtProcess}&quot;</p><pre className="whitespace-pre-wrap rounded-md bg-muted p-3 font-code text-xs"><code>{refinement.refinedText}</code></pre></div>)}</div></AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
            </motion.div>
          )}
          {!isLoading && !refinedPrompt && <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground"><p>Your refined prompt will appear here.</p></div>}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
