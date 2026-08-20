'use client';

import { LoginPage } from '@/components/auth/login-page';
import { SettingsProvider } from '@/context/settings-context';
import { SubscriptionProvider } from '@/context/subscription-context';
import { WorkflowProvider } from '@/context/workflow-context';
import { FirebaseClientProvider, useUser } from '@/firebase';
import { WorkspaceV2App } from './workspace-v2-app';

function WorkspacePreviewContent() {
  const { user, isUserLoading } = useUser();

  if (isUserLoading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading workspace...</div>;
  }

  if (!user) {
    return <LoginPage showBrandMessage />;
  }

  return <WorkspaceV2App />;
}

export function WorkspacePreviewPage() {
  return (
    <FirebaseClientProvider>
      <SubscriptionProvider>
        <SettingsProvider>
          <WorkflowProvider>
            <WorkspacePreviewContent />
          </WorkflowProvider>
        </SettingsProvider>
      </SubscriptionProvider>
    </FirebaseClientProvider>
  );
}
