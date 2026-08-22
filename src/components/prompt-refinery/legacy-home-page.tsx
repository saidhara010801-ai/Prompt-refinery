'use client';

import { getAuth, signOut } from 'firebase/auth';
import { LogOut } from 'lucide-react';

import { LoginPage } from '@/components/auth/login-page';
import { Logo } from '@/components/icons/logo';
import { SettingsDialog } from '@/components/settings-dialog';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { SettingsProvider } from '@/context/settings-context';
import { SubscriptionProvider } from '@/context/subscription-context';
import { WorkflowProvider } from '@/context/workflow-context';
import { FirebaseClientProvider, useUser } from '@/firebase';
import { PromptRefineryApp } from './prompt-refinery-app';

function AppContent() {
  const { user, isUserLoading } = useUser();

  if (isUserLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return <PromptRefineryApp />;
}

function LegacyHomeContent() {
  const { user } = useUser();

  const handleSignOut = () => {
    signOut(getAuth());
  };

  return (
    <div className="flex min-h-screen flex-col bg-transparent text-foreground">
      <header className="flex items-center justify-between gap-3 px-4 pt-4">
        <Logo variant="wordmark" className="h-9 w-28 sm:w-32" />
        <div className="flex items-center gap-2">
          {user && <SettingsDialog />}
          {user && (
            <Button variant="ghost" onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </Button>
          )}
          <ThemeToggle />
        </div>
      </header>
      <main className="container mx-auto flex-1 px-4 py-6 md:py-10">
        <AppContent />
      </main>
    </div>
  );
}

export function LegacyHomePage() {
  return (
    <FirebaseClientProvider>
      <SubscriptionProvider>
        <SettingsProvider>
          <WorkflowProvider>
            <LegacyHomeContent />
          </WorkflowProvider>
        </SettingsProvider>
      </SubscriptionProvider>
    </FirebaseClientProvider>
  );
}
