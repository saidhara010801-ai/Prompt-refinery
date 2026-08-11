'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { collection, orderBy, query } from 'firebase/firestore';
import {
  FolderKanban,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';

import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  createProjectAction,
  deleteProjectAction,
  updateProjectSessionResponseAction,
} from '@/app/project-actions';

export interface Project {
  id: string;
  userId: string;
  name: string;
  description?: string;
  createdAt?: {
    seconds: number;
    nanoseconds: number;
  };
  updatedAt?: {
    seconds: number;
    nanoseconds: number;
  };
}

interface ProjectSession {
  id: string;
  projectId: string;
  rawPrompt: string;
  refinedPrompt: string;
  promptType: string;
  version?: number;
  versions?: Array<{
    version: number;
    rawPrompt: string;
    refinedPrompt: string;
    promptType: string;
    createdAt: string;
  }>;
  llmResponse?: string;
  timestamp?: {
    seconds: number;
    nanoseconds: number;
  };
}

interface ProjectsTabProps {
  selectedProjectId: string | null;
  onSelectProject: (project: Project | null) => void;
  onStartRefinement: () => void;
}

function formatDate(timestamp?: { seconds: number }) {
  if (!timestamp?.seconds) {
    return 'Just now';
  }

  return new Date(timestamp.seconds * 1000).toLocaleDateString();
}

function getChatTitle(session: ProjectSession) {
  return session.rawPrompt.length > 54
    ? `${session.rawPrompt.slice(0, 54)}...`
    : session.rawPrompt;
}

