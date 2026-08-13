'use client';

import { useContext, useEffect, useMemo, useState } from 'react';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RefineryTab } from './refinery-tab';
import { EvaluatorTab } from './evaluator-tab';
import { Logo } from '../icons/logo';
import { SavedPromptsTab } from './saved-prompts-tab';
import { ProjectsTab } from './projects-tab';
import { Project } from './project-types';
import { ConverterTab } from './converter-tab';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { BarChart3, Crown, FileText, FolderKanban, Gauge, Library, Users, Wand2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { SubscriptionContext } from '@/context/subscription-context';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useWorkflow } from '@/context/workflow-context';
import { AnalyticsTab } from './analytics-tab';
import { SharedTab } from './shared-tab';

export function PromptRefineryApp() {
  const { toast } = useToast();
  const { user, firestore } = useFirebase();
  const { isPro, tier, planLabel, savedPromptCount, savedPromptLimit, tenantId, workspaceId, availableCredits, reservedCredits } = useContext(SubscriptionContext);
  const { refineryTransfer } = useWorkflow();
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const [activeTab, setActiveTab] = useState('refinery');
  const [requestedProjectSessionId, setRequestedProjectSessionId] = useState<string | null>(null);

  const projectsQuery = useMemoFirebase(() => {
    if (!isPro || !user || !firestore || !tenantId || !workspaceId) return null;
    return query(
      collection(firestore, 'projects'),
      where('tenantId', '==', tenantId),
      where('workspaceId', '==', workspaceId),
      orderBy('updatedAt', 'desc')
    );
  }, [isPro, user, firestore, tenantId, workspaceId]);

  const { data: projects, isLoading: isLoadingProjects } = useCollection<Project>(projectsQuery);
  const activeProjects = useMemo(() => projects?.filter((project) => project.status !== 'trashed') ?? null, [projects]);

  useEffect(() => {
    if (!refineryTransfer) return;
    if (refineryTransfer.projectId) {
      const target = activeProjects?.find((project) => project.id === refineryTransfer.projectId);
      if (target) setSelectedProject(target);
    }
    setActiveTab('refinery');
  }, [activeProjects, refineryTransfer]);

  const handleSelectProject = (project: Project | null) => {
    setSelectedProject(project);
    setRequestedProjectSessionId(null);
  };

  const handleProjectRefinementSaved = (sessionId: string) => {
    setRequestedProjectSessionId(sessionId);
    setActiveTab('projects');
  };

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
            <h1 className="sr-only">Clarift</h1>
            <Logo variant="wordmark" className="h-20 w-64 md:h-24 md:w-80" />
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Badge variant={isPro ? 'default' : 'outline'} className="gap-1">
                <Crown className="h-3 w-3" />
                {planLabel}
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
            Clarify, refine, and elevate your prompts with an AI Council built for clearer thinking and better results.
        </p>
        <div className="mb-6 flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
          <span>Plan: {tier}</span>
          <span>Saved prompts: {savedPromptCount}/{savedPromptLimit ?? 'unlimited'}</span>
          <span>Managed credits: {availableCredits} available{reservedCredits ? `, ${reservedCredits} reserved` : ''}</span>
        </div>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-7 gap-1 max-w-5xl mx-auto">
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
          <TabsTrigger value="analytics" className="gap-1 px-2" aria-label={isPro ? 'Analytics' : 'Analytics, Pro feature'} disabled={!isPro}>
            <BarChart3 className="h-4 w-4" />
            <span className="hidden md:inline">Analytics</span>
          </TabsTrigger>
          <TabsTrigger value="shared" className="gap-1 px-2" aria-label={isPro ? 'Shared' : 'Shared, Pro feature'} disabled={!isPro}>
            <Users className="h-4 w-4" />
            <span className="hidden md:inline">Shared</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="refinery" className="mt-6">
          <RefineryTab
            selectedProject={isPro ? selectedProject : null}
            projects={isPro ? activeProjects : null}
            isLoadingProjects={isLoadingProjects}
            allowProjectSelection={isPro}
            onSelectProject={handleSelectProject}
            onProjectRefinementSaved={handleProjectRefinementSaved}
          />
        </TabsContent>
        <TabsContent value="evaluator" className="mt-6">
          <EvaluatorTab />
        </TabsContent>
        <TabsContent value="converter" className="mt-6">
          <ConverterTab projects={isPro ? activeProjects : null} selectedProject={selectedProject} />
        </TabsContent>
        <TabsContent value="saved" className="mt-6">
          <SavedPromptsTab />
        </TabsContent>
        <TabsContent value="projects" className="mt-6">
          {isPro ? (
            <ProjectsTab
              projects={projects}
              isLoadingProjects={isLoadingProjects}
              selectedProject={selectedProject}
              onSelectProject={handleSelectProject}
              requestedSessionId={requestedProjectSessionId}
              onRequestedSessionSelected={() => setRequestedProjectSessionId(null)}
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
        <TabsContent value="analytics" className="mt-6">
          {isPro ? <AnalyticsTab /> : null}
        </TabsContent>
        <TabsContent value="shared" className="mt-6">
          {isPro ? <SharedTab /> : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
