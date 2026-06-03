type Environment = Record<string, string | undefined>;

export interface RuntimeReadiness {
  ready: boolean;
  checks: {
    firebaseClientConfig: boolean;
    stripeSubscriptions: boolean;
    checkoutReturnOrigin: boolean;
    managedOpenRouterFallback: boolean;
    markitdownOverride: boolean;
  };
}

export const REQUIRED_PRODUCTION_VARIABLES = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  'STRIPE_SECRET_KEY',
  'STRIPE_PRO_PRICE_ID',
  'STRIPE_WEBHOOK_SECRET',
  'APP_BASE_URL',
] as const;

function hasValue(environment: Environment, variable: string) {
  return Boolean(environment[variable]?.trim());
}

export function getMissingProductionVariables(environment: Environment): string[] {
  return REQUIRED_PRODUCTION_VARIABLES.filter((variable) => !hasValue(environment, variable));
}

export function getRuntimeReadiness(environment: Environment): RuntimeReadiness {
  const firebaseClientConfig = REQUIRED_PRODUCTION_VARIABLES
    .filter((variable) => variable.startsWith('NEXT_PUBLIC_FIREBASE_'))
    .every((variable) => hasValue(environment, variable));
  const stripeSubscriptions = ['STRIPE_SECRET_KEY', 'STRIPE_PRO_PRICE_ID', 'STRIPE_WEBHOOK_SECRET']
    .every((variable) => hasValue(environment, variable));
  const checkoutReturnOrigin = hasValue(environment, 'APP_BASE_URL');

  return {
    ready: firebaseClientConfig && stripeSubscriptions && checkoutReturnOrigin,
    checks: {
      firebaseClientConfig,
      stripeSubscriptions,
      checkoutReturnOrigin,
      managedOpenRouterFallback: hasValue(environment, 'OPENROUTER_API_KEY'),
      markitdownOverride: hasValue(environment, 'MARKITDOWN_COMMAND'),
    },
  };
}
