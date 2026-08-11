'use client';

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

export interface WorkflowAttachment {
  name: string;
  mimeType: string;
  content: string;
}

export interface RefineryTransfer {
  id: string;
  source: 'converter' | 'evaluator' | 'saved-prompt' | 'project';
  prompt?: string;
  attachments?: WorkflowAttachment[];
  projectId?: string | null;
}

interface WorkflowContextValue {
  refineryTransfer: RefineryTransfer | null;
  sendToRefinery: (transfer: Omit<RefineryTransfer, 'id'>) => void;
  clearRefineryTransfer: (id: string) => void;
}

const WorkflowContext = createContext<WorkflowContextValue>({
  refineryTransfer: null,
  sendToRefinery: () => undefined,
  clearRefineryTransfer: () => undefined,
});

export function WorkflowProvider({ children }: { children: ReactNode }) {
  const [refineryTransfer, setRefineryTransfer] = useState<RefineryTransfer | null>(null);

  const sendToRefinery = useCallback((transfer: Omit<RefineryTransfer, 'id'>) => {
    const nextTransfer = {
      ...transfer,
      id: crypto.randomUUID(),
    };
    sessionStorage.setItem('clarift-refinery-transfer', JSON.stringify(nextTransfer));
    setRefineryTransfer(nextTransfer);
  }, []);

  const clearRefineryTransfer = useCallback((id: string) => {
    setRefineryTransfer((current) => current?.id === id ? null : current);
    const stored = sessionStorage.getItem('clarift-refinery-transfer');
    if (stored) {
      try {
        if ((JSON.parse(stored) as RefineryTransfer).id === id) {
          sessionStorage.removeItem('clarift-refinery-transfer');
        }
      } catch {
        sessionStorage.removeItem('clarift-refinery-transfer');
      }
    }
  }, []);

  const value = useMemo(() => ({ refineryTransfer, sendToRefinery, clearRefineryTransfer }), [
    refineryTransfer,
    sendToRefinery,
    clearRefineryTransfer,
  ]);

  return <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>;
}

export function useWorkflow() {
  return useContext(WorkflowContext);
}
