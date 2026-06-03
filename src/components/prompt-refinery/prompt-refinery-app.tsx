'use client';

import { useContext, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RefineryTab } from './refinery-tab';
import { EvaluatorTab } from './evaluator-tab';
import { Logo } from '../icons/logo';
import { SavedPromptsTab } from './saved-prompts-tab';
import { Project, ProjectsTab } from './projects-tab';
import { ConverterTab } from './converter-tab';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Crown, FileText, FolderKanban, Gauge, Library, Wand2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { SubscriptionContext } from '@/context/subscription-context';
import { useFirebase } from '@/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function PromptRefineryApp() {
  const { toast } = useToast();
  const { user } = useFirebase();
  const { isPro, tier, savedPromptCount, savedPromptLimit, managedRefinementsUsedToday, managedRefinementLimit } = useContext(SubscriptionContext);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);

  const handleUpgradeClick = async () => {
    if (!user) {
      toast({
        title: 'Sign In Required',
        description: 'Sign in before upgrading to Pro.',
      });
      return;
    }

    setIsStartingCheckout(true);
    try {
        const firebaseIdToken = await user.getIdToken();
        const res = await fetch('/api/checkout_sessions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${firebaseIdToken}`,
            },
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error?.message || 'Failed to create checkout session');
        }

        if (data.url) {
            window.location.assign(data.url);
        } else {
            throw new Error('Checkout URL not found.');
        }

    } catch (error) {
        console.error('Error starting Pro checkout:', error);
        toast({
            variant: 'destructive',
            title: 'Payment Error',
            description: error instanceof Error ? error.message : 'An unexpected error occurred.',
        });
    } finally {
        setIsStartingCheckout(false);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto">
        <header className="flex flex-col items-center justify-center gap-3 mb-8">
            <div className="flex items-center gap-3">
              <Logo className="h-10 w-10 text-primary" />
              <h1 className="text-3xl md:text-5xl font-bold font-headline tracking-tight text-center">
                  The Prompt Refinery
              </h1>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Badge variant={isPro ? 'default' : 'outline'} className="gap-1">
                <Crown className="h-3 w-3" />
                {isPro ? 'Pro' : 'Free'}
              </Badge>
              {!isPro && (
                <Button onClick={handleUpgradeClick} disabled={isStartingCheckout} size="sm">
                  <Crown className="h-4 w-4" />
                  {isStartingCheckout ? 'Opening Checkout...' : 'Upgrade to Pro'}
                </Button>
              )}
            </div>
        </header>
        <p className="text-center text-lg text-muted-foreground mb-10 max-w-3xl mx-auto">
            A suite of tools to sharpen your prompts. Use the AI Council to refine your ideas or evaluate specific guidelines for better, more consistent results.
        </p>
        <div className="mb-6 flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
          <span>Plan: {tier}</span>
          <span>Saved prompts: {savedPromptCount}/{savedPromptLimit ?? 'unlimited'}</span>
          <span>Managed refinements today: {managedRefinementsUsedToday}/{managedRefinementLimit ?? 'unlimited'}</span>
        </div>
      <Tabs defaultValue="refinery" className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-5 gap-1 max-w-4xl mx-auto">
          <TabsTrigger value="refinery" className="gap-1 px-2" aria-label="Refinery">
            <Wand2 className="h-4 w-4" />
            <span className="hidden md:inline">Refinery</span>
          </TabsTrigger>
          <TabsTrigger value="evaluator" className="gap-1 px-2" aria-label="Guideline Evaluator">
            <Gauge className="h-4 w-4" />
            <span className="hidden md:inline">Evaluator</span>
          </TabsTrigger>
          <TabsTrigger value="converter" className="gap-1 px-2" aria-label="Format Converter">
            <FileText className="h-4 w-4" />
            <span className="hidden md:inline">Converter</span>
          </TabsTrigger>
          <TabsTrigger value="saved" className="gap-1 px-2" aria-label="Saved Prompts">
            <Library className="h-4 w-4" />
            <span className="hidden md:inline">Saved</span>
          </TabsTrigger>
          <TabsTrigger value="projects" className="gap-1 px-2" aria-label={isPro ? 'Projects' : 'Projects, Pro feature'} disabled={!isPro}>
            <FolderKanban className="h-4 w-4" />
            <span className="hidden md:inline">Projects {!isPro && '(Pro)'}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="refinery" className="mt-6">
          <RefineryTab selectedProject={isPro ? selectedProject : null} />
        </TabsContent>
        <TabsContent value="evaluator" className="mt-6">
          <EvaluatorTab />
        </TabsContent>
        <TabsContent value="converter" className="mt-6">
          <ConverterTab />
        </TabsContent>
        <TabsContent value="saved" className="mt-6">
          <SavedPromptsTab />
        </TabsContent>
        <TabsContent value="projects" className="mt-6">
          {isPro ? (
            <ProjectsTab
              selectedProjectId={selectedProject?.id ?? null}
              onSelectProject={setSelectedProject}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Projects & Memory are available on Pro</CardTitle>
              </CardHeader>
              <CardContent>
                <Button onClick={handleUpgradeClick} disabled={isStartingCheckout}>
                  <Crown className="h-4 w-4" />
                  Upgrade to Pro
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
