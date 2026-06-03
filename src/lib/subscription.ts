import type { PromptTechnique } from '@/lib/constants';

export type SubscriptionTier = 'free' | 'pro' | 'pro-max';

export const FREE_SAVED_PROMPT_LIMIT = 10;
export const FREE_MANAGED_REFINEMENT_DAILY_LIMIT = 5;

export const FREE_PROMPT_TECHNIQUES: PromptTechnique[] = [
  'Zero-shot',
  'Few-shot',
  'Role / persona',
];

export function isProTier(tier?: SubscriptionTier | null): boolean {
  return tier === 'pro' || tier === 'pro-max';
}

export function isFreeTechnique(technique: PromptTechnique): boolean {
  return FREE_PROMPT_TECHNIQUES.includes(technique);
}
