'use client';

import { FormEvent, useState } from 'react';
import { collection, doc, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { FolderKanban, Plus, Trash2 } from 'lucide-react';

import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

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
  llmResponse?: string;
  timestamp?: {
    seconds: number;
    nanoseconds: number;
  };
}

interface ProjectsTabProps {
  selectedProjectId: string | null;
  onSelectProject: (project: Project | null) => void;
}

function formatDate(timestamp?: { seconds: number }) {
  if (!timestamp?.seconds) {
    return 'Just now';
  }

  return new Date(timestamp.seconds * 1000).toLocaleDateString();
}

export function ProjectsTab({ selectedProjectId, onSelectProject }: ProjectsTabProps) {
  const { firestore, user } = useFirebase();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [responseDrafts, setResponseDrafts] = useState<Record<string, string>>({});

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

  const handleCreateProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!user || !firestore || !name.trim()) return;

    const projectsCol = collection(firestore, `users/${user.uid}/projects`);
    addDocumentNonBlocking(projectsCol, {
      userId: user.uid,
      name: name.trim(),
      description: description.trim(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).then((docRef) => {
      if (docRef) {
        onSelectProject({
          id: docRef.id,
          userId: user.uid,
          name: name.trim(),
          description: description.trim(),
        });
      }
    });

    setName('');
    setDescription('');
    toast({
      title: 'Project Created',
      description: 'New refinements can now use this project memory.',
    });
  };

  const handleDeleteProject = (project: Project) => {
    if (!user || !firestore) return;

    deleteDocumentNonBlocking(doc(firestore, `users/${user.uid}/projects`, project.id));
    if (selectedProjectId === project.id) {
      onSelectProject(null);
    }

    toast({
      title: 'Project Deleted',
      description: 'The project shell was removed. Existing nested session cleanup may require a backend job.',
    });
  };

  const handleSaveResponse = (session: ProjectSession) => {
    if (!user || !firestore || !selectedProjectId) return;

    const llmResponse = responseDrafts[session.id] ?? session.llmResponse ?? '';
    const sessionRef = doc(firestore, `users/${user.uid}/projects/${selectedProjectId}/projectSessions`, session.id);
    updateDocumentNonBlocking(sessionRef, { llmResponse });
    updateDocumentNonBlocking(doc(firestore, `users/${user.uid}/projects`, selectedProjectId), {
      updatedAt: serverTimestamp(),
    });

    toast({
      title: 'Project Memory Updated',
      description: 'This response note will be available to future refinements.',
    });
  };

  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-8">
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderKanban className="text-primary" />
            <span>Projects</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={handleCreateProject} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="projectName">Name</Label>
              <Input
                id="projectName"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g., Product launch prompts"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="projectDescription">Description</Label>
              <Textarea
                id="projectDescription"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Context, audience, brand notes, or goals."
              />
            </div>
            <Button type="submit" className="w-full" disabled={!user || !name.trim()}>
              <Plus className="mr-2 h-4 w-4" />
              Create Project
            </Button>
          </form>

          <div className="space-y-3">
            {isLoading && (
              <>
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </>
            )}
            {!isLoading && projects && projects.length > 0 && projects.map((project) => (
              <div
                key={project.id}
                className={cn(
                  'flex items-start justify-between gap-3 rounded-lg border p-3',
                  selectedProjectId === project.id && 'border-primary bg-primary/5'
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onSelectProject(project)}
                >
                  <p className="font-semibold truncate">{project.name}</p>
                  {project.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{project.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">Updated {formatDate(project.updatedAt)}</p>
                </button>
                <Button variant="ghost" size="icon" onClick={() => handleDeleteProject(project)}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                  <span className="sr-only">Delete project</span>
                </Button>
              </div>
            ))}
            {!isLoading && (!projects || projects.length === 0) && (
              <div className="text-center text-muted-foreground py-8">
                <p>No projects yet.</p>
                <p>Create your first project for memory across sessions.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{selectedProject ? selectedProject.name : 'Project Memory'}</CardTitle>
        </CardHeader>
        <CardContent>
          {!selectedProject && (
            <div className="text-center text-muted-foreground py-16">
              <p>Select or create a project to see its refinement history.</p>
            </div>
          )}

          {selectedProject && (
            <div className="space-y-4">
              {selectedProject.description && (
                <p className="text-sm text-muted-foreground">{selectedProject.description}</p>
              )}
              {isLoadingSessions && (
                <>
                  <Skeleton className="h-28 w-full" />
                  <Skeleton className="h-28 w-full" />
                </>
              )}
              {!isLoadingSessions && sessions && sessions.length > 0 && sessions.map((session) => (
                <div key={session.id} className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-1 rounded-full">
                      {session.promptType} · v{session.version ?? 1}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatDate(session.timestamp)}</span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm mb-1">Raw Prompt</h4>
                    <p className="text-sm text-muted-foreground">{session.rawPrompt}</p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm mb-1">Refined Prompt</h4>
                    <pre className="whitespace-pre-wrap font-code text-xs bg-muted p-3 rounded-md">
                      <code>{session.refinedPrompt}</code>
                    </pre>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`llmResponse-${session.id}`}>LLM Response / Notes</Label>
                    <Textarea
                      id={`llmResponse-${session.id}`}
                      defaultValue={session.llmResponse}
                      onChange={(event) =>
                        setResponseDrafts((drafts) => ({
                          ...drafts,
                          [session.id]: event.target.value,
                        }))
                      }
                      placeholder="Paste the downstream LLM response or notes to help future refinements."
                    />
                    <Button variant="outline" size="sm" onClick={() => handleSaveResponse(session)}>
                      Save Memory Note
                    </Button>
                  </div>
                </div>
              ))}
              {!isLoadingSessions && (!sessions || sessions.length === 0) && (
                <div className="text-center text-muted-foreground py-12">
                  <p>No sessions yet.</p>
                  <p>Select this project in the Refinery tab and run a refinement to build memory.</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
