'use client';

import { useState, useContext } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Scale, Lightbulb, CheckCircle, XCircle, Gauge } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { LLM_COUNCIL_GUIDELINES, LlmCouncilGuideline } from '@/lib/constants';
import { evaluateGuidelineAction } from '@/app/actions';
import { ApiKeyContext } from '@/context/api-key-context';
import { SettingsContext } from '@/context/settings-context';
import { Progress } from '@/components/ui/progress';

const formSchema = z.object({
  prompt: z.string().min(10, { message: 'Please enter a prompt of at least 10 characters.' }),
  guideline: z.enum(LLM_COUNCIL_GUIDELINES.map(g => g.value) as [LlmCouncilGuideline, ...LlmCouncilGuideline[]]),
});

type FormValues = z.infer<typeof formSchema>;

interface EvaluationResult {
  shouldInclude: boolean;
  reason: string;
  score: number;
  dimensionScores: {
    clarity: number;
    context: number;
    structure: number;
    specificity: number;
  };
  recommendations: string[];
}

const dimensionLabels: Record<keyof EvaluationResult['dimensionScores'], string> = {
  clarity: 'Clarity',
  context: 'Context',
  structure: 'Structure',
  specificity: 'Specificity',
};

function getErrorToast(error: unknown): { title: string; description: string } {
  const errorName = error instanceof Error ? error.name : '';
  const errorMessage = error instanceof Error ? error.message : '';

  if (errorName === 'ApiKeyMissingError' || errorMessage.includes('API key is missing')) {
    return {
      title: 'API Key Missing',
      description: 'Add your Gemini API key in Settings, then try evaluating again.',
    };
  }

  if (errorName === 'ApiKeyInvalidError' || errorMessage.includes('API key looks invalid')) {
    return {
      title: 'Invalid API Key',
      description: 'Check your Gemini API key in Settings and save the corrected key.',
    };
  }

  if (errorName === 'ApiQuotaError' || errorMessage.includes('quota')) {
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

export function EvaluatorTab() {
  const [isLoading, setIsLoading] = useState(false);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const { toast } = useToast();
  const { apiKey } = useContext(ApiKeyContext);
  const { triggerAnimation } = useContext(SettingsContext);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      prompt: '',
      guideline: 'Be specific and provide context',
    },
  });

  const onSubmit = async (data: FormValues) => {
    setIsLoading(true);
    setEvaluation(null);
    try {
      const result = await evaluateGuidelineAction({ ...data, userQuery: data.prompt, apiKey: apiKey || undefined });
      setEvaluation(result);
    } catch (error) {
      const errorToast = getErrorToast(error);
      if (error instanceof Error && (error.name === 'ApiKeyMissingError' || error.name === 'ApiKeyInvalidError')) {
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

  return (
    <div className="grid md:grid-cols-2 gap-8">
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="text-primary" />
            <span>Evaluate a Guideline</span>
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
                        placeholder="e.g., Tell me about space."
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
                name="guideline"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Guideline to Evaluate</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a guideline" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {LLM_COUNCIL_GUIDELINES.map((guide) => (
                          <SelectItem key={guide.value} value={guide.value}>
                            {guide.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={isLoading} className="w-full bg-accent hover:bg-accent/90 text-accent-foreground">
                {isLoading ? 'Evaluating...' : 'Evaluate with AI'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
            <CardTitle className="flex items-center gap-2">
                <Lightbulb className="text-primary" />
                <span>AI Evaluation</span>
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
            {!isLoading && evaluation && (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                <div className={`flex items-center gap-2 font-bold text-lg ${evaluation.shouldInclude ? 'text-green-500' : 'text-red-500'}`}>
                  {evaluation.shouldInclude ? <CheckCircle /> : <XCircle />}
                  <span>
                    {evaluation.shouldInclude ? 'Recommended to Include' : 'Not Recommended to Include'}
                  </span>
                </div>
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 font-semibold">
                      <Gauge className="h-4 w-4 text-primary" />
                      <span>Prompt Quality Score</span>
                    </div>
                    <span className="text-2xl font-bold">{evaluation.score}</span>
                  </div>
                  <Progress value={evaluation.score} />
                </div>
                <div className="space-y-3">
                  <h3 className="font-semibold">Sub-Dimension Scores</h3>
                  {Object.entries(evaluation.dimensionScores).map(([dimension, score]) => (
                    <div key={dimension} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span>{dimensionLabels[dimension as keyof EvaluationResult['dimensionScores']]}</span>
                        <span className="font-medium">{score}</span>
                      </div>
                      <Progress value={score} className="h-2" />
                    </div>
                  ))}
                </div>
                <div>
                    <h3 className="font-semibold mb-2">Reasoning:</h3>
                    <p className="text-muted-foreground">{evaluation.reason}</p>
                </div>
                {evaluation.recommendations.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-2">Recommendations:</h3>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      {evaluation.recommendations.map((recommendation, index) => (
                        <li key={`${recommendation}-${index}`} className="rounded-md border bg-background p-3">
                          {recommendation}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </motion.div>
            )}
            {!isLoading && !evaluation && (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
                <p>{`The AI's evaluation will appear here.`}</p>
              </div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </div>
  );
}
