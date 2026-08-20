import { signupNotificationsAreConfigured } from './signup-notification-service';

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
    managedInference: boolean;
    freeManagedInference: boolean;
    localInferenceFallback: boolean;
    byokEncryption: boolean;
    razorpayBilling: boolean;
    apiTokenSecurity: boolean;
    extensionAccountLinking: boolean;
    signupNotifications: boolean;
  };
}

export const REQUIRED_PRODUCTION_VARIABLES = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
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

export const STRIPE_PRODUCTION_VARIABLES = [
  'STRIPE_SECRET_KEY',
  'STRIPE_PRO_PRICE_ID',
  'STRIPE_WEBHOOK_SECRET',
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
  'ENABLE_MANAGED_INFERENCE',
  'ENABLE_FREE_MANAGED_INFERENCE',
  'ENABLE_LOCAL_INFERENCE_FALLBACK',
  'ENABLE_BYOK',
  'ENABLE_RAZORPAY_BILLING',
  'ENABLE_EXTENSION_ACCOUNT_LINKING',
  'ENABLE_PUBLIC_API',
  'ENABLE_PROJECT_SHARING',
  'ENABLE_USAGE_ANALYTICS',
  'ENABLE_SIGNUP_NOTIFICATIONS',
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

function hasCurrentProviderPricing(environment: Environment) {
  const value = environment.CLARIFT_PROVIDER_PRICING_EFFECTIVE_DATE;
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ageMs = Date.now() - new Date(`${value}T00:00:00.000Z`).getTime();
  return ageMs >= 0 && ageMs <= 90 * 24 * 60 * 60 * 1000;
}

export function hasReleasedFreeProviderConfiguration(environment: Environment) {
  return environment.CLARIFT_FREE_OPENROUTER_MODEL === 'google/gemma-3-4b-it' &&
    environment.CLARIFT_FREE_TOGETHER_MODEL === 'google/gemma-3n-E4B-it' &&
    Number(environment.CLARIFT_OPENROUTER_INPUT_USD_PER_MILLION) === 0.05 &&
    Number(environment.CLARIFT_OPENROUTER_OUTPUT_USD_PER_MILLION) === 0.1 &&
    Number(environment.CLARIFT_TOGETHER_INPUT_USD_PER_MILLION) === 0.06 &&
    Number(environment.CLARIFT_TOGETHER_OUTPUT_USD_PER_MILLION) === 0.12;
}

function hasValidRazorpayCatalog(environment: Environment) {
  try {
    const catalog = JSON.parse(environment.RAZORPAY_CATALOG_JSON || 'null');
    if (!Array.isArray(catalog)) return false;
    const subscriptions = catalog.filter((entry) => entry?.kind === 'subscription' && entry?.razorpayPlanId && Number(entry?.creditsPerCycle) > 0);
    const packs = catalog.filter((entry) => entry?.kind === 'credit_pack' && Number(entry?.amountSubunits) > 0 && Number(entry?.credits) > 0);
    return subscriptions.length === 1 && packs.length >= 1;
  } catch {
    return false;
  }
}

function hasValidByokKey(environment: Environment) {
  const value = environment.CLARIFT_BYOK_ENCRYPTION_KEY?.trim() || '';
  try {
    const key = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
    return key.length === 32;
  } catch {
    return false;
  }
}

export function getMissingProductionVariables(environment: Environment): string[] {
  const requiredVariables = isEnabled(environment, 'ENABLE_STRIPE_CHECKOUT')
    ? [...REQUIRED_PRODUCTION_VARIABLES, ...STRIPE_PRODUCTION_VARIABLES]
    : REQUIRED_PRODUCTION_VARIABLES;

  return requiredVariables.filter((variable) => !hasValue(environment, variable));
}

export function getMissingFeatureFlags(environment: Environment): string[] {
  return FEATURE_FLAG_VARIABLES.filter((variable) => !isBooleanFlag(environment, variable));
}

export function getOptionalProductionWarnings(environment: Environment): string[] {
  const warnings: string[] = [];

  if (
    isEnabled(environment, 'ENABLE_STRIPE_CHECKOUT') &&
    (!hasValue(environment, 'STRIPE_PRO_PRICE_ID_USD') || !hasValue(environment, 'STRIPE_PRO_PRICE_ID_INR'))
  ) {
    warnings.push('Localized Stripe prices are not fully configured. Checkout will use STRIPE_PRO_PRICE_ID until localized pricing is implemented.');
  }

  if (isEnabled(environment, 'ENABLE_MANAGED_OPENROUTER') && !hasValue(environment, 'OPENROUTER_API_KEY')) {
    warnings.push('ENABLE_MANAGED_OPENROUTER is true but OPENROUTER_API_KEY is missing.');
  }

  if (isEnabled(environment, 'ENABLE_FILE_CONVERSION') && !hasValue(environment, 'MARKITDOWN_COMMAND')) {
    warnings.push('ENABLE_FILE_CONVERSION is true but MARKITDOWN_COMMAND is missing.');
  }

  if (!hasValue(environment, 'GEMINI_API_KEY')) {
    if (isEnabled(environment, 'ENABLE_MANAGED_INFERENCE') && !hasValue(environment, 'CLARIFT_GEMINI_API_KEY') && !hasValue(environment, 'GOOGLE_API_KEY')) {
      warnings.push(isEnabled(environment, 'ENABLE_LOCAL_INFERENCE_FALLBACK')
        ? 'No managed Gemini key is configured; Clarift will use the zero-cost local beta fallback.'
        : 'Managed Gemini inference is enabled but no managed Gemini key is configured.');
    }
  }

  if (isEnabled(environment, 'ENABLE_FREE_MANAGED_INFERENCE') &&
    (!hasValue(environment, 'CLARIFT_OPENROUTER_API_KEY') || !hasValue(environment, 'CLARIFT_TOGETHER_API_KEY'))) {
    warnings.push('Free managed inference is enabled but both managed provider secrets are not configured.');
  }

  if (isEnabled(environment, 'ENABLE_PROMOTION_CODES') && !hasValue(environment, 'PROMO_CODE_PEPPER')) {
    warnings.push('ENABLE_PROMOTION_CODES is true but PROMO_CODE_PEPPER is missing.');
  }

  if (isEnabled(environment, 'ENABLE_PUBLIC_API') && !hasValue(environment, 'CLARIFT_API_KEY_PEPPER')) {
    warnings.push('ENABLE_PUBLIC_API is true but CLARIFT_API_KEY_PEPPER is missing.');
  }

  if (isEnabled(environment, 'ENABLE_BYOK') && !hasValidByokKey(environment)) {
    warnings.push('ENABLE_BYOK is true but CLARIFT_BYOK_ENCRYPTION_KEY is missing or does not decode to 32 bytes.');
  }

  if (isEnabled(environment, 'ENABLE_RAZORPAY_BILLING') && !hasValidRazorpayCatalog(environment)) {
    warnings.push('Razorpay billing is enabled but the server-owned catalog is missing or invalid.');
  }

  if (!signupNotificationsAreConfigured(environment)) {
    warnings.push('Signup notifications are enabled but RESEND_API_KEY, SIGNUP_NOTIFICATION_FROM_EMAIL, or an owner recipient is missing.');
  }

  return warnings;
}

export function getRuntimeReadiness(environment: Environment): RuntimeReadiness {
  const firebaseClientConfig = REQUIRED_PRODUCTION_VARIABLES
    .filter((variable) => variable.startsWith('NEXT_PUBLIC_FIREBASE_'))
    .every((variable) => hasValue(environment, variable));
  const stripeSubscriptions = !isEnabled(environment, 'ENABLE_STRIPE_CHECKOUT') ||
    STRIPE_PRODUCTION_VARIABLES.every((variable) => hasValue(environment, variable));
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
  const managedOpenRouterFallback = !isEnabled(environment, 'ENABLE_MANAGED_OPENROUTER') ||
    hasValue(environment, 'CLARIFT_OPENROUTER_API_KEY') || hasValue(environment, 'OPENROUTER_API_KEY');
  const managedOpenRouterGuarded = !isEnabled(environment, 'ENABLE_MANAGED_OPENROUTER') ||
    (managedOpenRouterFallback && modelAllowlists && quotaConfig);
  const fileConversionRuntime = !isEnabled(environment, 'ENABLE_FILE_CONVERSION') ||
    hasValue(environment, 'MARKITDOWN_COMMAND');
  const localInferenceFallback = isEnabled(environment, 'ENABLE_LOCAL_INFERENCE_FALLBACK');
  const managedInference = !isEnabled(environment, 'ENABLE_MANAGED_INFERENCE') ||
    hasValue(environment, 'CLARIFT_GEMINI_API_KEY') || hasValue(environment, 'GEMINI_API_KEY') || hasValue(environment, 'GOOGLE_API_KEY') ||
    (isEnabled(environment, 'ENABLE_MANAGED_OPENROUTER') && (hasValue(environment, 'CLARIFT_OPENROUTER_API_KEY') || hasValue(environment, 'OPENROUTER_API_KEY'))) ||
    localInferenceFallback;
  const freeInferenceConfig = [
    'CLARIFT_FREE_OPENROUTER_MODEL',
    'CLARIFT_FREE_TOGETHER_MODEL',
    'CLARIFT_FREE_REFINEMENT_DAILY_UNITS',
    'CLARIFT_FREE_REFINEMENT_MONTHLY_UNITS',
    'CLARIFT_FREE_EVALUATION_DAILY_UNITS',
    'CLARIFT_FREE_EVALUATION_MONTHLY_UNITS',
    'CLARIFT_FREE_GLOBAL_CONCURRENCY',
    'CLARIFT_FREE_REMOTE_DEADLINE_MS',
    'CLARIFT_OPENROUTER_DAILY_BUDGET_USD',
    'CLARIFT_TOGETHER_DAILY_BUDGET_USD',
    'CLARIFT_REMOTE_ADMISSION_BUDGET_USD',
    'CLARIFT_OPENROUTER_INPUT_USD_PER_MILLION',
    'CLARIFT_OPENROUTER_OUTPUT_USD_PER_MILLION',
    'CLARIFT_TOGETHER_INPUT_USD_PER_MILLION',
    'CLARIFT_TOGETHER_OUTPUT_USD_PER_MILLION',
    'CLARIFT_PROVIDER_PRICING_EFFECTIVE_DATE',
  ].every((variable) => variable.includes('MODEL') || variable.includes('DATE')
    ? hasValue(environment, variable)
    : hasValue(environment, variable) && Number(environment[variable]) > 0);
  const freeManagedInference = !isEnabled(environment, 'ENABLE_FREE_MANAGED_INFERENCE') || (
    freeInferenceConfig &&
    hasReleasedFreeProviderConfiguration(environment) &&
    hasCurrentProviderPricing(environment) &&
    hasValue(environment, 'CLARIFT_OPENROUTER_API_KEY') &&
    hasValue(environment, 'CLARIFT_TOGETHER_API_KEY') &&
    Number(environment.CLARIFT_REMOTE_ADMISSION_BUDGET_USD) <=
      Number(environment.CLARIFT_OPENROUTER_DAILY_BUDGET_USD) + Number(environment.CLARIFT_TOGETHER_DAILY_BUDGET_USD)
  );
  const byokEncryption = !isEnabled(environment, 'ENABLE_BYOK') || hasValidByokKey(environment);
  const razorpayBilling = !isEnabled(environment, 'ENABLE_RAZORPAY_BILLING') || [
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
  ].every((variable) => hasValue(environment, variable)) && hasValidRazorpayCatalog(environment);
  const apiTokenSecurity = !isEnabled(environment, 'ENABLE_PUBLIC_API') ||
    hasValue(environment, 'CLARIFT_API_TOKEN_PEPPER') || hasValue(environment, 'CLARIFT_API_KEY_PEPPER');
  const extensionAccountLinking = !isEnabled(environment, 'ENABLE_EXTENSION_ACCOUNT_LINKING') ||
    (managedInference && checkoutReturnOrigin);
  const signupNotifications = signupNotificationsAreConfigured(environment);

  return {
    ready: firebaseClientConfig &&
      stripeSubscriptions &&
      checkoutReturnOrigin &&
      ownerBootstrap &&
      quotaConfig &&
      modelAllowlists &&
      emergencyFeatureFlags &&
      managedOpenRouterGuarded &&
      fileConversionRuntime &&
      managedInference &&
      freeManagedInference &&
      byokEncryption &&
      razorpayBilling &&
      apiTokenSecurity &&
      extensionAccountLinking &&
      signupNotifications,
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
      managedInference,
      freeManagedInference,
      localInferenceFallback,
      byokEncryption,
      razorpayBilling,
      apiTokenSecurity,
      extensionAccountLinking,
      signupNotifications,
    },
  };
}
