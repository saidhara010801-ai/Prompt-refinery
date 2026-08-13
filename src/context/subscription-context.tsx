'use client';

import { createContext, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { doc } from 'firebase/firestore';

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
  tenantId: string | null;
  workspaceId: string | null;
  creditBalance: number;
  reservedCredits: number;
  availableCredits: number;
  taskCosts: TaskCosts;
  tenantPlan: string;
  tenantPlanStatus: string;
  capabilities: { byok: boolean; developerApi: boolean; extension: boolean; razorpay: boolean; inference: 'managed' | 'local-fallback' | 'unavailable' };
  refreshTenant: () => Promise<void>;
}

type TaskCosts = Record<'quick_refine' | 'guided_fix' | 'full_council' | 'evaluate' | 'apply_fix' | 'convert_document', number>;
const DEFAULT_TASK_COSTS: TaskCosts = { quick_refine: 1, guided_fix: 2, full_council: 5, evaluate: 1, apply_fix: 2, convert_document: 0 };

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
  tenantId: null,
  workspaceId: null,
  creditBalance: 0,
  reservedCredits: 0,
  availableCredits: 0,
  taskCosts: DEFAULT_TASK_COSTS,
  tenantPlan: 'free',
  tenantPlanStatus: 'active',
  capabilities: { byok: false, developerApi: false, extension: false, razorpay: false, inference: 'unavailable' },
  refreshTenant: async () => undefined,
});

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { firestore, user } = useFirebase();
  const userRef = useMemoFirebase(
    () => user ? doc(firestore, `users/${user.uid}`) : null,
    [firestore, user]
  );
  const { data: profile, isLoading } = useDoc<SubscriptionProfile>(userRef);
  const [tenant, setTenant] = useState<{
    tenantId: string;
    workspaceId: string;
    balance: number;
    reserved: number;
    available: number;
    taskCosts: TaskCosts;
    plan: string;
    planStatus: string;
    capabilities: { byok: boolean; developerApi: boolean; extension: boolean; razorpay: boolean; inference: 'managed' | 'local-fallback' | 'unavailable' };
  } | null>(null);

  const refreshTenant = useCallback(async () => {
    if (!user) {
      setTenant(null);
      return;
    }
    const response = await fetch('/api/account/tenant', {
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || 'Could not load your Clarift workspace.');
    setTenant(payload);
  }, [user]);

  useEffect(() => {
    refreshTenant().catch((error) => console.error('Could not initialize personal workspace:', {
      name: error instanceof Error ? error.name : 'UnknownError',
    }));
  }, [refreshTenant]);

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
    const hasPro = isProTier(tier) || tenant?.plan === 'individual';
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
      tenantId: tenant?.tenantId ?? null,
      workspaceId: tenant?.workspaceId ?? null,
      creditBalance: tenant?.balance ?? 0,
      reservedCredits: tenant?.reserved ?? 0,
      availableCredits: tenant?.available ?? 0,
      taskCosts: tenant?.taskCosts ?? DEFAULT_TASK_COSTS,
      tenantPlan: tenant?.plan ?? 'free',
      tenantPlanStatus: tenant?.planStatus ?? 'active',
      capabilities: tenant?.capabilities ?? { byok: false, developerApi: false, extension: false, razorpay: false, inference: 'unavailable' },
      refreshTenant,
    };
  }, [isLoading, profile, refreshTenant, tenant]);

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}
