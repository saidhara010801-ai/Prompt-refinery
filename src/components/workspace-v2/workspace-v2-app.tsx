'use client';

import { useContext, useEffect, useMemo, useState } from 'react';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { Crown, FolderPlus } from 'lucide-react';

import { AnalyticsTab } from '@/components/prompt-refinery/analytics-tab';
import { BrandTypewriter } from '@/components/prompt-refinery/brand-typewriter';
import { ConverterTab } from '@/components/prompt-refinery/converter-tab';
import { EvaluatorTab } from '@/components/prompt-refinery/evaluator-tab';
import type { Project } from '@/components/prompt-refinery/project-types';
import { ProjectsTab } from '@/components/prompt-refinery/projects-tab';
import { RefineryTab } from '@/components/prompt-refinery/refinery-tab';
import { SavedPromptsTab } from '@/components/prompt-refinery/saved-prompts-tab';
import { SharedTab } from '@/components/prompt-refinery/shared-tab';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SubscriptionContext } from '@/context/subscription-context';
import { useWorkflow } from '@/context/workflow-context';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { WorkspaceShell, type WorkspaceDestination } from './workspace-shell';

const destinationHeadings: Record<WorkspaceDestination, { title: string; description: string }> = {
  refinery: { title: 'Prompt workspace', description: 'Shape, compare, and save a stronger instruction.' },
  evaluator: { title: 'Guideline evaluator', description: 'Measure a prompt against your selected criteria.' },
  converter: { title: 'Format converter', description: 'Convert source documents into clean prompt-ready Markdown.' },
  saved: { title: 'Saved prompts', description: 'Review and reuse the prompts you have kept.' },
  projects: { title: 'Projects', description: 'Organize prompt chats and reusable project memory.' },
  analytics: { title: 'Analytics', description: 'Track current Clarift activity and available capacity.' },
  shared: { title: 'Shared', description: 'Review resources shared with your workspace.' },
};

export function WorkspaceV2App() {
  const { toast } = useToast();
  const { user, firestore } = useFirebase();
  const {
    isPro,
    planLabel,
    savedPromptCount,
    savedPromptLimit,
    tenantId,
    workspaceId,
    availableCredits,
    reservedCredits,
    freeAllowance,
  } = useContext(SubscriptionContext);
  const { refineryTransfer } = useWorkflow();
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [activeDestination, setActiveDestination] = useState<WorkspaceDestination>('refinery');
  const [requestedProjectSessionId, setRequestedProjectSessionId] = useState<string | null>(null);
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);

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
    setActiveDestination('refinery');
  }, [activeProjects, refineryTransfer]);

  const handleSelectProject = (project: Project | null) => {
    setSelectedProject(project);
    setRequestedProjectSessionId(null);
  };

  const handleProjectRefinementSaved = (sessionId: string) => {
    setRequestedProjectSessionId(sessionId);
    setActiveDestination('projects');
  };

  const handleUpgradeClick = async () => {
    if (!user) return;
    setIsStartingCheckout(true);
    try {
      const response = await fetch('/api/checkout_sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
      });
      const payload = await response.json();
      if (!response.ok || !payload.url) throw new Error(payload.error?.message || 'Could not open checkout.');
      window.location.assign(payload.url);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Payment Error', description: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setIsStartingCheckout(false);
    }
  };

  const heading = destinationHeadings[activeDestination];
  const workspaceIsEmpty = !isLoadingProjects && savedPromptCount === 0 && (activeProjects?.length ?? 0) === 0;

  const content = (() => {
    if (activeDestination === 'refinery') {
      return (
        <div className="space-y-5">
          {workspaceIsEmpty ? (
            <BrandTypewriter />
          ) : (
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold">{heading.title}</h1>
                <p className="mt-1 text-sm text-muted-foreground">{heading.description}</p>
              </div>
              {isPro && (
                <Button type="button" variant="outline" onClick={() => setActiveDestination('projects')}>
                  <FolderPlus className="h-4 w-4" />Create project
                </Button>
              )}
            </div>
          )}
          <RefineryTab
            selectedProject={isPro ? selectedProject : null}
            projects={isPro ? activeProjects : null}
            isLoadingProjects={isLoadingProjects}
            allowProjectSelection={isPro}
            onSelectProject={handleSelectProject}
            onProjectRefinementSaved={handleProjectRefinementSaved}
          />
        </div>
      );
    }

    if (activeDestination === 'projects') {
      return isPro ? (
        <ProjectsTab
          projects={projects}
          isLoadingProjects={isLoadingProjects}
          selectedProject={selectedProject}
          onSelectProject={handleSelectProject}
          requestedSessionId={requestedProjectSessionId}
          onRequestedSessionSelected={() => setRequestedProjectSessionId(null)}
        />
      ) : null;
    }

    const tool = activeDestination === 'evaluator' ? <EvaluatorTab />
      : activeDestination === 'converter' ? <ConverterTab projects={isPro ? activeProjects : null} selectedProject={selectedProject} />
      : activeDestination === 'saved' ? <SavedPromptsTab />
      : activeDestination === 'analytics' ? <AnalyticsTab />
      : <SharedTab />;

    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-semibold">{heading.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{heading.description}</p>
        </div>
        {tool}
      </div>
    );
  })();

  return (
    <WorkspaceShell
      activeDestination={activeDestination}
      onDestinationChange={setActiveDestination}
      isPro={isPro}
      planLabel={planLabel}
      savedPromptCount={savedPromptCount}
      savedPromptLimit={savedPromptLimit}
      dailyUnits={freeAllowance?.refinement.daily.remaining ?? null}
      monthlyUnits={freeAllowance?.refinement.monthly.remaining ?? null}
      availableCredits={availableCredits}
      reservedCredits={reservedCredits}
    >
      {!isPro && ['projects', 'analytics', 'shared'].includes(activeDestination) ? (
        <Card>
          <CardHeader><CardTitle>Available on Clarift Pro</CardTitle></CardHeader>
          <CardContent>
            <Button onClick={handleUpgradeClick} disabled={isStartingCheckout}>
              <Crown className="h-4 w-4" />{isStartingCheckout ? 'Opening checkout...' : 'Upgrade to Pro'}
            </Button>
          </CardContent>
        </Card>
      ) : content}
    </WorkspaceShell>
  );
}
