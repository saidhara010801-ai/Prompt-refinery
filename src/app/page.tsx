'use client';

import { useUser, FirebaseClientProvider } from '@/firebase';
import { PromptRefineryApp } from '@/components/prompt-refinery/prompt-refinery-app';
import { LoginPage } from '@/components/auth/login-page';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';
import { getAuth, signOut } from 'firebase/auth';

function AppContent() {
  const { user, isUserLoading } = useUser();

  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return <PromptRefineryApp />;
}

export default function Home() {
  const handleSignOut = () => {
    const auth = getAuth();
    signOut(auth);
  };

  return (
    <FirebaseClientProvider>
      <div className="min-h-screen bg-background text-foreground flex flex-col">
        <header className="absolute top-4 right-4">
            <Button variant="ghost" onClick={handleSignOut}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
            </Button>
        </header>
        <main className="flex-1 container mx-auto px-4 py-8 md:py-12">
          <AppContent />
        </main>
      </div>
    </FirebaseClientProvider>
  );
}