export function ProjectsTab({ selectedProjectId, onSelectProject, onStartRefinement }: ProjectsTabProps) {
  const { firestore, user } = useFirebase();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [responseDrafts, setResponseDrafts] = useState<Record<string, string>>({});
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const projectsQuery = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    return query(
      collection(firestore, `users/${user.uid}/projects`),
      orderBy('updatedAt', 'desc')
    );
  }, [user, firestore]);

  const { data: projects, isLoading } = useCollection<Project>(projectsQuery);
  const selectedProject = projects?.find((project) => project.id === selectedProjectId) ?? null;

  const sessionsQuery = useMemoFirebase(() => {
    if (!user || !firestore || !selectedProjectId) return null;
    return query(
      collection(firestore, `users/${user.uid}/projects/${selectedProjectId}/projectSessions`),
      orderBy('timestamp', 'desc')
    );
  }, [user, firestore, selectedProjectId]);

  const { data: sessions, isLoading: isLoadingSessions } = useCollection<ProjectSession>(sessionsQuery);
  const selectedSession = useMemo(
    () => sessions?.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );

  useEffect(() => {
    if (!sessions || sessions.length === 0) {
      setSelectedSessionId(null);
      return;
    }

    if (!selectedSessionId || !sessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [sessions, selectedSessionId]);

  const handleCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!user || !firestore || !name.trim()) return;

    try {
      const result = await createProjectAction({
        firebaseIdToken: await user.getIdToken(),
        name: name.trim(),
        description: description.trim(),
      });
      onSelectProject({
        id: result.id,
        userId: user.uid,
        name: name.trim(),
        description: description.trim(),
      });
      setSelectedSessionId(null);
      setName('');
      setDescription('');
      toast({
        title: 'Project Created',
        description: 'New refinements can now use this project memory.',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could Not Create Project',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  };

  const handleDeleteProject = async (project: Project) => {
    if (!user || !firestore) return;

    try {
      await deleteProjectAction({
        firebaseIdToken: await user.getIdToken(),
        projectId: project.id,
      });
      if (selectedProjectId === project.id) {
        onSelectProject(null);
      }

      toast({
        title: 'Project Deleted',
        description: 'The project and its memory sessions have been removed.',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could Not Delete Project',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  };

  const handleNewChat = () => {
    if (!selectedProject) return;
    onSelectProject(selectedProject);
    onStartRefinement();
  };

  const handleSaveResponse = async (session: ProjectSession) => {
    if (!user || !firestore || !selectedProjectId) return;

    const llmResponse = responseDrafts[session.id] ?? session.llmResponse ?? '';

    try {
      await updateProjectSessionResponseAction({
        firebaseIdToken: await user.getIdToken(),
        projectId: selectedProjectId,
        sessionId: session.id,
        llmResponse,
      });
      toast({
        title: 'Project Memory Updated',
        description: 'This response note will be available to future refinements.',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could Not Update Project Memory',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  };

  return (
    <div
      className={cn(
        'grid min-h-[680px] gap-6 lg:grid-cols-[340px_minmax(0,1fr)]',
        isSidebarCollapsed && 'lg:grid-cols-[72px_minmax(0,1fr)]'
      )}
    >
      <aside className="rounded-lg border border-primary/20 bg-background">
        <div className="flex h-14 items-center justify-between gap-2 border-b px-3">
          {!isSidebarCollapsed && (
            <div className="flex min-w-0 items-center gap-2">
              <FolderKanban className="h-5 w-5 shrink-0 text-primary" />
              <p className="truncate font-semibold">Projects</p>
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto"
            onClick={() => setIsSidebarCollapsed((current) => !current)}
          >
            {isSidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            <span className="sr-only">{isSidebarCollapsed ? 'Expand project menu' : 'Collapse project menu'}</span>
          </Button>
        </div>

        {isSidebarCollapsed ? (
          <div className="flex flex-col items-center gap-2 p-2">
            <Button type="button" size="icon" onClick={() => setIsSidebarCollapsed(false)}>
              <FolderKanban className="h-4 w-4" />
              <span className="sr-only">Open projects</span>
            </Button>
            {selectedProject && (
              <Button type="button" variant="outline" size="icon" onClick={handleNewChat}>
                <Plus className="h-4 w-4" />
                <span className="sr-only">New chat</span>
              </Button>
            )}
          </div>
        ) : (
          <ScrollArea className="h-[624px]">
            <div className="space-y-5 p-4">
              <form onSubmit={handleCreateProject} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="projectName">Name</Label>
                  <Input
                    id="projectName"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Product launch prompts"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="projectDescription">Description</Label>
                  <Textarea
                    id="projectDescription"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Audience, brand notes, goals."
                    className="min-h-20"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={!user || !name.trim()}>
                  <Plus className="h-4 w-4" />
                  Create Project
                </Button>
              </form>

              <Separator />

              <div className="space-y-2">
                {isLoading && (
                  <>
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                  </>
                )}
                {!isLoading && projects && projects.length > 0 && projects.map((project) => (
                  <div
                    key={project.id}
                    className={cn(
                      'group flex items-start justify-between gap-2 rounded-md border p-2',
                      selectedProjectId === project.id && 'border-primary bg-primary/5'
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onSelectProject(project)}
                    >
                      <p className="truncate text-sm font-semibold">{project.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Updated {formatDate(project.updatedAt)}</p>
                    </button>
                    <Button variant="ghost" size="icon" onClick={() => handleDeleteProject(project)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                      <span className="sr-only">Delete project</span>
                    </Button>
                  </div>
                ))}
                {!isLoading && (!projects || projects.length === 0) && (
                  <p className="py-5 text-center text-sm text-muted-foreground">No projects yet.</p>
                )}
              </div>

              {selectedProject && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">Chats</p>
                      <Button type="button" variant="outline" size="sm" onClick={handleNewChat}>
                        <Plus className="h-4 w-4" />
                        New
                      </Button>
                    </div>

                    {isLoadingSessions && (
                      <>
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                      </>
                    )}
                    {!isLoadingSessions && sessions && sessions.length > 0 && sessions.map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => setSelectedSessionId(session.id)}
                        className={cn(
                          'flex w-full items-start gap-2 rounded-md border p-2 text-left text-sm',
                          selectedSessionId === session.id && 'border-primary bg-primary/5'
                        )}
                      >
                        <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{getChatTitle(session)}</span>
                          <span className="text-xs text-muted-foreground">{formatDate(session.timestamp)}</span>
                        </span>
                      </button>
                    ))}
                    {!isLoadingSessions && (!sessions || sessions.length === 0) && (
                      <p className="py-4 text-center text-sm text-muted-foreground">No chats yet.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </ScrollArea>
        )}
      </aside>

      <section className="min-w-0 rounded-lg border bg-background">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">
              {selectedProject ? selectedProject.name : 'Project Chats'}
            </h2>
            {selectedProject?.description && (
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{selectedProject.description}</p>
            )}
          </div>
          {selectedProject && (
            <Button type="button" onClick={handleNewChat}>
              <Send className="h-4 w-4" />
              New Chat
            </Button>
          )}
        </div>

        <ScrollArea className="h-[624px]">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 md:p-6">
            {!selectedProject && (
              <div className="flex min-h-[440px] items-center justify-center text-center text-sm text-muted-foreground">
                Select or create a project.
              </div>
            )}

            {selectedProject && !isLoadingSessions && !selectedSession && (
              <div className="flex min-h-[440px] flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                <p>No chats in this project yet.</p>
                <Button type="button" onClick={handleNewChat}>
                  <Send className="h-4 w-4" />
                  Start Chat
                </Button>
              </div>
            )}

            {selectedProject && isLoadingSessions && (
              <div className="space-y-4">
                <Skeleton className="ml-auto h-24 w-4/5" />
                <Skeleton className="h-36 w-11/12" />
              </div>
            )}

            {selectedProject && selectedSession && (
              <>
                <div className="flex justify-center">
                  <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                    {selectedSession.promptType} · v{selectedSession.version ?? 1} · {formatDate(selectedSession.timestamp)}
                  </span>
                </div>

                <div className="ml-auto max-w-[86%] rounded-lg bg-primary px-4 py-3 text-primary-foreground">
                  <p className="whitespace-pre-wrap text-sm">{selectedSession.rawPrompt}</p>
                </div>

                <div className="mr-auto max-w-[92%] rounded-lg border bg-muted/50 px-4 py-3">
                  <pre className="whitespace-pre-wrap font-code text-sm">
                    <code>{selectedSession.refinedPrompt}</code>
                  </pre>
                </div>

                {selectedSession.versions && selectedSession.versions.length > 1 && (
                  <div className="rounded-md border p-3">
                    <p className="mb-2 text-sm font-semibold">Versions</p>
                    <div className="space-y-2">
                      {selectedSession.versions.map((version) => (
                        <div key={`${selectedSession.id}-${version.version}`} className="rounded-md bg-muted/60 p-2">
                          <p className="text-xs font-medium text-muted-foreground">v{version.version} · {version.promptType}</p>
                          <p className="mt-1 line-clamp-2 text-sm">{version.refinedPrompt}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2 rounded-md border p-3">
                  <Label htmlFor={`llmResponse-${selectedSession.id}`}>Response notes</Label>
                  <Textarea
                    id={`llmResponse-${selectedSession.id}`}
                    value={responseDrafts[selectedSession.id] ?? selectedSession.llmResponse ?? ''}
                    onChange={(event) =>
                      setResponseDrafts((drafts) => ({
                        ...drafts,
                        [selectedSession.id]: event.target.value,
                      }))
                    }
                    placeholder="Paste downstream response notes."
                    className="min-h-28"
                  />
                  <Button variant="outline" size="sm" onClick={() => handleSaveResponse(selectedSession)}>
                    Save Memory Note
                  </Button>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </section>
    </div>
  );
}
