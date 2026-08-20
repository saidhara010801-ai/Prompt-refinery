'use client';

import { LoginPage } from '@/components/auth/login-page';
import { SettingsProvider } from '@/context/settings-context';
import { SubscriptionProvider } from '@/context/subscription-context';
import { WorkflowProvider } from '@/context/workflow-context';
import { FirebaseClientProvider, useUser } from '@/firebase';
import { WorkspaceV2App } from './workspace-v2-app';
import { WorkspaceV2Fixture } from './workspace-v2-fixture';

function WorkspacePreviewContent({ fixture }: { fixture: boolean }) {
  const { user, isUserLoading } = useUser();

  if (fixture) {
    return <WorkspaceV2Fixture />;
  }

  if (isUserLoading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading workspace...</div>;
  }

  if (!user) {
    return <LoginPage showBrandMessage />;
  }

  return <WorkspaceV2App />;
}

export function WorkspacePreviewPage({ fixture = false }: { fixture?: boolean }) {
  if (fixture) {
    return <SettingsProvider><WorkspaceV2Fixture /></SettingsProvider>;
  }

  return (
    <FirebaseClientProvider>
      <SubscriptionProvider>
        <SettingsProvider>
          <WorkflowProvider>
            <WorkspacePreviewContent fixture={fixture} />
          </WorkflowProvider>
        </SettingsProvider>
      </SubscriptionProvider>
    </FirebaseClientProvider>
  );
}
