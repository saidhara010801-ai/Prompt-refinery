'use client';

import { useUser, FirebaseClientProvider } from '@/firebase';
import { PromptRefineryApp } from '@/components/prompt-refinery/prompt-refinery-app';
import { LoginPage } from '@/components/auth/login-page';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';
import { getAuth, signOut } from 'firebase/auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { SettingsDialog } from '@/components/settings-dialog';
import { SettingsProvider } from '@/context/settings-context';
import { SubscriptionProvider } from '@/context/subscription-context';
import { Logo } from '@/components/icons/logo';
import { WorkflowProvider } from '@/context/workflow-context';

function AppContent() {
  const { user, isUserLoading } = useUser();

  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return <PromptRefineryApp />;
}

function HomePageContent() {
  const { user } = useUser();

  const handleSignOut = () => {
    const auth = getAuth();
    signOut(auth);
  };

  return (
    <div className="min-h-screen bg-transparent text-foreground flex flex-col">
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
      <main className="flex-1 container mx-auto px-4 py-6 md:py-10">
        <AppContent />
      </main>
    </div>
  );
}


export default function Home() {
  return (
    <FirebaseClientProvider>
      <SubscriptionProvider>
          <SettingsProvider>
            <WorkflowProvider>
              <HomePageContent />
            </WorkflowProvider>
          </SettingsProvider>
      </SubscriptionProvider>
    </FirebaseClientProvider>
  );
}
