'use client';

import React, { useEffect, useState, type ReactNode } from 'react';
import { FirebaseProvider } from '@/firebase/provider';
import { initializeFirebase } from '@/firebase';

interface FirebaseClientProviderProps {
  children: ReactNode;
}

type FirebaseServices = ReturnType<typeof initializeFirebase>;

export function FirebaseClientProvider({ children }: FirebaseClientProviderProps) {
  const [firebaseServices, setFirebaseServices] = useState<FirebaseServices | null>(null);
  const [initializationError, setInitializationError] = useState<Error | null>(null);

  useEffect(() => {
    try {
      setFirebaseServices(initializeFirebase());
    } catch (error) {
      setInitializationError(error instanceof Error ? error : new Error('Firebase initialization failed.'));
    }
  }, []);

  if (initializationError) {
    console.error('Firebase initialization failed:', initializationError);
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Firebase is not configured for this environment.
      </div>
    );
  }

  if (!firebaseServices) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <FirebaseProvider
      firebaseApp={firebaseServices.firebaseApp}
      auth={firebaseServices.auth}
      firestore={firebaseServices.firestore}
    >
      {children}
    </FirebaseProvider>
  );
}
