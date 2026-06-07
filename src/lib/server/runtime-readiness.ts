type Environment = Record<string, string | undefined>;

export interface RuntimeReadiness {
  ready: boolean;
  checks: {
    firebaseClientConfig: boolean;
    stripeSubscriptions: boolean;
    checkoutReturnOrigin: boolean;
    ownerBootstrap: boolean;
    quotaConfig: boolean;
    modelAllowlists: boolean;
    emergencyFeatureFlags: boolean;
    managedOpenRouterFallback: boolean;
    managedOpenRouterGuarded: boolean;
    fileConversionRuntime: boolean;
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
  'OWNER_EMAILS',
  'FREE_DAILY_REQUEST_LIMIT',
  'PRO_DAILY_REQUEST_LIMIT',
  'PRO_MONTHLY_TOKEN_LIMIT',
  'MAX_UPLOAD_SIZE_MB',
  'RATE_LIMIT_WINDOW_SECONDS',
  'RATE_LIMIT_MAX_REQUESTS',
  'ADMIN_RATE_LIMIT_MAX_REQUESTS',
  'OPENROUTER_ALLOWED_MODELS',
  'GEMINI_ALLOWED_MODELS',
] as const;

export const OPTIONAL_PRODUCTION_VARIABLES = [
  'STRIPE_PRO_PRICE_ID_USD',
  'STRIPE_PRO_PRICE_ID_INR',
  'STRIPE_PRO_PRICE_ID_DEFAULT',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'MARKITDOWN_COMMAND',
] as const;

export const FEATURE_FLAG_VARIABLES = [
  'ENABLE_ADMIN_CENTER',
  'ENABLE_DISCOUNT_ADMIN',
  'ENABLE_FILE_CONVERSION',
  'ENABLE_STRIPE_CHECKOUT',
  'ENABLE_PROMOTION_CODES',
  'ENABLE_SUPPORT_ACCESS_REQUESTS',
  'ENABLE_MANAGED_OPENROUTER',
] as const;

function hasValue(environment: Environment, variable: string) {
  return Boolean(environment[variable]?.trim());
}

function isBooleanFlag(environment: Environment, variable: string) {
  const value = environment[variable]?.trim().toLowerCase();
  return value === 'true' || value === 'false';
}

function isEnabled(environment: Environment, variable: string) {
  return environment[variable]?.trim().toLowerCase() === 'true';
}

export function getMissingProductionVariables(environment: Environment): string[] {
  return REQUIRED_PRODUCTION_VARIABLES.filter((variable) => !hasValue(environment, variable));
}

export function getMissingFeatureFlags(environment: Environment): string[] {
  return FEATURE_FLAG_VARIABLES.filter((variable) => !isBooleanFlag(environment, variable));
}

export function getOptionalProductionWarnings(environment: Environment): string[] {
  const warnings: string[] = [];

  if (!hasValue(environment, 'STRIPE_PRO_PRICE_ID_USD') || !hasValue(environment, 'STRIPE_PRO_PRICE_ID_INR')) {
    warnings.push('Localized Stripe prices are not fully configured. Checkout will use STRIPE_PRO_PRICE_ID until localized pricing is implemented.');
  }

  if (isEnabled(environment, 'ENABLE_MANAGED_OPENROUTER') && !hasValue(environment, 'OPENROUTER_API_KEY')) {
    warnings.push('ENABLE_MANAGED_OPENROUTER is true but OPENROUTER_API_KEY is missing.');
  }

  if (isEnabled(environment, 'ENABLE_FILE_CONVERSION') && !hasValue(environment, 'MARKITDOWN_COMMAND')) {
    warnings.push('ENABLE_FILE_CONVERSION is true but MARKITDOWN_COMMAND is missing.');
  }

  if (!hasValue(environment, 'GEMINI_API_KEY')) {
    warnings.push('Managed Gemini fallback is not configured. BYOK Gemini remains available.');
  }

  return warnings;
}

export function getRuntimeReadiness(environment: Environment): RuntimeReadiness {
  const firebaseClientConfig = REQUIRED_PRODUCTION_VARIABLES
    .filter((variable) => variable.startsWith('NEXT_PUBLIC_FIREBASE_'))
    .every((variable) => hasValue(environment, variable));
  const stripeSubscriptions = ['STRIPE_SECRET_KEY', 'STRIPE_PRO_PRICE_ID', 'STRIPE_WEBHOOK_SECRET']
    .every((variable) => hasValue(environment, variable));
  const checkoutReturnOrigin = hasValue(environment, 'APP_BASE_URL');
  const ownerBootstrap = hasValue(environment, 'OWNER_EMAILS') || hasValue(environment, 'OWNER_UIDS');
  const quotaConfig = [
    'FREE_DAILY_REQUEST_LIMIT',
    'PRO_DAILY_REQUEST_LIMIT',
    'PRO_MONTHLY_TOKEN_LIMIT',
    'MAX_UPLOAD_SIZE_MB',
    'RATE_LIMIT_WINDOW_SECONDS',
    'RATE_LIMIT_MAX_REQUESTS',
    'ADMIN_RATE_LIMIT_MAX_REQUESTS',
  ].every((variable) => hasValue(environment, variable));
  const modelAllowlists = ['OPENROUTER_ALLOWED_MODELS', 'GEMINI_ALLOWED_MODELS']
    .every((variable) => hasValue(environment, variable));
  const emergencyFeatureFlags = getMissingFeatureFlags(environment).length === 0;
  const managedOpenRouterFallback = hasValue(environment, 'OPENROUTER_API_KEY');
  const managedOpenRouterGuarded = !isEnabled(environment, 'ENABLE_MANAGED_OPENROUTER') ||
    (managedOpenRouterFallback && modelAllowlists && quotaConfig);
  const fileConversionRuntime = !isEnabled(environment, 'ENABLE_FILE_CONVERSION') ||
    hasValue(environment, 'MARKITDOWN_COMMAND');

  return {
    ready: firebaseClientConfig &&
      stripeSubscriptions &&
      checkoutReturnOrigin &&
      ownerBootstrap &&
      quotaConfig &&
      modelAllowlists &&
      emergencyFeatureFlags &&
      managedOpenRouterGuarded &&
      fileConversionRuntime,
    checks: {
      firebaseClientConfig,
      stripeSubscriptions,
      checkoutReturnOrigin,
      ownerBootstrap,
      quotaConfig,
      modelAllowlists,
      emergencyFeatureFlags,
      managedOpenRouterFallback,
      managedOpenRouterGuarded,
      fileConversionRuntime,
    },
  };
}
