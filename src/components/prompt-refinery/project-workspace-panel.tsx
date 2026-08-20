'use client';

import { Clock3, LogOut, MessageSquareText, Plus, Save, Send, StickyNote, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { Project } from './project-types';
import { formatProjectDate, type ProjectSession } from './project-session-types';
import { RefineryTab } from './refinery-tab';
import { ShareDialog } from './share-dialog';
import type { ProjectMemoryEntry } from './stage2-types';
import { cn } from '@/lib/utils';

const ALL_PROJECTS_VALUE = '__all_projects__';

interface ProjectWorkspacePanelProps {
  selectedProject: Project | null;
  selectedProjectId: string | null;
  projectOptions: Project[];
  isLoadingProjects: boolean;
  workspaceView: 'chat' | 'memory';
  onWorkspaceViewChange: (view: 'chat' | 'memory') => void;
  onSelectProject: (project: Project | null) => void;
  onNewChat: () => void;
  isComposing: boolean;
  onProjectRefinementSaved: (sessionId: string) => void;
  isLoadingSessions: boolean;
  selectedSession: ProjectSession | null;
  pendingSessionId: string | null;
  responseDrafts: Record<string, string>;
  onResponseDraftChange: (sessionId: string, value: string) => void;
  onSaveResponse: (session: ProjectSession) => void;
  noteTitle: string;
  onNoteTitleChange: (value: string) => void;
  noteContent: string;
  onNoteContentChange: (value: string) => void;
  onCreateNote: () => void;
  isLoadingMemory: boolean;
  memoryEntries: ProjectMemoryEntry[] | null;
  memoryDrafts: Record<string, { title: string; content: string }>;
  onMemoryDraftChange: (entryId: string, draft: { title: string; content: string }) => void;
  onUpdateMemory: (entry: ProjectMemoryEntry, active?: boolean) => void;
  onDeleteMemory: (entryId: string) => void;
  variant?: 'legacy' | 'workspace-v2';
}

export function ProjectWorkspacePanel({
  selectedProject,
  selectedProjectId,
  projectOptions,
  isLoadingProjects,
  workspaceView,
  onWorkspaceViewChange,
  onSelectProject,
  onNewChat,
  isComposing,
  onProjectRefinementSaved,
  isLoadingSessions,
  selectedSession,
  pendingSessionId,
  responseDrafts,
  onResponseDraftChange,
  onSaveResponse,
  noteTitle,
  onNoteTitleChange,
  noteContent,
  onNoteContentChange,
  onCreateNote,
  isLoadingMemory,
  memoryEntries,
  memoryDrafts,
  onMemoryDraftChange,
  onUpdateMemory,
  onDeleteMemory,
  variant = 'legacy',
}: ProjectWorkspacePanelProps) {
  return (
    <section className={cn('min-w-0 rounded-lg border bg-background', variant === 'workspace-v2' && 'overflow-hidden')}>
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{selectedProject ? selectedProject.name : 'Project Chats'}</h2>
          {selectedProject?.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{selectedProject.description}</p>}
          {selectedProject?.defaultGuidelines?.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {selectedProject.defaultGuidelines.map((guideline) => <span key={guideline} className="rounded border px-2 py-0.5 text-xs text-muted-foreground">{guideline}</span>)}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {selectedProject && selectedProject.status !== 'trashed' && (
            <div className="flex rounded-md border p-1">
              <Button type="button" size="sm" variant={workspaceView === 'chat' ? 'secondary' : 'ghost'} onClick={() => onWorkspaceViewChange('chat')}>
                <MessageSquareText className="h-4 w-4" />Chat
              </Button>
              <Button type="button" size="sm" variant={workspaceView === 'memory' ? 'secondary' : 'ghost'} onClick={() => onWorkspaceViewChange('memory')}>
                <Clock3 className="h-4 w-4" />Memory
              </Button>
            </div>
          )}
          <Select
            value={selectedProjectId ?? ALL_PROJECTS_VALUE}
            onValueChange={(projectId) => onSelectProject(projectId === ALL_PROJECTS_VALUE ? null : projectOptions.find((project) => project.id === projectId) ?? null)}
            disabled={isLoadingProjects}
          >
            <SelectTrigger className="w-[190px]" aria-label="Switch project"><SelectValue placeholder="Choose project" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_PROJECTS_VALUE}>All projects</SelectItem>
              {projectOptions.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {selectedProject && (
            <>
              {selectedProject.status !== 'trashed' && <ShareDialog resourceType="project" resourceId={selectedProject.id} resourceName={selectedProject.name} />}
              <Button type="button" variant="outline" onClick={() => onSelectProject(null)}><LogOut className="h-4 w-4" />Leave Project</Button>
              {selectedProject.status !== 'trashed' && <Button type="button" onClick={onNewChat}><Send className="h-4 w-4" />New Chat</Button>}
            </>
          )}
        </div>
      </div>

      <ScrollArea className={cn('h-[624px]', variant === 'workspace-v2' && 'h-[620px] xl:h-[calc(100vh-13rem)]')}>
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 md:p-6">
          {!selectedProject && (
            <div className="flex min-h-[440px] items-center justify-center text-center text-sm text-muted-foreground">Select or create a project.</div>
          )}

          {selectedProject && workspaceView === 'chat' && isComposing && (
            <RefineryTab selectedProject={selectedProject} projectWorkspace onProjectRefinementSaved={onProjectRefinementSaved} />
          )}

          {selectedProject && workspaceView === 'chat' && !isComposing && !isLoadingSessions && !selectedSession && !pendingSessionId && (
            <div className="flex min-h-[440px] flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
              <p>No chats in this project yet.</p>
              <Button type="button" onClick={onNewChat}><Send className="h-4 w-4" />Start Chat</Button>
            </div>
          )}

          {selectedProject && workspaceView === 'chat' && !isComposing && (isLoadingSessions || pendingSessionId) && (
            <div className="space-y-4"><Skeleton className="ml-auto h-24 w-4/5" /><Skeleton className="h-36 w-11/12" /></div>
          )}

          {selectedProject && workspaceView === 'chat' && !isComposing && selectedSession && (
            <>
              <div className="flex justify-center">
                <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                  {selectedSession.promptType} · v{selectedSession.version ?? 1} · {formatProjectDate(selectedSession.timestamp)}
                </span>
              </div>
              <div className="ml-auto max-w-[86%] rounded-lg bg-primary px-4 py-3 text-primary-foreground">
                <p className="whitespace-pre-wrap text-sm">{selectedSession.rawPrompt}</p>
              </div>
              <div className="mr-auto max-w-[92%] rounded-lg border bg-muted/50 px-4 py-3">
                <pre className="whitespace-pre-wrap font-code text-sm"><code>{selectedSession.refinedPrompt}</code></pre>
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
                  onChange={(event) => onResponseDraftChange(selectedSession.id, event.target.value)}
                  placeholder="Paste downstream response notes."
                  className="min-h-28"
                />
                <Button variant="outline" size="sm" onClick={() => onSaveResponse(selectedSession)}>Save Memory Note</Button>
              </div>
            </>
          )}

          {selectedProject && workspaceView === 'memory' && (
            <div className="space-y-5">
              {selectedProject.status !== 'trashed' && (
                <div className="space-y-3 rounded-md border p-4">
                  <div className="flex items-center gap-2 font-semibold"><StickyNote className="h-4 w-4 text-primary" />Add Memory Note</div>
                  <Input value={noteTitle} onChange={(event) => onNoteTitleChange(event.target.value)} placeholder="Note title" />
                  <Textarea value={noteContent} onChange={(event) => onNoteContentChange(event.target.value)} placeholder="Project decision, constraint, source note, or reusable context" className="min-h-24" />
                  <Button type="button" size="sm" onClick={onCreateNote} disabled={!noteTitle.trim() || !noteContent.trim()}><Plus className="h-4 w-4" />Add Note</Button>
                </div>
              )}

              {isLoadingMemory && <div className="space-y-3"><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>}
              {!isLoadingMemory && memoryEntries?.map((entry) => {
                const draft = memoryDrafts[entry.id] ?? { title: entry.title, content: entry.content };
                return (
                  <div key={entry.id} className="space-y-3 rounded-md border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div><p className="text-xs uppercase text-muted-foreground">{entry.kind}</p><p className="text-xs text-muted-foreground">{formatProjectDate(entry.createdAt)} · about {entry.tokenEstimate} tokens</p></div>
                      {selectedProject.status !== 'trashed' && (
                        <div className="flex items-center gap-2">
                          <Label htmlFor={`memory-active-${entry.id}`} className="text-xs">Use as context</Label>
                          <Switch id={`memory-active-${entry.id}`} checked={entry.active !== false} onCheckedChange={(active) => onUpdateMemory(entry, active)} />
                          <Button type="button" variant="ghost" size="icon" onClick={() => onDeleteMemory(entry.id)}><Trash2 className="h-4 w-4 text-red-500" /><span className="sr-only">Delete memory entry</span></Button>
                        </div>
                      )}
                    </div>
                    <Input value={draft.title} readOnly={selectedProject.status === 'trashed'} onChange={(event) => onMemoryDraftChange(entry.id, { ...draft, title: event.target.value })} />
                    <Textarea value={draft.content} readOnly={selectedProject.status === 'trashed'} onChange={(event) => onMemoryDraftChange(entry.id, { ...draft, content: event.target.value })} className="min-h-28" />
                    {selectedProject.status !== 'trashed' && <Button type="button" variant="outline" size="sm" onClick={() => onUpdateMemory(entry)}><Save className="h-4 w-4" />Save Changes</Button>}
                  </div>
                );
              })}
              {!isLoadingMemory && (!memoryEntries || memoryEntries.length === 0) && <div className="py-12 text-center text-sm text-muted-foreground">No memory entries yet.</div>}
            </div>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}
