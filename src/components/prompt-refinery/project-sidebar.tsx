'use client';

import type { FormEvent } from 'react';
import {
  ArchiveRestore,
  FolderKanban,
  FolderX,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { PROJECT_TEMPLATES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { Project } from './project-types';
import {
  formatProjectDate,
  getProjectChatTitle,
  type ProjectMemorySearchResult,
  type ProjectSession,
} from './project-session-types';

interface ProjectSidebarProps {
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  selectedProject: Project | null;
  selectedProjectId: string | null;
  searchText: string;
  onSearchTextChange: (value: string) => void;
  onSearch: () => void;
  isSearching: boolean;
  searchResults: ProjectMemorySearchResult[];
  onSelectSearchResult: (result: ProjectMemorySearchResult) => void;
  showTrash: boolean;
  onShowTrashChange: (showTrash: boolean) => void;
  name: string;
  onNameChange: (value: string) => void;
  templateId: string;
  onTemplateIdChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  onCreateProject: (event: FormEvent<HTMLFormElement>) => void;
  canCreateProject: boolean;
  isLoadingProjects: boolean;
  visibleProjects: Project[];
  onSelectProject: (project: Project | null) => void;
  onRestoreProject: (project: Project) => void;
  onPermanentDeleteProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onNewChat: () => void;
  isLoadingSessions: boolean;
  sessions: ProjectSession[] | null;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
}

export function ProjectSidebar({
  isCollapsed,
  onToggleCollapsed,
  selectedProject,
  selectedProjectId,
  searchText,
  onSearchTextChange,
  onSearch,
  isSearching,
  searchResults,
  onSelectSearchResult,
  showTrash,
  onShowTrashChange,
  name,
  onNameChange,
  templateId,
  onTemplateIdChange,
  description,
  onDescriptionChange,
  onCreateProject,
  canCreateProject,
  isLoadingProjects,
  visibleProjects,
  onSelectProject,
  onRestoreProject,
  onPermanentDeleteProject,
  onDeleteProject,
  onNewChat,
  isLoadingSessions,
  sessions,
  selectedSessionId,
  onSelectSession,
}: ProjectSidebarProps) {
  return (
    <aside className="rounded-lg border border-primary/20 bg-background">
      <div className="flex h-14 items-center justify-between gap-2 border-b px-3">
        {!isCollapsed && (
          <div className="flex min-w-0 items-center gap-2">
            <FolderKanban className="h-5 w-5 shrink-0 text-primary" />
            <p className="truncate font-semibold">Projects</p>
          </div>
        )}
        <Button type="button" variant="ghost" size="icon" className="ml-auto" onClick={onToggleCollapsed}>
          {isCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          <span className="sr-only">{isCollapsed ? 'Expand project menu' : 'Collapse project menu'}</span>
        </Button>
      </div>

      {isCollapsed ? (
        <div className="flex flex-col items-center gap-2 p-2">
          <Button type="button" size="icon" onClick={onToggleCollapsed}>
            <FolderKanban className="h-4 w-4" />
            <span className="sr-only">Open projects</span>
          </Button>
          {selectedProject && (
            <Button type="button" variant="outline" size="icon" onClick={onNewChat}>
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
                <Input
                  value={searchText}
                  onChange={(event) => onSearchTextChange(event.target.value)}
                  placeholder="Search all project memory"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onSearch();
                    }
                  }}
                />
                <Button type="button" variant="outline" size="icon" onClick={onSearch} disabled={isSearching || searchText.trim().length < 2}>
                  <Search className="h-4 w-4" />
                  <span className="sr-only">Search projects</span>
                </Button>
              </div>
              {searchResults.length > 0 && (
                <div className="space-y-1 rounded-md border p-2">
                  {searchResults.slice(0, 6).map((result) => (
                    <button
                      key={`${result.projectId}-${result.id}`}
                      type="button"
                      className="w-full rounded p-2 text-left text-xs hover:bg-muted"
                      onClick={() => onSelectSearchResult(result)}
                    >
                      <span className="block truncate font-semibold">{result.title}</span>
                      <span className="line-clamp-2 text-muted-foreground">{result.snippet}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button type="button" size="sm" variant={!showTrash ? 'default' : 'outline'} onClick={() => onShowTrashChange(false)}>
                <FolderKanban className="h-4 w-4" />Active
              </Button>
              <Button type="button" size="sm" variant={showTrash ? 'default' : 'outline'} onClick={() => onShowTrashChange(true)}>
                <FolderX className="h-4 w-4" />Trash
              </Button>
            </div>

            {!showTrash && (
              <form onSubmit={onCreateProject} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="projectName">Name</Label>
                  <Input id="projectName" value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="Product launch prompts" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="projectTemplate">Template</Label>
                  <Select value={templateId || '__blank__'} onValueChange={(value) => onTemplateIdChange(value === '__blank__' ? '' : value)}>
                    <SelectTrigger id="projectTemplate"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__blank__">Blank project</SelectItem>
                      {PROJECT_TEMPLATES.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="projectDescription">Description</Label>
                  <Textarea
                    id="projectDescription"
                    value={description}
                    onChange={(event) => onDescriptionChange(event.target.value)}
                    placeholder="Audience, brand notes, goals."
                    className="min-h-20"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={!canCreateProject}>
                  <Plus className="h-4 w-4" />Create Project
                </Button>
              </form>
            )}

            <Separator />

            <div className="space-y-2">
              {isLoadingProjects && <><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></>}
              {!isLoadingProjects && visibleProjects.map((project) => (
                <div
                  key={project.id}
                  className={cn('group flex items-start justify-between gap-2 rounded-md border p-2', selectedProjectId === project.id && 'border-primary bg-primary/5')}
                >
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelectProject(project)}>
                    <p className="truncate text-sm font-semibold">{project.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Updated {formatProjectDate(project.updatedAt)}</p>
                  </button>
                  {project.status === 'trashed' ? (
                    <div className="flex">
                      <Button variant="ghost" size="icon" onClick={() => onRestoreProject(project)}><ArchiveRestore className="h-4 w-4" /><span className="sr-only">Restore project</span></Button>
                      <Button variant="ghost" size="icon" onClick={() => onPermanentDeleteProject(project)}><Trash2 className="h-4 w-4 text-red-500" /><span className="sr-only">Delete forever</span></Button>
                    </div>
                  ) : (
                    <Button variant="ghost" size="icon" onClick={() => onDeleteProject(project)}><Trash2 className="h-4 w-4 text-red-500" /><span className="sr-only">Move project to trash</span></Button>
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
                    <Button type="button" variant="outline" size="sm" onClick={onNewChat}><Plus className="h-4 w-4" />New</Button>
                  </div>
                  {isLoadingSessions && <><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></>}
                  {!isLoadingSessions && sessions?.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => onSelectSession(session.id)}
                      className={cn('flex w-full items-start gap-2 rounded-md border p-2 text-left text-sm', selectedSessionId === session.id && 'border-primary bg-primary/5')}
                    >
                      <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{getProjectChatTitle(session)}</span>
                        <span className="text-xs text-muted-foreground">{formatProjectDate(session.timestamp)}</span>
                      </span>
                    </button>
                  ))}
                  {!isLoadingSessions && (!sessions || sessions.length === 0) && <p className="py-4 text-center text-sm text-muted-foreground">No chats yet.</p>}
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      )}
    </aside>
  );
}
