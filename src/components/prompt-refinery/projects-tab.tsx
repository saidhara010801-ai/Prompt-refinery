'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { collection, orderBy, query } from 'firebase/firestore';
import {
  FolderKanban,
  ArchiveRestore,
  Clock3,
  FolderX,
  LogOut,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Send,
  Search,
  Save,
  StickyNote,
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
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  createProjectAction,
  createProjectMemoryEntryAction,
  deleteProjectMemoryEntryAction,
  deleteProjectAction,
  permanentlyDeleteProjectAction,
  restoreProjectAction,
  searchProjectMemoryAction,
  updateProjectMemoryEntryAction,
  updateProjectSessionResponseAction,
} from '@/app/project-actions';
import { RefineryTab } from './refinery-tab';
import { Project } from './project-types';
import { ShareDialog } from './share-dialog';
import type { ProjectMemoryEntry } from './stage2-types';
import { PROJECT_TEMPLATES } from '@/lib/constants';

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
  projects: Project[] | null;
  isLoadingProjects: boolean;
  selectedProject: Project | null;
  onSelectProject: (project: Project | null) => void;
  requestedSessionId?: string | null;
  onRequestedSessionSelected?: () => void;
}

const ALL_PROJECTS_VALUE = '__all_projects__';

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

export function ProjectsTab({
  projects,
  isLoadingProjects,
  selectedProject,
  onSelectProject,
  requestedSessionId,
  onRequestedSessionSelected,
}: ProjectsTabProps) {
  const { firestore, user } = useFirebase();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [responseDrafts, setResponseDrafts] = useState<Record<string, string>>({});
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [workspaceView, setWorkspaceView] = useState<'chat' | 'memory'>('chat');
  const [showTrash, setShowTrash] = useState(false);
  const [memoryDrafts, setMemoryDrafts] = useState<Record<string, { title: string; content: string }>>({});
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; projectId: string; title: string; kind: string; snippet: string }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const selectedProjectId = selectedProject?.id ?? null;
  const activeProjectOptions = (projects ?? []).filter((project) => project.status !== 'trashed');
  const projectOptions = selectedProject && !activeProjectOptions.some((project) => project.id === selectedProject.id)
    ? [selectedProject, ...activeProjectOptions]
    : activeProjectOptions;

  const sessionsQuery = useMemoFirebase(() => {
    if (!user || !firestore || !selectedProjectId) return null;
    return query(
      collection(firestore, `projects/${selectedProjectId}/projectSessions`),
      orderBy('timestamp', 'desc')
    );
  }, [user, firestore, selectedProjectId]);

  const { data: sessions, isLoading: isLoadingSessions } = useCollection<ProjectSession>(sessionsQuery);
  const memoryQuery = useMemoFirebase(() => {
    if (!user || !firestore || !selectedProjectId) return null;
    return query(
      collection(firestore, `projects/${selectedProjectId}/memoryEntries`),
      orderBy('createdAt', 'desc')
    );
  }, [user, firestore, selectedProjectId]);
  const { data: memoryEntries, isLoading: isLoadingMemory } = useCollection<ProjectMemoryEntry>(memoryQuery);
  const selectedSession = useMemo(
    () => sessions?.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );

  useEffect(() => {
    if (requestedSessionId) {
      setPendingSessionId(requestedSessionId);
    }
  }, [requestedSessionId]);

  useEffect(() => {
    if (pendingSessionId) {
      if (!sessions?.some((session) => session.id === pendingSessionId)) {
        return;
      }

      setSelectedSessionId(pendingSessionId);
      setPendingSessionId(null);
      setIsComposing(false);
      if (pendingSessionId === requestedSessionId) {
        onRequestedSessionSelected?.();
      }
      return;
    }

    if (!sessions || sessions.length === 0) {
      setSelectedSessionId(null);
      return;
    }

    if (!selectedSessionId || !sessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [sessions, selectedSessionId, pendingSessionId, requestedSessionId, onRequestedSessionSelected]);

  const handleSelectProject = (project: Project | null) => {
    setSelectedSessionId(null);
    setPendingSessionId(null);
    setIsComposing(false);
    setWorkspaceView(project?.status === 'trashed' ? 'memory' : 'chat');
    onSelectProject(project);
  };

  const handleCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!user || !firestore || !name.trim()) return;

    try {
      const result = await createProjectAction({
        firebaseIdToken: await user.getIdToken(),
        name: name.trim(),
        description: description.trim(),
        templateId: templateId || undefined,
      });
      onSelectProject({
        id: result.id,
        userId: user.uid,
        name: name.trim(),
        description: description.trim(),
        templateId: templateId || null,
        defaultTechnique: result.defaultTechnique,
        defaultGuidelines: [...result.defaultGuidelines],
        status: 'active',
      });
      setSelectedSessionId(null);
      setPendingSessionId(null);
      setIsComposing(true);
      setName('');
      setDescription('');
      setTemplateId('');
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
        handleSelectProject(null);
      }

      toast({
        title: 'Project Moved to Trash',
        description: 'You can restore it for 30 days before permanent deletion.',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Could Not Delete Project',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  };

  const handleRestoreProject = async (project: Project) => {
    if (!user) return;
    try {
      await restoreProjectAction({ firebaseIdToken: await user.getIdToken(), projectId: project.id });
      toast({ title: 'Project Restored', description: `${project.name} is active again.` });
      setShowTrash(false);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could Not Restore Project', description: error instanceof Error ? error.message : 'Please try again.' });
    }
  };

  const handlePermanentDelete = async (project: Project) => {
    if (!user) return;
    try {
      await permanentlyDeleteProjectAction({ firebaseIdToken: await user.getIdToken(), projectId: project.id });
      if (selectedProjectId === project.id) handleSelectProject(null);
      toast({ title: 'Project Permanently Deleted', description: 'The project and all memory were removed.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could Not Delete Project', description: error instanceof Error ? error.message : 'Please try again.' });
    }
  };

  const handleSearch = async () => {
    if (!user || searchText.trim().length < 2) return;
    setIsSearching(true);
    try {
      setSearchResults(await searchProjectMemoryAction({ firebaseIdToken: await user.getIdToken(), search: searchText }));
    } catch (error) {
      toast({ variant: 'destructive', title: 'Search Failed', description: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setIsSearching(false);
    }
  };

  const handleCreateNote = async () => {
    if (!user || !selectedProjectId || !noteTitle.trim() || !noteContent.trim()) return;
    try {
      await createProjectMemoryEntryAction({
        firebaseIdToken: await user.getIdToken(),
        projectId: selectedProjectId,
        kind: 'note',
        title: noteTitle.trim(),
        content: noteContent.trim(),
      });
      setNoteTitle('');
      setNoteContent('');
      toast({ title: 'Memory Note Added', description: 'The note can now be selected as refinement context.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could Not Add Note', description: error instanceof Error ? error.message : 'Please try again.' });
    }
  };

  const handleUpdateMemory = async (entry: ProjectMemoryEntry, active = entry.active) => {
    if (!user || !selectedProjectId) return;
    const draft = memoryDrafts[entry.id] ?? { title: entry.title, content: entry.content };
    try {
      await updateProjectMemoryEntryAction({
        firebaseIdToken: await user.getIdToken(),
        projectId: selectedProjectId,
        entryId: entry.id,
        title: draft.title,
        content: draft.content,
        active,
      });
      toast({ title: 'Memory Updated', description: active ? 'This entry is available as context.' : 'This entry is excluded from future context.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could Not Update Memory', description: error instanceof Error ? error.message : 'Please try again.' });
    }
  };

  const handleDeleteMemory = async (entryId: string) => {
    if (!user || !selectedProjectId) return;
    try {
      await deleteProjectMemoryEntryAction({ firebaseIdToken: await user.getIdToken(), projectId: selectedProjectId, entryId });
      toast({ title: 'Memory Entry Deleted' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could Not Delete Memory', description: error instanceof Error ? error.message : 'Please try again.' });
    }
  };

  const handleNewChat = () => {
    if (!selectedProject || selectedProject.status === 'trashed') return;
    setWorkspaceView('chat');
    setPendingSessionId(null);
    setSelectedSessionId(null);
    setIsComposing(true);
  };

  const visibleProjects = (projects ?? []).filter((project) => showTrash ? project.status === 'trashed' : project.status !== 'trashed');

  const handleProjectRefinementSaved = (sessionId: string) => {
    setPendingSessionId(sessionId);
    setIsComposing(false);
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
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search all project memory" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); handleSearch(); } }} />
                  <Button type="button" variant="outline" size="icon" onClick={handleSearch} disabled={isSearching || searchText.trim().length < 2}><Search className="h-4 w-4" /><span className="sr-only">Search projects</span></Button>
                </div>
                {searchResults.length > 0 && (
                  <div className="space-y-1 rounded-md border p-2">
                    {searchResults.slice(0, 6).map((result) => (
                      <button key={`${result.projectId}-${result.id}`} type="button" className="w-full rounded p-2 text-left text-xs hover:bg-muted" onClick={() => {
                        const project = projects?.find((candidate) => candidate.id === result.projectId) ?? null;
                        handleSelectProject(project);
                        setWorkspaceView('memory');
                      }}>
                        <span className="block truncate font-semibold">{result.title}</span>
                        <span className="line-clamp-2 text-muted-foreground">{result.snippet}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button type="button" size="sm" variant={!showTrash ? 'default' : 'outline'} onClick={() => setShowTrash(false)}><FolderKanban className="h-4 w-4" />Active</Button>
                <Button type="button" size="sm" variant={showTrash ? 'default' : 'outline'} onClick={() => setShowTrash(true)}><FolderX className="h-4 w-4" />Trash</Button>
              </div>

              {!showTrash && <form onSubmit={handleCreateProject} className="space-y-3">
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
                  <Label htmlFor="projectTemplate">Template</Label>
                  <Select value={templateId || '__blank__'} onValueChange={(value) => setTemplateId(value === '__blank__' ? '' : value)}>
                    <SelectTrigger id="projectTemplate"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="__blank__">Blank project</SelectItem>{PROJECT_TEMPLATES.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent>
                  </Select>
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
              </form>}

              <Separator />

              <div className="space-y-2">
                {isLoadingProjects && (
                  <>
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                  </>
                )}
                {!isLoadingProjects && visibleProjects.length > 0 && visibleProjects.map((project) => (
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
                      onClick={() => handleSelectProject(project)}
                    >
                      <p className="truncate text-sm font-semibold">{project.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Updated {formatDate(project.updatedAt)}</p>
                    </button>
                    {project.status === 'trashed' ? (
                      <div className="flex">
                        <Button variant="ghost" size="icon" onClick={() => handleRestoreProject(project)}><ArchiveRestore className="h-4 w-4" /><span className="sr-only">Restore project</span></Button>
                        <Button variant="ghost" size="icon" onClick={() => handlePermanentDelete(project)}><Trash2 className="h-4 w-4 text-red-500" /><span className="sr-only">Delete forever</span></Button>
                      </div>
                    ) : (
                      <Button variant="ghost" size="icon" onClick={() => handleDeleteProject(project)}><Trash2 className="h-4 w-4 text-red-500" /><span className="sr-only">Move project to trash</span></Button>
                    )}
                  </div>
                ))}
                {!isLoadingProjects && visibleProjects.length === 0 && (
                  <p className="py-5 text-center text-sm text-muted-foreground">{showTrash ? 'Trash is empty.' : 'No projects yet.'}</p>
                )}
              </div>

              {selectedProject && selectedProject.status !== 'trashed' && (
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
            {selectedProject?.defaultGuidelines?.length ? <div className="mt-2 flex flex-wrap gap-1">{selectedProject.defaultGuidelines.map((guideline) => <span key={guideline} className="rounded border px-2 py-0.5 text-xs text-muted-foreground">{guideline}</span>)}</div> : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {selectedProject && selectedProject.status !== 'trashed' && (
              <div className="flex rounded-md border p-1">
                <Button type="button" size="sm" variant={workspaceView === 'chat' ? 'secondary' : 'ghost'} onClick={() => setWorkspaceView('chat')}><MessageSquareText className="h-4 w-4" />Chat</Button>
                <Button type="button" size="sm" variant={workspaceView === 'memory' ? 'secondary' : 'ghost'} onClick={() => { setWorkspaceView('memory'); setIsComposing(false); }}><Clock3 className="h-4 w-4" />Memory</Button>
              </div>
            )}
            <Select
              value={selectedProjectId ?? ALL_PROJECTS_VALUE}
              onValueChange={(projectId) => {
                handleSelectProject(
                  projectId === ALL_PROJECTS_VALUE
                    ? null
                    : projectOptions.find((project) => project.id === projectId) ?? null
                );
              }}
              disabled={isLoadingProjects}
            >
              <SelectTrigger className="w-[190px]" aria-label="Switch project">
                <SelectValue placeholder="Choose project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PROJECTS_VALUE}>All projects</SelectItem>
                {projectOptions.map((project) => (
                  <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedProject && (
              <>
                {selectedProject.status !== 'trashed' && <ShareDialog resourceType="project" resourceId={selectedProject.id} resourceName={selectedProject.name} />}
                <Button type="button" variant="outline" onClick={() => handleSelectProject(null)}>
                  <LogOut className="h-4 w-4" />
                  Leave Project
                </Button>
                {selectedProject.status !== 'trashed' && <Button type="button" onClick={handleNewChat}>
                  <Send className="h-4 w-4" />
                  New Chat
                </Button>}
              </>
            )}
          </div>
        </div>

        <ScrollArea className="h-[624px]">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 md:p-6">
            {!selectedProject && (
              <div className="flex min-h-[440px] items-center justify-center text-center text-sm text-muted-foreground">
                Select or create a project.
              </div>
            )}

            {selectedProject && workspaceView === 'chat' && isComposing && (
              <RefineryTab
                selectedProject={selectedProject}
                projectWorkspace
                onProjectRefinementSaved={handleProjectRefinementSaved}
              />
            )}

            {selectedProject && workspaceView === 'chat' && !isComposing && !isLoadingSessions && !selectedSession && !pendingSessionId && (
              <div className="flex min-h-[440px] flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                <p>No chats in this project yet.</p>
                <Button type="button" onClick={handleNewChat}>
                  <Send className="h-4 w-4" />
                  Start Chat
                </Button>
              </div>
            )}

            {selectedProject && workspaceView === 'chat' && !isComposing && (isLoadingSessions || pendingSessionId) && (
              <div className="space-y-4">
                <Skeleton className="ml-auto h-24 w-4/5" />
                <Skeleton className="h-36 w-11/12" />
              </div>
            )}

            {selectedProject && workspaceView === 'chat' && !isComposing && selectedSession && (
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

            {selectedProject && workspaceView === 'memory' && (
              <div className="space-y-5">
                {selectedProject.status !== 'trashed' && (
                  <div className="space-y-3 rounded-md border p-4">
                    <div className="flex items-center gap-2 font-semibold"><StickyNote className="h-4 w-4 text-primary" />Add Memory Note</div>
                    <Input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} placeholder="Note title" />
                    <Textarea value={noteContent} onChange={(event) => setNoteContent(event.target.value)} placeholder="Project decision, constraint, source note, or reusable context" className="min-h-24" />
                    <Button type="button" size="sm" onClick={handleCreateNote} disabled={!noteTitle.trim() || !noteContent.trim()}><Plus className="h-4 w-4" />Add Note</Button>
                  </div>
                )}

                {isLoadingMemory && <div className="space-y-3"><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>}
                {!isLoadingMemory && memoryEntries?.map((entry) => {
                  const draft = memoryDrafts[entry.id] ?? { title: entry.title, content: entry.content };
                  return (
                    <div key={entry.id} className="space-y-3 rounded-md border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div><p className="text-xs uppercase text-muted-foreground">{entry.kind}</p><p className="text-xs text-muted-foreground">{formatDate(entry.createdAt)} · about {entry.tokenEstimate} tokens</p></div>
                        {selectedProject.status !== 'trashed' && <div className="flex items-center gap-2"><Label htmlFor={`memory-active-${entry.id}`} className="text-xs">Use as context</Label><Switch id={`memory-active-${entry.id}`} checked={entry.active !== false} onCheckedChange={(active) => handleUpdateMemory(entry, active)} /><Button type="button" variant="ghost" size="icon" onClick={() => handleDeleteMemory(entry.id)}><Trash2 className="h-4 w-4 text-red-500" /><span className="sr-only">Delete memory entry</span></Button></div>}
                      </div>
                      <Input value={draft.title} readOnly={selectedProject.status === 'trashed'} onChange={(event) => setMemoryDrafts((current) => ({ ...current, [entry.id]: { ...draft, title: event.target.value } }))} />
                      <Textarea value={draft.content} readOnly={selectedProject.status === 'trashed'} onChange={(event) => setMemoryDrafts((current) => ({ ...current, [entry.id]: { ...draft, content: event.target.value } }))} className="min-h-28" />
                      {selectedProject.status !== 'trashed' && <Button type="button" variant="outline" size="sm" onClick={() => handleUpdateMemory(entry)}><Save className="h-4 w-4" />Save Changes</Button>}
                    </div>
                  );
                })}
                {!isLoadingMemory && (!memoryEntries || memoryEntries.length === 0) && <div className="py-12 text-center text-sm text-muted-foreground">No memory entries yet.</div>}
              </div>
            )}
          </div>
        </ScrollArea>
      </section>
    </div>
  );
}
