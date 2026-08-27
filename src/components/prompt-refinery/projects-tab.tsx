'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { collection, orderBy, query } from 'firebase/firestore';

import {
  createProjectAction,
  createProjectMemoryEntryAction,
  deleteProjectAction,
  deleteProjectMemoryEntryAction,
  permanentlyDeleteProjectAction,
  restoreProjectAction,
  searchProjectMemoryAction,
  updateProjectMemoryEntryAction,
  updateProjectSessionResponseAction,
} from '@/app/project-actions';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { Project } from './project-types';
import { ProjectSidebar } from './project-sidebar';
import type { ProjectMemorySearchResult, ProjectSession } from './project-session-types';
import { ProjectWorkspacePanel } from './project-workspace-panel';
import type { ProjectMemoryEntry } from './stage2-types';

interface ProjectsTabProps {
  projects: Project[] | null;
  isLoadingProjects: boolean;
  selectedProject: Project | null;
  onSelectProject: (project: Project | null) => void;
  requestedSessionId?: string | null;
  onRequestedSessionSelected?: () => void;
  variant?: 'legacy' | 'workspace-v2';
}

export function ProjectsTab({
  projects,
  isLoadingProjects,
  selectedProject,
  onSelectProject,
  requestedSessionId,
  onRequestedSessionSelected,
  variant = 'legacy',
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
  const [searchResults, setSearchResults] = useState<ProjectMemorySearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [sortOrder, setSortOrder] = useState<'updated' | 'name'>('updated');
  const selectedProjectId = selectedProject?.id ?? null;
  const activeProjectOptions = (projects ?? []).filter((project) => project.status !== 'trashed');
  const projectOptions = selectedProject && !activeProjectOptions.some((project) => project.id === selectedProject.id)
    ? [selectedProject, ...activeProjectOptions]
    : activeProjectOptions;

  const sessionsQuery = useMemoFirebase(() => {
    if (!user || !firestore || !selectedProjectId) return null;
    return query(collection(firestore, `projects/${selectedProjectId}/projectSessions`), orderBy('timestamp', 'desc'));
  }, [user, firestore, selectedProjectId]);
  const { data: sessions, isLoading: isLoadingSessions } = useCollection<ProjectSession>(sessionsQuery);

  const memoryQuery = useMemoFirebase(() => {
    if (!user || !firestore || !selectedProjectId) return null;
    return query(collection(firestore, `projects/${selectedProjectId}/memoryEntries`), orderBy('createdAt', 'desc'));
  }, [user, firestore, selectedProjectId]);
  const { data: memoryEntries, isLoading: isLoadingMemory } = useCollection<ProjectMemoryEntry>(memoryQuery);
  const selectedSession = useMemo(
    () => sessions?.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );

  useEffect(() => {
    if (requestedSessionId) setPendingSessionId(requestedSessionId);
  }, [requestedSessionId]);

  useEffect(() => {
    if (pendingSessionId) {
      if (!sessions?.some((session) => session.id === pendingSessionId)) return;
      setSelectedSessionId(pendingSessionId);
      setPendingSessionId(null);
      setIsComposing(false);
      if (pendingSessionId === requestedSessionId) onRequestedSessionSelected?.();
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
      toast({ title: 'Project Created', description: 'New refinements can now use this project memory.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could Not Create Project', description: error instanceof Error ? error.message : 'Please try again.' });
    }
  };

  const handleDeleteProject = async (project: Project) => {
    if (!user || !firestore) return;
    try {
      await deleteProjectAction({ firebaseIdToken: await user.getIdToken(), projectId: project.id });
      if (selectedProjectId === project.id) handleSelectProject(null);
      toast({ title: 'Project Moved to Trash', description: 'You can restore it for 30 days before permanent deletion.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could Not Delete Project', description: error instanceof Error ? error.message : 'Please try again.' });
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
      toast({ title: 'Project Memory Updated', description: 'This response note will be available to future refinements.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could Not Update Project Memory', description: error instanceof Error ? error.message : 'Please try again.' });
    }
  };

  const visibleProjects = (projects ?? [])
    .filter((project) => showTrash ? project.status === 'trashed' : project.status !== 'trashed')
    .sort((left, right) => sortOrder === 'name'
      ? left.name.localeCompare(right.name)
      : (right.updatedAt?.seconds ?? 0) - (left.updatedAt?.seconds ?? 0));

  return (
    <div className={cn(
      'grid min-h-[680px] gap-6 lg:grid-cols-[340px_minmax(0,1fr)]',
      isSidebarCollapsed && 'lg:grid-cols-[72px_minmax(0,1fr)]',
      variant === 'workspace-v2' && 'gap-4 lg:grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[360px_minmax(0,1fr)]',
      variant === 'workspace-v2' && isSidebarCollapsed && 'xl:grid-cols-[72px_minmax(0,1fr)]'
    )}>
      <ProjectSidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapsed={() => setIsSidebarCollapsed((current) => !current)}
        selectedProject={selectedProject}
        selectedProjectId={selectedProjectId}
        searchText={searchText}
        onSearchTextChange={setSearchText}
        onSearch={handleSearch}
        isSearching={isSearching}
        searchResults={searchResults}
        onSelectSearchResult={(result) => {
          handleSelectProject(projects?.find((candidate) => candidate.id === result.projectId) ?? null);
          setWorkspaceView('memory');
        }}
        showTrash={showTrash}
        onShowTrashChange={setShowTrash}
        name={name}
        onNameChange={setName}
        templateId={templateId}
        onTemplateIdChange={setTemplateId}
        description={description}
        onDescriptionChange={setDescription}
        onCreateProject={handleCreateProject}
        canCreateProject={Boolean(user && name.trim())}
        isLoadingProjects={isLoadingProjects}
        visibleProjects={visibleProjects}
        onSelectProject={handleSelectProject}
        onRestoreProject={handleRestoreProject}
        onPermanentDeleteProject={handlePermanentDelete}
        onDeleteProject={handleDeleteProject}
        onNewChat={handleNewChat}
        isLoadingSessions={isLoadingSessions}
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        onSelectSession={setSelectedSessionId}
        variant={variant}
        sortOrder={sortOrder}
        onSortOrderChange={setSortOrder}
      />

      <ProjectWorkspacePanel
        selectedProject={selectedProject}
        selectedProjectId={selectedProjectId}
        projectOptions={projectOptions}
        isLoadingProjects={isLoadingProjects}
        workspaceView={workspaceView}
        onWorkspaceViewChange={(view) => {
          setWorkspaceView(view);
          if (view === 'memory') setIsComposing(false);
        }}
        onSelectProject={handleSelectProject}
        onNewChat={handleNewChat}
        isComposing={isComposing}
        onProjectRefinementSaved={handleProjectRefinementSaved}
        isLoadingSessions={isLoadingSessions}
        selectedSession={selectedSession}
        pendingSessionId={pendingSessionId}
        responseDrafts={responseDrafts}
        onResponseDraftChange={(sessionId, value) => setResponseDrafts((drafts) => ({ ...drafts, [sessionId]: value }))}
        onSaveResponse={handleSaveResponse}
        noteTitle={noteTitle}
        onNoteTitleChange={setNoteTitle}
        noteContent={noteContent}
        onNoteContentChange={setNoteContent}
        onCreateNote={handleCreateNote}
        isLoadingMemory={isLoadingMemory}
        memoryEntries={memoryEntries}
        memoryDrafts={memoryDrafts}
        onMemoryDraftChange={(entryId, draft) => setMemoryDrafts((current) => ({ ...current, [entryId]: draft }))}
        onUpdateMemory={handleUpdateMemory}
        onDeleteMemory={handleDeleteMemory}
        variant={variant}
      />
    </div>
  );
}
