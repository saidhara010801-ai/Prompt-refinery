import type { FreeGatewaySource } from './free-inference-gateway';
import type { OpenModelProvider } from './open-model-client';

export interface OpenModelProviderConfig {
  provider: OpenModelProvider;
  model: string;
  apiKey: string;
  endpointUrl?: string;
  cloudRunAudience?: string;
  timeoutMs: number;
}

const DEFAULT_PROVIDER_ORDER: OpenModelProvider[] = ['gemma', 'openrouter', 'together'];

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBaseUrl(value: string | undefined, environment: Record<string, string | undefined>) {
  if (!value?.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const localDevelopment = environment.NODE_ENV !== 'production' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1');
  if (url.protocol !== 'https:' && !(localDevelopment && url.protocol === 'http:')) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/v1/chat/completions') ? path : `${path}/v1/chat/completions`;
  return url.toString();
}

export function getFreeProviderOrder(
  environment: Record<string, string | undefined> = process.env,
): OpenModelProvider[] {
  const configured = (environment.CLARIFT_FREE_PROVIDER_ORDER || DEFAULT_PROVIDER_ORDER.join(','))
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter((provider): provider is OpenModelProvider => provider === 'gemma' || provider === 'together' || provider === 'openrouter');
  const unique = Array.from(new Set(configured));
  const withoutDisabledGemma = environment.ENABLE_SELF_HOSTED_GEMMA === 'true'
    ? unique
    : unique.filter((provider) => provider !== 'gemma');
  return withoutDisabledGemma.length ? withoutDisabledGemma : ['together', 'openrouter'];
}

export function getOpenModelProviderConfig(
  provider: OpenModelProvider,
  source: FreeGatewaySource,
  environment: Record<string, string | undefined> = process.env,
): OpenModelProviderConfig | null {
  if (provider === 'gemma') {
    if (environment.ENABLE_SELF_HOSTED_GEMMA !== 'true') return null;
    const endpointUrl = normalizeBaseUrl(environment.GEMMA_BASE_URL, environment);
    const apiKey = environment.GEMMA_API_KEY?.trim() || '';
    const model = environment.GEMMA_MODEL_ID?.trim() || 'google/gemma-4-E4B-it';
    if (!endpointUrl || !apiKey || !model) return null;
    return {
      provider,
      model,
      apiKey,
      endpointUrl,
      ...(environment.GEMMA_AUTH_MODE === 'google-id-token' ? {
        cloudRunAudience: environment.GEMMA_CLOUD_RUN_AUDIENCE?.trim() || new URL(endpointUrl).origin,
      } : {}),
      timeoutMs: positiveInteger(
        source === 'extension' ? environment.GEMMA_EXTENSION_TIMEOUT_MS : environment.GEMMA_TIMEOUT_MS,
        source === 'extension' ? 20_000 : 25_000,
      ),
    };
  }

  if (provider === 'together') {
    const apiKey = (environment.CLARIFT_TOGETHER_API_KEY || environment.TOGETHER_API_KEY || '').trim();
    if (!apiKey) return null;
    return {
      provider,
      model: environment.CLARIFT_FREE_TOGETHER_MODEL?.trim() || 'google/gemma-4-31B-it',
      apiKey,
      timeoutMs: positiveInteger(
        source === 'extension' ? environment.CLARIFT_TOGETHER_EXTENSION_TIMEOUT_MS : environment.CLARIFT_TOGETHER_TIMEOUT_MS,
        source === 'extension' ? 21_000 : 24_000,
      ),
    };
  }

  const apiKey = (environment.CLARIFT_OPENROUTER_API_KEY || environment.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) return null;
  return {
    provider,
    model: environment.CLARIFT_FREE_OPENROUTER_MODEL?.trim() || 'google/gemma-4-26b-a4b-it',
    apiKey,
    timeoutMs: positiveInteger(
      source === 'extension' ? environment.CLARIFT_OPENROUTER_EXTENSION_TIMEOUT_MS : environment.CLARIFT_OPENROUTER_TIMEOUT_MS,
      source === 'extension' ? 20_000 : 32_000,
    ),
  };
}

export function freeRemoteDeadlineMs(
  source: FreeGatewaySource,
  environment: Record<string, string | undefined> = process.env,
) {
  return positiveInteger(
    source === 'extension' ? environment.CLARIFT_FREE_EXTENSION_DEADLINE_MS : environment.CLARIFT_FREE_REMOTE_DEADLINE_MS,
    source === 'extension' ? 43_000 : 65_000,
  );
}

export function isValidSelfHostedGemmaConfiguration(
  environment: Record<string, string | undefined> = process.env,
) {
  if (environment.ENABLE_SELF_HOSTED_GEMMA !== 'true') return true;
  return Boolean(getOpenModelProviderConfig('gemma', 'app', environment));
}
