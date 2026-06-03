'use client';

import { useState } from 'react';
import { useUser, FirebaseClientProvider } from '@/firebase';
import { PromptRefineryApp } from '@/components/prompt-refinery/prompt-refinery-app';
import { LoginPage } from '@/components/auth/login-page';
import { Button } from '@/components/ui/button';
import { LogIn, LogOut } from 'lucide-react';
import { getAuth, signOut } from 'firebase/auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { ApiKeyProvider } from '@/context/api-key-context';
import { SettingsDialog } from '@/components/settings-dialog';
import { SettingsProvider } from '@/context/settings-context';
import { SubscriptionProvider } from '@/context/subscription-context';

function AppContent({ isShowingLogin, onContinueWithoutAccount }: { isShowingLogin: boolean; onContinueWithoutAccount: () => void }) {
  const { user, isUserLoading } = useUser();

  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!user && isShowingLogin) {
    return <LoginPage onContinueWithoutAccount={onContinueWithoutAccount} />;
  }

  return <PromptRefineryApp />;
}

function HomePageContent() {
  const { user } = useUser();
  const [isShowingLogin, setIsShowingLogin] = useState(false);

  const handleSignOut = () => {
    const auth = getAuth();
    signOut(auth);
  };

  return (
    <div className="min-h-screen bg-transparent text-foreground flex flex-col">
      <header className="flex items-center justify-end gap-2 px-4 pt-4">
        <SettingsDialog />
        {user && (
          <Button variant="ghost" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        )}
        {!user && (
          <Button variant="ghost" onClick={() => setIsShowingLogin(true)}>
            <LogIn className="mr-2 h-4 w-4" />
            Sign In
          </Button>
        )}
        <ThemeToggle />
      </header>
      <main className="flex-1 container mx-auto px-4 py-6 md:py-10">
        <AppContent
          isShowingLogin={isShowingLogin}
          onContinueWithoutAccount={() => setIsShowingLogin(false)}
        />
      </main>
    </div>
  );
}


export default function Home() {
  return (
    <FirebaseClientProvider>
      <ApiKeyProvider>
        <SubscriptionProvider>
          <SettingsProvider>
            <HomePageContent />
          </SettingsProvider>
        </SubscriptionProvider>
      </ApiKeyProvider>
    </FirebaseClientProvider>
  );
}
