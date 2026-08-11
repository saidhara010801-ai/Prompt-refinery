'use client';

import { createContext, type ReactNode, useEffect, useMemo } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { useDoc, useFirebase, useMemoFirebase } from '@/firebase';
import {
  FREE_MANAGED_REFINEMENT_DAILY_LIMIT,
  FREE_SAVED_PROMPT_LIMIT,
  isProTier,
  type SubscriptionTier,
} from '@/lib/subscription';

interface SubscriptionProfile {
  subscriptionTier?: SubscriptionTier;
  savedPromptCount?: number;
  managedRefinementsDate?: string;
  managedRefinementsUsedToday?: number;
  subscriptionStatus?: string;
  subscriptionSource?: 'stripe' | 'promo' | 'manual' | 'team' | 'beta' | 'test' | 'owner' | null;
}

interface SubscriptionContextValue {
  tier: SubscriptionTier;
  isPro: boolean;
  savedPromptCount: number;
  savedPromptLimit: number | null;
  managedRefinementsUsedToday: number;
  managedRefinementLimit: number | null;
  isLoading: boolean;
  source: SubscriptionProfile['subscriptionSource'];
  planLabel: string;
}

export const SubscriptionContext = createContext<SubscriptionContextValue>({
  tier: 'free',
  isPro: false,
  savedPromptCount: 0,
  savedPromptLimit: FREE_SAVED_PROMPT_LIMIT,
  managedRefinementsUsedToday: 0,
  managedRefinementLimit: FREE_MANAGED_REFINEMENT_DAILY_LIMIT,
  isLoading: true,
  source: null,
  planLabel: 'Free',
});

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { firestore, user } = useFirebase();
  const userRef = useMemoFirebase(
    () => user ? doc(firestore, `users/${user.uid}`) : null,
    [firestore, user]
  );
  const { data: profile, isLoading } = useDoc<SubscriptionProfile>(userRef);

  useEffect(() => {
    if (!user || !userRef || isLoading || profile) {
      return;
    }

    setDoc(userRef, {
      id: user.uid,
      email: user.email ?? '',
      name: user.displayName ?? '',
      subscriptionTier: 'free',
      savedPromptCount: 0,
      managedRefinementsDate: new Date().toISOString().slice(0, 10),
      managedRefinementsUsedToday: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch((error) => {
      console.error('Could not initialize user subscription profile:', error);
    });
  }, [isLoading, profile, user, userRef]);

  useEffect(() => {
    const pendingCode = sessionStorage.getItem('clarift-pending-promo');
    if (!user || !pendingCode) return;
    user.getIdToken().then((token) => fetch('/api/promo/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: pendingCode }),
    })).then(() => sessionStorage.removeItem('clarift-pending-promo')).catch(() => undefined);
  }, [user]);

  const value = useMemo<SubscriptionContextValue>(() => {
    const tier = profile?.subscriptionTier ?? 'free';
    const hasPro = isProTier(tier);
    const today = new Date().toISOString().slice(0, 10);
    const managedUsage = profile?.managedRefinementsDate === today
      ? profile.managedRefinementsUsedToday ?? 0
      : 0;

    return {
      tier,
      isPro: hasPro,
      savedPromptCount: profile?.savedPromptCount ?? 0,
      savedPromptLimit: hasPro ? null : FREE_SAVED_PROMPT_LIMIT,
      managedRefinementsUsedToday: managedUsage,
      managedRefinementLimit: hasPro ? null : FREE_MANAGED_REFINEMENT_DAILY_LIMIT,
      isLoading,
      source: profile?.subscriptionSource ?? null,
      planLabel: hasPro && profile?.subscriptionSource === 'promo' ? 'Pro — Promo' : hasPro ? 'Pro' : 'Free',
    };
  }, [isLoading, profile]);

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}
