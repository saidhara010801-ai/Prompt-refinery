import assert from 'node:assert/strict';
import test from 'node:test';

import { getTokenCounts } from '../src/ai/flows/get-token-counts';
import { formatOutput } from '../src/lib/output-formats';
import { getCheckoutReturnOrigin } from '../src/lib/server/checkout-origin';
import {
  clearRequestRateLimitsForTests,
  consumeRequestLimit,
  getRequestRateLimitEntryCountForTests,
} from '../src/lib/server/request-rate-limit';
import {
  getMissingFeatureFlags,
  getMissingProductionVariables,
  getOptionalProductionWarnings,
  getRuntimeReadiness,
  FEATURE_FLAG_VARIABLES,
  REQUIRED_PRODUCTION_VARIABLES,
} from '../src/lib/server/runtime-readiness';
import {
  FREE_MANAGED_REFINEMENT_DAILY_LIMIT,
  FREE_SAVED_PROMPT_LIMIT,
  isFreeTechnique,
  isProTier,
} from '../src/lib/subscription';
import { MAX_TOKEN_ESTIMATE_CHARACTERS } from '../src/lib/input-limits';

test('token estimates are deterministic and do not require an API key', async () => {
  assert.deepEqual(await getTokenCounts({ text: '' }), {
    gemini: 0,
    openai: 0,
    deepseek: 0,
    qwen: 0,
  });

  const first = await getTokenCounts({ text: 'Write a concise product launch brief.' });
  const second = await getTokenCounts({ text: 'Write a concise product launch brief.', apiKey: 'ignored' });
  assert.deepEqual(first, second);
  assert.ok(first.gemini > 0);
  await assert.rejects(
    () => getTokenCounts({ text: 'x'.repeat(MAX_TOKEN_ESTIMATE_CHARACTERS + 1) }),
    /too_big/
  );
});

test('subscription helpers preserve Free and Pro product rules', () => {
  assert.equal(FREE_SAVED_PROMPT_LIMIT, 10);
  assert.equal(FREE_MANAGED_REFINEMENT_DAILY_LIMIT, 5);
  assert.equal(isFreeTechnique('Zero-shot'), true);
  assert.equal(isFreeTechnique('ReAct'), false);
  assert.equal(isProTier('free'), false);
  assert.equal(isProTier('pro'), true);
  assert.equal(isProTier('pro-max'), true);
});

test('route throttle blocks requests after the configured window limit', () => {
  clearRequestRateLimitsForTests();
  const options = { bucket: 'test', key: 'client', limit: 2, windowMs: 1000, now: 100 };
  assert.equal(consumeRequestLimit(options).allowed, true);
  assert.equal(consumeRequestLimit(options).allowed, true);
  assert.equal(consumeRequestLimit(options).allowed, false);
  assert.equal(consumeRequestLimit({ ...options, now: 1100 }).allowed, true);
});

test('route throttle prunes expired keys and bounds retained clients', () => {
  clearRequestRateLimitsForTests();
  for (let index = 0; index < 1100; index += 1) {
    consumeRequestLimit({ bucket: 'test', key: `client-${index}`, limit: 1, windowMs: 1000, now: 100 });
  }
  assert.equal(getRequestRateLimitEntryCountForTests(), 1000);
  consumeRequestLimit({ bucket: 'test', key: 'fresh', limit: 1, windowMs: 1000, now: 1100 });
  assert.equal(getRequestRateLimitEntryCountForTests(), 1);
});

test('checkout redirects use the configured production origin', () => {
  assert.equal(
    getCheckoutReturnOrigin('https://untrusted.example/api/checkout_sessions', {
      NODE_ENV: 'production',
      APP_BASE_URL: 'https://prompt-refinery.example/path',
    }),
    'https://prompt-refinery.example'
  );
  assert.throws(
    () => getCheckoutReturnOrigin('https://untrusted.example/api/checkout_sessions', { NODE_ENV: 'production' }),
    /APP_BASE_URL is required/
  );
});

test('production readiness reports required configuration without exposing values', () => {
  const environment = Object.fromEntries(
    REQUIRED_PRODUCTION_VARIABLES.map((variable) => [variable, `configured-${variable}`])
  );
  for (const variable of FEATURE_FLAG_VARIABLES) {
    environment[variable] = 'false';
  }

  assert.deepEqual(getMissingProductionVariables(environment), []);
  assert.deepEqual(getMissingFeatureFlags(environment), []);
  assert.equal(getRuntimeReadiness(environment).ready, true);
  assert.equal(getRuntimeReadiness(environment).checks.checkoutReturnOrigin, true);
  assert.equal(getRuntimeReadiness(environment).checks.ownerBootstrap, true);
  assert.equal(getRuntimeReadiness({}).ready, false);
  assert.equal(getRuntimeReadiness({}).checks.checkoutReturnOrigin, false);
  assert.deepEqual(getMissingProductionVariables({}), [...REQUIRED_PRODUCTION_VARIABLES]);
  assert.deepEqual(getMissingFeatureFlags({}), [...FEATURE_FLAG_VARIABLES]);
  assert.ok(getOptionalProductionWarnings(environment).some((warning) => warning.includes('Localized Stripe prices')));
});

test('production readiness fails closed for unguarded optional features', () => {
  const environment = Object.fromEntries(
    REQUIRED_PRODUCTION_VARIABLES.map((variable) => [variable, `configured-${variable}`])
  );
  for (const variable of FEATURE_FLAG_VARIABLES) {
    environment[variable] = 'false';
  }

  environment.ENABLE_MANAGED_OPENROUTER = 'true';
  assert.equal(getRuntimeReadiness(environment).ready, false);
  assert.equal(getRuntimeReadiness(environment).checks.managedOpenRouterGuarded, false);
  assert.ok(getOptionalProductionWarnings(environment).some((warning) => warning.includes('OPENROUTER_API_KEY')));

  environment.OPENROUTER_API_KEY = 'configured-openrouter';
  assert.equal(getRuntimeReadiness(environment).ready, true);

  environment.ENABLE_FILE_CONVERSION = 'true';
  assert.equal(getRuntimeReadiness(environment).ready, false);
  assert.equal(getRuntimeReadiness(environment).checks.fileConversionRuntime, false);

  environment.MARKITDOWN_COMMAND = 'markitdown';
  assert.equal(getRuntimeReadiness(environment).ready, true);
});

test('output formatting supports plain, Markdown, and JSON copy styles', () => {
  assert.equal(formatOutput('plain', 'Refined'), 'Refined');
  assert.equal(formatOutput('markdown', 'Refined'), '# Refined Prompt\n\nRefined');
  assert.deepEqual(JSON.parse(formatOutput('json', 'Refined', 'Raw', 'Zero-shot')), {
    promptType: 'Zero-shot',
    originalPrompt: 'Raw',
    refinedPrompt: 'Refined',
  });
});
