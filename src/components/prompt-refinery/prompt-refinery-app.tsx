'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RefineryTab } from './refinery-tab';
import { EvaluatorTab } from './evaluator-tab';
import { Logo } from '../icons/logo';
import { SavedPromptsTab } from './saved-prompts-tab';
import { Project, ProjectsTab } from './projects-tab';
import { Button } from '@/components/ui/button';
import { loadStripe } from '@stripe/stripe-js';
import { useToast } from '@/hooks/use-toast';

// Make sure to add your Stripe publishable key to your environment variables
const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : null;

export function PromptRefineryApp() {
  const { toast } = useToast();
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  const handleCoffeeClick = async () => {
    try {
        const res = await fetch('/api/checkout_sessions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error?.message || 'Failed to create checkout session');
        }

        if (data.url) {
            window.open(data.url, '_blank');
        } else {
            throw new Error('Checkout URL not found.');
        }

    } catch (error) {
        console.error('Error handling coffee click:', error);
        toast({
            variant: 'destructive',
            title: 'Payment Error',
            description: error instanceof Error ? error.message : 'An unexpected error occurred.',
        });
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto">
        <header className="flex flex-col items-center justify-center gap-3 mb-8">
            <div className="flex items-center gap-3">
              <Logo className="h-10 w-10 text-primary" />
              <h1 className="text-4xl md:text-5xl font-bold font-headline tracking-tight text-center">
                  The Prompt Refinery
              </h1>
            </div>
            {stripePromise && (
              <Button onClick={handleCoffeeClick} variant="link" className="text-lg text-amber-500 hover:text-amber-600">
                  Buy me a coffee😊!
              </Button>
            )}
        </header>
        <p className="text-center text-lg text-muted-foreground mb-10 max-w-3xl mx-auto">
            A suite of tools to sharpen your prompts. Use the AI Council to refine your ideas or evaluate specific guidelines for better, more consistent results.
        </p>
      <Tabs defaultValue="refinery" className="w-full">
        <TabsList className="grid w-full grid-cols-4 max-w-3xl mx-auto">
          <TabsTrigger value="refinery">Refinery</TabsTrigger>
          <TabsTrigger value="evaluator">Guideline Evaluator</TabsTrigger>
          <TabsTrigger value="saved">Saved Prompts</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
        </TabsList>
        <TabsContent value="refinery" className="mt-6">
          <RefineryTab selectedProject={selectedProject} />
        </TabsContent>
        <TabsContent value="evaluator" className="mt-6">
          <EvaluatorTab />
        </TabsContent>
        <TabsContent value="saved" className="mt-6">
          <SavedPromptsTab />
        </TabsContent>
        <TabsContent value="projects" className="mt-6">
          <ProjectsTab
            selectedProjectId={selectedProject?.id ?? null}
            onSelectProject={setSelectedProject}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
