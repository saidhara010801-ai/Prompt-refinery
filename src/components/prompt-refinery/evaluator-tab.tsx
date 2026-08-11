'use client';

import { useContext, useMemo, useState } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { CheckCircle, Gauge, History, Lightbulb, Scale, Wand2, XCircle } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';

import { evaluateGuidelinesAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiKeyContext } from '@/context/api-key-context';
import { useWorkflow } from '@/context/workflow-context';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { LLM_COUNCIL_GUIDELINES } from '@/lib/constants';
import type { EvaluationRun } from './stage2-types';

const dimensionLabels = {
  clarity: 'Clarity',
  context: 'Context',
  structure: 'Structure',
  specificity: 'Specificity',
};

export function EvaluatorTab() {
  const [prompt, setPrompt] = useState('');
  const [selectedGuidelines, setSelectedGuidelines] = useState<string[]>([LLM_COUNCIL_GUIDELINES[0].value]);
  const [isLoading, setIsLoading] = useState(false);
  const [evaluation, setEvaluation] = useState<EvaluationRun | null>(null);
  const { apiKey } = useContext(ApiKeyContext);
  const { user, firestore } = useFirebase();
  const { toast } = useToast();
  const { sendToRefinery } = useWorkflow();

  const historyQuery = useMemoFirebase(() => user && firestore ? query(
    collection(firestore, `users/${user.uid}/evaluationRuns`),
    orderBy('createdAt', 'desc'),
    limit(20)
  ) : null, [user, firestore]);
  const { data: history, isLoading: isLoadingHistory } = useCollection<EvaluationRun>(historyQuery);
  const trend = useMemo(() => (history ?? []).slice().reverse().map((run, index) => ({
    name: `#${index + 1}`,
    score: run.combinedScore,
  })), [history]);

  const toggleGuideline = (guideline: string, checked: boolean) => {
    setSelectedGuidelines((current) => checked
      ? Array.from(new Set([...current, guideline]))
      : current.filter((value) => value !== guideline));
  };

  const evaluate = async () => {
    if (!user || prompt.trim().length < 10 || selectedGuidelines.length === 0) return;
    setIsLoading(true);
    setEvaluation(null);
    try {
      const result = await evaluateGuidelinesAction({
        firebaseIdToken: await user.getIdToken(),
        prompt: prompt.trim(),
        guidelines: selectedGuidelines,
        apiKey: apiKey || undefined,
      });
      setEvaluation({ ...result, prompt: prompt.trim(), guidelines: selectedGuidelines });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Evaluation Failed', description: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setIsLoading(false);
    }
  };

  const applyFix = () => {
    if (!evaluation) return;
    const recommendations = evaluation.results.flatMap((result) => result.recommendations);
    sendToRefinery({
      source: 'evaluator',
      prompt: evaluation.prompt,
      attachments: [{
        name: 'evaluation-recommendations.md',
        mimeType: 'text/markdown',
        content: `# Evaluation recommendations\n\n${recommendations.map((recommendation) => `- ${recommendation}`).join('\n')}`,
      }],
    });
    toast({ title: 'Fix Sent to Refinery', description: 'The prompt and evaluation recommendations are ready to refine.' });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <Card className="border-primary/20">
        <CardHeader><CardTitle className="flex items-center gap-2"><Scale className="text-primary" />Evaluate Guidelines</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="evaluation-prompt" className="text-sm font-medium">Your Prompt</label>
            <Textarea id="evaluation-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Enter the prompt to evaluate." className="min-h-40 font-code" />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">Guidelines</p><button type="button" className="text-xs text-primary" onClick={() => setSelectedGuidelines(LLM_COUNCIL_GUIDELINES.map((guideline) => guideline.value))}>Select all</button></div>
            {LLM_COUNCIL_GUIDELINES.map((guideline) => (
              <label key={guideline.value} className="flex items-start gap-3 rounded-md border p-3 text-sm">
                <Checkbox checked={selectedGuidelines.includes(guideline.value)} onCheckedChange={(checked) => toggleGuideline(guideline.value, checked === true)} />
                <span>{guideline.label}</span>
              </label>
            ))}
          </div>
          <Button type="button" className="w-full" onClick={evaluate} disabled={isLoading || !user || prompt.trim().length < 10 || selectedGuidelines.length === 0}>{isLoading ? 'Evaluating...' : `Evaluate ${selectedGuidelines.length} Guideline${selectedGuidelines.length === 1 ? '' : 's'}`}</Button>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-3"><span className="flex items-center gap-2"><Lightbulb className="text-primary" />Evaluation Scorecard</span>{evaluation && <Button type="button" size="sm" onClick={applyFix}><Wand2 className="h-4 w-4" />Apply Fix</Button>}</CardTitle></CardHeader>
          <CardContent className="min-h-80">
            {isLoading && <div className="space-y-3"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-32 w-full" /></div>}
            {!isLoading && evaluation && (
              <div className="space-y-5">
                <div className="rounded-md border p-4"><div className="mb-2 flex items-center justify-between"><span className="flex items-center gap-2 font-semibold"><Gauge className="h-4 w-4 text-primary" />Combined Score</span><span className="text-2xl font-bold">{evaluation.combinedScore}</span></div><Progress value={evaluation.combinedScore} /></div>
                {evaluation.results.map((result) => (
                  <div key={result.guideline} className="space-y-3 rounded-md border p-4">
                    <div className="flex items-start gap-2 font-semibold">{result.shouldInclude ? <CheckCircle className="h-5 w-5 shrink-0 text-green-600" /> : <XCircle className="h-5 w-5 shrink-0 text-red-500" />}<span>{result.guideline}</span><span className="ml-auto">{result.score}</span></div>
                    <p className="text-sm text-muted-foreground">{result.reason}</p>
                    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">{Object.entries(result.dimensionScores).map(([dimension, score]) => <div key={dimension} className="rounded bg-muted p-2 text-center"><span className="block text-muted-foreground">{dimensionLabels[dimension as keyof typeof dimensionLabels]}</span><strong>{score}</strong></div>)}</div>
                    {result.recommendations.length > 0 && <ul className="space-y-1 text-sm">{result.recommendations.map((recommendation, index) => <li key={`${result.guideline}-${index}`} className="rounded bg-muted/60 p-2">{recommendation}</li>)}</ul>}
                  </div>
                ))}
              </div>
            )}
            {!isLoading && !evaluation && <div className="flex min-h-64 items-center justify-center text-center text-sm text-muted-foreground">The combined scorecard will appear here.</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><History className="h-5 w-5 text-primary" />Score Trend</CardTitle></CardHeader>
          <CardContent>
            {isLoadingHistory && <Skeleton className="h-48 w-full" />}
            {!isLoadingHistory && trend.length > 1 && <div className="h-52 w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={trend}><XAxis dataKey="name" /><YAxis domain={[0, 100]} /><ChartTooltip /><Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} /></LineChart></ResponsiveContainer></div>}
            {!isLoadingHistory && trend.length <= 1 && <p className="py-10 text-center text-sm text-muted-foreground">Run at least two evaluations to see a trend.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
