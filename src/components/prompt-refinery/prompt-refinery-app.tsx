'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RefineryTab } from './refinery-tab';
import { EvaluatorTab } from './evaluator-tab';
import { Logo } from '../icons/logo';

export function PromptRefineryApp() {
  return (
    <div className="w-full max-w-7xl mx-auto">
        <header className="flex items-center justify-center gap-3 mb-8">
            <Logo className="h-10 w-10 text-primary" />
            <h1 className="text-4xl md:text-5xl font-bold font-headline tracking-tight text-center">
                The Prompt Refinery
            </h1>
        </header>
        <p className="text-center text-lg text-muted-foreground mb-10 max-w-3xl mx-auto">
            A suite of tools to sharpen your prompts. Use the AI Council to refine your ideas or evaluate specific guidelines for better, more consistent results.
        </p>
      <Tabs defaultValue="refinery" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md mx-auto">
          <TabsTrigger value="refinery">Refinery</TabsTrigger>
          <TabsTrigger value="evaluator">Guideline Evaluator</TabsTrigger>
        </TabsList>
        <TabsContent value="refinery" className="mt-6">
          <RefineryTab />
        </TabsContent>
        <TabsContent value="evaluator" className="mt-6">
          <EvaluatorTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
