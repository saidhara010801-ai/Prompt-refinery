import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { getTokenCounts } from '../src/ai/flows/get-token-counts';
import { formatOutput } from '../src/lib/output-formats';
import {
  canConvertWithTextFallback,
  convertTextLikeBufferToMarkdown,
  MarkitdownRuntimeUnavailableError,
  packagedMarkitdownCommandCandidates,
  parseMarkitdownCommand,
  resolveMarkitdownCommand,
  safeConversionExtension,
} from '../src/lib/server/markitdown-converter';
import { getCheckoutReturnOrigin } from '../src/lib/server/checkout-origin';
import {
  clearRequestRateLimitsForTests,
  consumeRequestLimit,
  getRequestRateLimitEntryCountForTests,
} from '../src/lib/server/request-rate-limit';
import {
  ADMIN_MAX_PAGE_SIZE,
  clampAdminPageSize,
  redactAdminAuditMetadata,
} from '../src/lib/server/admin-service';
import { getAdminFailureAuditMetadata, getAdminRateLimitForTests } from '../src/app/api/admin/_shared';
import { assertCanCreateCheckoutForProfile } from '../src/lib/server/account-service';
import {
  buildCheckoutSessionParams,
  buildBillingPortalSessionParams,
  buildStripeSubscriptionPatch,
  buildStripeWebhookEventRecord,
  isAllowedBrowserPostOrigin,
  isPromotionCodesEnabled,
  isStripeSubscriptionActive,
  selectStripePriceForUser,
} from '../src/lib/server/stripe-billing';
import {
  getMissingFeatureFlags,
  getMissingProductionVariables,
  getOptionalProductionWarnings,
  getRuntimeReadiness,
  FEATURE_FLAG_VARIABLES,
  REQUIRED_PRODUCTION_VARIABLES,
  STRIPE_PRODUCTION_VARIABLES,
} from '../src/lib/server/runtime-readiness';
import {
  FREE_MANAGED_REFINEMENT_DAILY_LIMIT,
  FREE_SAVED_PROMPT_LIMIT,
  isFreeTechnique,
  isProTier,
} from '../src/lib/subscription';
import { MAX_TOKEN_ESTIMATE_CHARACTERS } from '../src/lib/input-limits';
import {
  assertActiveAccount,
  canAccessRole,
  evaluateEntitlement,
  getBootstrapRole,
  hashRequestValue,
  isMockAuthAllowed,
  mapFirebaseAuthError,
  normalizeUserProfile,
} from '../src/lib/server/user-access';
import { analyzeMarkdownStructure, buildConversionWarnings, estimateTokenCounts, normalizedSearchTerms } from '../src/lib/stage2-utils';

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

test('stripe price selection is server-owned and localized with safe fallback', () => {
  const environment = {
    STRIPE_PRO_PRICE_ID: 'price_legacy',
    STRIPE_PRO_PRICE_ID_USD: 'price_usd',
    STRIPE_PRO_PRICE_ID_INR: 'price_inr',
    STRIPE_PRO_PRICE_ID_DEFAULT: 'price_default',
  };

  assert.deepEqual(selectStripePriceForUser({ country: 'IN' }, environment), {
    priceId: 'price_inr',
    currency: 'inr',
  });
  assert.deepEqual(selectStripePriceForUser({ locale: 'en-IN' }, environment), {
    priceId: 'price_inr',
    currency: 'inr',
  });
  assert.deepEqual(selectStripePriceForUser({ country: 'US' }, environment), {
    priceId: 'price_usd',
    currency: 'usd',
  });
  assert.deepEqual(selectStripePriceForUser({ country: 'ZZ' }, environment), {
    priceId: 'price_default',
    currency: 'default',
  });
  assert.deepEqual(selectStripePriceForUser({ country: 'IN' }, {
    ...environment,
    STRIPE_PRO_PRICE_ID_INR: '',
  }), {
    priceId: 'price_default',
    currency: 'default',
  });
});

test('checkout session params ignore spoofed client price and toggle promotion codes', () => {
  assert.equal(isPromotionCodesEnabled({ ENABLE_PROMOTION_CODES: 'true' }), true);
  assert.equal(isPromotionCodesEnabled({ ENABLE_PROMOTION_CODES: 'false' }), false);

  const params = buildCheckoutSessionParams({
    uid: 'uid-1',
    email: 'user@example.com',
    priceId: 'price_server_selected',
    origin: 'https://prompt-refinery.example',
    allowPromotionCodes: true,
  });

  assert.equal(params.client_reference_id, 'uid-1');
  assert.deepEqual(params.line_items, [{ price: 'price_server_selected', quantity: 1 }]);
  assert.equal(params.allow_promotion_codes, true);
  assert.equal(params.success_url, 'https://prompt-refinery.example/?upgrade=success');
  assert.equal(params.cancel_url, 'https://prompt-refinery.example/?upgrade=cancelled');
  assert.equal(JSON.stringify(params).includes('price_client_spoof'), false);

  const withoutPromos = buildCheckoutSessionParams({
    uid: 'uid-1',
    priceId: 'price_server_selected',
    origin: 'https://prompt-refinery.example',
    allowPromotionCodes: false,
  });
  assert.equal(withoutPromos.allow_promotion_codes, undefined);
});

test('billing portal session params use stored server customer id only', () => {
  const params = buildBillingPortalSessionParams({
    stripeCustomerId: 'cus_server_stored',
    origin: 'https://prompt-refinery.example',
  });

  assert.deepEqual(params, {
    customer: 'cus_server_stored',
    return_url: 'https://prompt-refinery.example',
  });
  assert.equal(JSON.stringify(params).includes('cus_client_spoof'), false);
});

test('sensitive browser post origins are checked against APP_BASE_URL', () => {
  const environment = {
    NODE_ENV: 'production',
    APP_BASE_URL: 'https://prompt-refinery.example/app',
  };

  assert.equal(
    isAllowedBrowserPostOrigin('https://prompt-refinery.example', 'https://other.example/api/checkout_sessions', environment),
    true
  );
  assert.equal(
    isAllowedBrowserPostOrigin('https://evil.example', 'https://prompt-refinery.example/api/checkout_sessions', environment),
    false
  );
  assert.equal(
    isAllowedBrowserPostOrigin(null, 'https://prompt-refinery.example/api/checkout_sessions', environment),
    false
  );
  assert.equal(
    isAllowedBrowserPostOrigin(null, 'http://localhost:9002/api/checkout_sessions', { NODE_ENV: 'development' }),
    true
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
  assert.equal(getOptionalProductionWarnings(environment).some((warning) => warning.includes('Localized Stripe prices')), false);
});

test('production readiness requires Stripe secrets only when checkout is enabled', () => {
  const environment = Object.fromEntries(
    REQUIRED_PRODUCTION_VARIABLES.map((variable) => [variable, `configured-${variable}`])
  );
  for (const variable of FEATURE_FLAG_VARIABLES) {
    environment[variable] = 'false';
  }

  assert.deepEqual(getMissingProductionVariables(environment), []);
  assert.equal(getRuntimeReadiness(environment).ready, true);
  assert.equal(getRuntimeReadiness(environment).checks.stripeSubscriptions, true);

  environment.ENABLE_STRIPE_CHECKOUT = 'true';
  assert.deepEqual(getMissingProductionVariables(environment), [...STRIPE_PRODUCTION_VARIABLES]);
  assert.equal(getRuntimeReadiness(environment).ready, false);
  assert.equal(getRuntimeReadiness(environment).checks.stripeSubscriptions, false);
  assert.ok(getOptionalProductionWarnings(environment).some((warning) => warning.includes('Localized Stripe prices')));

  for (const variable of STRIPE_PRODUCTION_VARIABLES) {
    environment[variable] = `configured-${variable}`;
  }
  assert.deepEqual(getMissingProductionVariables(environment), []);
  assert.equal(getRuntimeReadiness(environment).ready, true);
  assert.equal(getRuntimeReadiness(environment).checks.stripeSubscriptions, true);
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

test('format converter supports text-like files without external MarkItDown', () => {
  assert.equal(safeConversionExtension('brief.PDF'), '.pdf');
  assert.equal(safeConversionExtension('archive.exe'), '');
  assert.equal(canConvertWithTextFallback('notes.md'), true);
  assert.equal(canConvertWithTextFallback('deck.pptx'), false);

  assert.deepEqual(
    convertTextLikeBufferToMarkdown('data.csv', Buffer.from('name,count\nAlpha,2\nBeta,3')),
    {
      content: '| name | count |\n| --- | --- |\n| Alpha | 2 |\n| Beta | 3 |',
      truncated: false,
    }
  );

  assert.deepEqual(
    convertTextLikeBufferToMarkdown('config.json', Buffer.from('{"enabled":true}')),
    {
      content: '```json\n{\n  "enabled": true\n}\n```',
      truncated: false,
    }
  );

  assert.deepEqual(
    convertTextLikeBufferToMarkdown('page.html', Buffer.from('<h1>Title</h1><p>Body &amp; details.</p>')),
    {
      content: 'Title\nBody & details.',
      truncated: false,
    }
  );
});

test('format converter parses MarkItDown command with arguments', () => {
  assert.deepEqual(parseMarkitdownCommand(undefined), {
    command: 'markitdown',
    args: [],
  });
  assert.deepEqual(parseMarkitdownCommand('python -m markitdown'), {
    command: 'python',
    args: ['-m', 'markitdown'],
  });
  assert.deepEqual(parseMarkitdownCommand('"C:\\Program Files\\Python\\python.exe" -m markitdown'), {
    command: 'C:\\Program Files\\Python\\python.exe',
    args: ['-m', 'markitdown'],
  });
});

test('format converter resolves the packaged App Hosting runtime beside the standalone server', () => {
  const workspace = join(process.cwd(), 'workspace');
  const candidates = packagedMarkitdownCommandCandidates({
    cwd: workspace,
    entrypoint: join(workspace, '.next', 'standalone', 'server.js'),
  });
  const packagedPython = candidates[0];

  assert.match(packagedPython, /\.next[\\/]standalone[\\/]\.markitdown-runtime/);
  assert.deepEqual(
    resolveMarkitdownCommand('packaged', {
      cwd: workspace,
      entrypoint: join(workspace, '.next', 'standalone', 'server.js'),
      exists: (candidate) => candidate === packagedPython,
    }),
    {
      command: packagedPython,
      args: ['-m', 'markitdown'],
    }
  );
});

test('format converter reports a missing packaged runtime as an availability failure', () => {
  assert.throws(
    () => resolveMarkitdownCommand('packaged', { exists: () => false }),
    MarkitdownRuntimeUnavailableError
  );
});

test('App Hosting build packages and enables the pinned MarkItDown runtime', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
  };
  const appHosting = readFileSync('apphosting.yaml', 'utf8');
  const nextConfig = readFileSync('next.config.ts', 'utf8');
  const requirements = readFileSync('requirements-markitdown.txt', 'utf8');

  assert.match(packageJson.scripts.build, /install:markitdown/);
  assert.ok(
    packageJson.scripts.build.indexOf('next build') <
      packageJson.scripts.build.indexOf('install:markitdown'),
    'MarkItDown must be installed after Next creates the standalone server bundle'
  );
  assert.equal(packageJson.scripts['install:markitdown'], 'node scripts/install-markitdown-runtime.mjs');
  assert.match(nextConfig, /output:\s*'standalone'/);
  assert.match(appHosting, /ENABLE_FILE_CONVERSION\s*\n\s*value: "true"/);
  assert.match(appHosting, /MARKITDOWN_COMMAND\s*\n\s*value: packaged/);
  assert.equal(requirements.trim(), 'markitdown[pdf,docx,pptx,xlsx,xls]==0.1.7');
});

test('legacy user documents default to safe role, tier, source, and status', () => {
  const legacy = normalizeUserProfile('legacy-uid', {
    email: 'Legacy@Example.com',
  });

  assert.equal(legacy.role, 'user');
  assert.equal(legacy.subscriptionTier, 'free');
  assert.equal(legacy.subscriptionSource, null);
  assert.equal(legacy.accountStatus, 'active');
  assert.equal(legacy.email, 'legacy@example.com');
  assert.equal(legacy.savedPromptCount, 0);
});

test('bootstrap role boundaries preserve support below admin and owner above admin', () => {
  const previousOwnerEmails = process.env.OWNER_EMAILS;
  const previousAdminEmails = process.env.ADMIN_EMAILS;
  const previousSupportEmails = process.env.SUPPORT_EMAILS;
  const previousOwnerUids = process.env.OWNER_UIDS;

  process.env.OWNER_EMAILS = 'owner@example.com';
  process.env.OWNER_UIDS = 'owner-uid';
  process.env.ADMIN_EMAILS = 'admin@example.com';
  process.env.SUPPORT_EMAILS = 'support@example.com';

  assert.equal(getBootstrapRole({ uid: 'user-uid', email: 'user@example.com' } as never), 'user');
  assert.equal(getBootstrapRole({ uid: 'support-uid', email: 'support@example.com' } as never), 'support');
  assert.equal(getBootstrapRole({ uid: 'admin-uid', email: 'admin@example.com' } as never), 'admin');
  assert.equal(getBootstrapRole({ uid: 'owner-uid', email: 'admin@example.com' } as never), 'owner');
  assert.equal(getBootstrapRole({ uid: 'stored-owner', email: 'user@example.com' } as never, 'owner'), 'owner');

  process.env.OWNER_EMAILS = previousOwnerEmails;
  process.env.OWNER_UIDS = previousOwnerUids;
  process.env.ADMIN_EMAILS = previousAdminEmails;
  process.env.SUPPORT_EMAILS = previousSupportEmails;
});

test('account status blocks provider, checkout, save, and pro server work', () => {
  assert.doesNotThrow(() => assertActiveAccount({ accountStatus: 'active' }, 'call provider APIs'));
  assert.throws(() => assertActiveAccount({ accountStatus: 'suspended' }, 'call provider APIs'), /suspended/);
  assert.throws(() => assertActiveAccount({ accountStatus: 'disabled' }, 'create checkout sessions'), /disabled/);
  assert.throws(() => assertActiveAccount({ accountStatus: 'suspended' }, 'use Pro project memory APIs'), /project memory/);
  assert.throws(() => assertActiveAccount({ accountStatus: 'disabled' }, 'call refinement provider APIs'), /refinement provider/);
  assert.throws(() => assertActiveAccount({ accountStatus: 'deleted_pending' }, 'save prompts'), /deleted_pending/);
});

test('explicit checkout account-status helper blocks non-active accounts', () => {
  assert.doesNotThrow(() => assertCanCreateCheckoutForProfile({ accountStatus: 'active' }));
  assert.throws(() => assertCanCreateCheckoutForProfile({ accountStatus: 'disabled' }), /create checkout sessions/);
  assert.throws(() => assertCanCreateCheckoutForProfile({ accountStatus: 'suspended' }), /create checkout sessions/);
  assert.throws(() => assertCanCreateCheckoutForProfile({ accountStatus: 'deleted_pending' }), /create checkout sessions/);
});

test('firebase auth errors map revoked and disabled users to safe app errors', () => {
  const revoked = mapFirebaseAuthError({ code: 'auth/id-token-revoked' });
  assert.equal(revoked.name, 'AuthenticationRequiredError');
  assert.equal(revoked.status, 401);
  assert.match(revoked.message, /revoked/i);

  const disabled = mapFirebaseAuthError({ code: 'auth/user-disabled' });
  assert.equal(disabled.name, 'AccountStatusBlockedError');
  assert.equal(disabled.status, 403);
  assert.match(disabled.message, /disabled/i);

  const generic = mapFirebaseAuthError(new Error('raw firebase stack should not leak'));
  assert.equal(generic.name, 'AuthenticationRequiredError');
  assert.equal(generic.status, 401);
  assert.doesNotMatch(generic.message, /raw firebase stack/i);
});

test('admin role boundaries keep support below admin and admin below owner-only actions', () => {
  assert.equal(canAccessRole('user', 'support'), false);
  assert.equal(canAccessRole('support', 'support'), true);
  assert.equal(canAccessRole('support', 'admin'), false);
  assert.equal(canAccessRole('admin', 'admin'), true);
  assert.equal(canAccessRole('admin', 'owner'), false);
  assert.equal(canAccessRole('owner', 'owner'), true);
});

test('admin pagination clamps page sizes and admin throttles are stricter for mutations', () => {
  assert.equal(ADMIN_MAX_PAGE_SIZE, 25);
  assert.equal(clampAdminPageSize(undefined), 10);
  assert.equal(clampAdminPageSize(0), 10);
  assert.equal(clampAdminPageSize(3.9), 3);
  assert.equal(clampAdminPageSize(500), 25);

  const grantLimit = getAdminRateLimitForTests('admin.pro_grant');
  const searchLimit = getAdminRateLimitForTests('admin.user_search');
  const healthLimit = getAdminRateLimitForTests('admin.system_health_read');
  assert.ok(grantLimit.limit <= searchLimit.limit);
  assert.ok(searchLimit.limit <= healthLimit.limit);
  assert.ok(grantLimit.windowMs > searchLimit.windowMs);
});

test('admin audit metadata redacts sensitive fields and hashes request metadata', () => {
  const redacted = redactAdminAuditMetadata({
    prompt: 'raw prompt',
    uploadedContent: 'document text',
    projectMemory: 'private memory',
    apiKey: 'secret-key',
    bearerToken: 'bearer-token',
    cookie: 'session-cookie',
    authorization: 'Bearer abc',
    providerResponse: 'raw response',
    responseBody: 'model body',
    harmless: 'visible metadata',
    nested: { secret: 'value' },
  });

  for (const field of [
    'prompt',
    'uploadedContent',
    'projectMemory',
    'apiKey',
    'bearerToken',
    'cookie',
    'authorization',
    'providerResponse',
    'responseBody',
  ]) {
    assert.equal(redacted[field], '[redacted]');
  }
  assert.equal(redacted.harmless, 'visible metadata');
  assert.equal(redacted.nested, '[metadata]');

  const hashed = hashRequestValue('203.0.113.10');
  assert.equal(typeof hashed, 'string');
  assert.equal(hashed?.length, 24);
  assert.notEqual(hashed, '203.0.113.10');
});

test('admin wrapper failure audit metadata is privacy-safe for unexpected errors', () => {
  const metadata = getAdminFailureAuditMetadata(new Error('raw secret body'), 'unexpected');
  assert.deepEqual(metadata, {
    failureKind: 'unexpected',
    errorName: 'Error',
  });
  assert.doesNotMatch(JSON.stringify(metadata), /raw secret body/);
});

test('mock auth cannot unlock production behavior', () => {
  assert.equal(isMockAuthAllowed({ NODE_ENV: 'production', ENABLE_MOCK_AUTH: 'true' } as NodeJS.ProcessEnv), false);
  assert.equal(isMockAuthAllowed({ NODE_ENV: 'production', ENABLE_MOCK_AUTH: 'false' } as NodeJS.ProcessEnv), false);
  assert.equal(isMockAuthAllowed({ NODE_ENV: 'development', ENABLE_MOCK_AUTH: 'true' } as NodeJS.ProcessEnv), true);
  assert.equal(isMockAuthAllowed({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), false);
});

test('entitlement precedence keeps manual grants separate from Stripe state', () => {
  const now = new Date('2026-06-05T00:00:00.000Z');
  const freeProfile = {
    role: 'user' as const,
    subscriptionTier: 'free' as const,
    subscriptionSource: null,
    subscriptionStatus: null,
  };

  assert.deepEqual(evaluateEntitlement('free-user', freeProfile, null, now), {
    uid: 'free-user',
    tier: 'free',
    isPro: false,
    source: null,
    reason: null,
    expiresAt: null,
  });

  assert.equal(evaluateEntitlement('stripe-user', {
    ...freeProfile,
    subscriptionTier: 'pro',
    subscriptionSource: 'stripe',
    subscriptionStatus: 'active',
  }, null, now).source, 'stripe');

  const manualGrant = {
    tier: 'pro',
    source: 'manual',
    reason: 'Launch grant',
    expiresAt: new Date('2026-07-01T00:00:00.000Z'),
  };
  const manualEntitlement = evaluateEntitlement('manual-user', freeProfile, manualGrant, now);
  assert.equal(manualEntitlement.isPro, true);
  assert.equal(manualEntitlement.source, 'manual');

  assert.equal(evaluateEntitlement('expired-user', freeProfile, {
    ...manualGrant,
    expiresAt: new Date('2026-01-01T00:00:00.000Z'),
  }, now).isPro, false);

  assert.equal(evaluateEntitlement('revoked-user', freeProfile, {
    ...manualGrant,
    revokedAt: new Date('2026-06-01T00:00:00.000Z'),
  }, now).isPro, false);

  assert.equal(evaluateEntitlement('survivor-user', {
    ...freeProfile,
    subscriptionTier: 'free',
    subscriptionSource: 'stripe',
    subscriptionStatus: 'canceled',
  }, manualGrant, now).source, 'manual');

  assert.equal(evaluateEntitlement('owner-user', {
    ...freeProfile,
    role: 'owner',
  }, null, now).source, 'owner');
});

test('stripe subscription patches grant and remove only stripe-sourced pro fields', () => {
  const activePatch = buildStripeSubscriptionPatch({
    id: 'sub_active',
    status: 'active',
    customer: 'cus_123',
  });
  assert.deepEqual(activePatch, {
    subscriptionTier: 'pro',
    subscriptionSource: 'stripe',
    subscriptionStatus: 'active',
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_active',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(activePatch ?? {}, 'role'), false);

  const trialingPatch = buildStripeSubscriptionPatch({
    id: 'sub_trial',
    status: 'trialing',
    customer: 'cus_123',
  });
  assert.equal(trialingPatch?.subscriptionTier, 'pro');
  assert.equal(isStripeSubscriptionActive('trialing'), true);

  const canceledPatch = buildStripeSubscriptionPatch({
    id: 'sub_cancel',
    status: 'canceled',
    customer: 'cus_123',
  });
  assert.deepEqual(canceledPatch, {
    subscriptionTier: 'free',
    subscriptionSource: null,
    subscriptionStatus: 'canceled',
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_cancel',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(canceledPatch ?? {}, 'role'), false);

  const unpaidPatch = buildStripeSubscriptionPatch({
    id: 'sub_unpaid',
    status: 'unpaid',
    customer: 'cus_123',
  });
  assert.equal(unpaidPatch?.subscriptionTier, 'free');
});

test('manual grants survive stripe cancellation through entitlement precedence', () => {
  const entitlement = evaluateEntitlement('manual-user', {
    role: 'user',
    subscriptionTier: 'free',
    subscriptionSource: null,
    subscriptionStatus: 'canceled',
  }, {
    tier: 'pro',
    source: 'manual',
    reason: 'Manual support grant',
  });

  assert.equal(entitlement.isPro, true);
  assert.equal(entitlement.source, 'manual');
});

test('stripe webhook event records are redacted, idempotency-safe, and complete', () => {
  const record = buildStripeWebhookEventRecord({
    eventId: 'evt_123',
    type: 'customer.subscription.updated',
    processingStatus: 'processed',
    relatedUid: 'uid_123',
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
  });

  assert.equal(record.eventId, 'evt_123');
  assert.equal(record.processingStatus, 'processed');
  assert.equal(record.relatedUid, 'uid_123');
  assert.equal(record.stripeCustomerId, 'cus_123');
  assert.equal(record.stripeSubscriptionId, 'sub_123');
  assert.equal(record.errorCode, null);
  assert.equal(Object.prototype.hasOwnProperty.call(record, 'rawBody'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(record, 'stripeSecret'), false);

  const failed = buildStripeWebhookEventRecord({
    eventId: 'evt_failed',
    type: 'checkout.session.completed',
    processingStatus: 'failed',
    errorCode: 'user_lookup_failed',
  });
  assert.equal(failed.processingStatus, 'failed');
  assert.equal(failed.errorCode, 'user_lookup_failed');
});

test('firestore rules deny browser access to privileged production collections and server-managed fields', () => {
  const rules = readFileSync('firestore.rules', 'utf8');
  const createProfileRule = rules.slice(
    rules.indexOf('function hasValidUserDataOnCreate'),
    rules.indexOf('function isUpdatingImmutableUserData')
  );
  for (const collectionName of [
    'adminEntitlements',
    'adminAuditLogs',
    'stripeWebhookEvents',
    'usageEvents',
    'dailyUsageAggregates',
    'supportAccessRequests',
    'resourceShares',
    'promoCodes',
    'promoRedemptions',
    'promoRateLimits',
    'apiKeys',
  ]) {
    assert.ok(rules.includes(`match /${collectionName}/{document=**}`));
  }

  for (const fieldName of [
    'role',
    'accountStatus',
    'subscriptionSource',
    'subscriptionTier',
    'subscriptionStatus',
    'stripeCustomerId',
    'stripeSubscriptionId',
    'savedPromptCount',
    'managedRefinementsDate',
    'managedRefinementsUsedToday',
    'adminEntitlements',
    'entitlements',
    'quota',
    'quotas',
    'usage',
    'audit',
    'admin',
    'adminRole',
    'billingRole',
  ]) {
    assert.match(rules, new RegExp(`'${fieldName}'`));
  }

  for (const creationBlockedField of [
    'savedPromptCount',
    'managedRefinementsDate',
    'managedRefinementsUsedToday',
    'usage',
    'quota',
    'audit',
    'admin',
  ]) {
    assert.match(createProfileRule, new RegExp(`'${creationBlockedField}'`));
  }
});

test('Stage 2 conversion metadata is deterministic and detects low-text PDFs', () => {
  assert.deepEqual(estimateTokenCounts('one two three four'), { gemini: 5, openai: 5, deepseek: 5, qwen: 6 });
  assert.deepEqual(analyzeMarkdownStructure('# Title\n\n- one\n- two\n\n| A | B |\n| - | - |\n| 1 | 2 |'), {
    headings: 1,
    tables: 1,
    listItems: 2,
  });
  assert.ok(buildConversionWarnings('scan.pdf', '', 4000).some((warning) => warning.toLowerCase().includes('scanned')));
  assert.deepEqual(normalizedSearchTerms('Alpha alpha beta'), ['alpha', 'beta']);
});

test('promo grants provide Pro while active Stripe remains authoritative', () => {
  const promo = evaluateEntitlement('promo-user', {
    role: 'user', subscriptionTier: 'pro', subscriptionSource: 'promo', subscriptionStatus: null,
  }, { tier: 'pro', source: 'promo', reason: 'Alpha code' });
  assert.equal(promo.isPro, true);
  assert.equal(promo.source, 'promo');

  const stripe = evaluateEntitlement('paid-user', {
    role: 'user', subscriptionTier: 'pro', subscriptionSource: 'stripe', subscriptionStatus: 'active',
  }, { tier: 'pro', source: 'promo', reason: 'Alpha code' });
  assert.equal(stripe.isPro, true);
  assert.equal(stripe.source, 'stripe');
});

test('Clarift brand metadata and customer surfaces use the supplied identity', () => {
  const layout = readFileSync('src/app/layout.tsx', 'utf8');
  const app = readFileSync('src/components/prompt-refinery/prompt-refinery-app.tsx', 'utf8');
  const logo = readFileSync('src/components/icons/logo.tsx', 'utf8');
  const checkout = readFileSync('src/app/api/checkout_sessions/route.ts', 'utf8');

  assert.match(layout, /default: 'Clarift'/);
  assert.match(layout, /openGraph:[\s\S]*title: 'Clarift'/);
  assert.match(app, /<h1 className="sr-only">Clarift<\/h1>/);
  assert.match(logo, /clarift-\$\{assetName\}-dark\.svg/);
  assert.match(logo, /clarift-\$\{assetName\}-light\.svg/);
  assert.match(checkout, /product: 'Clarift Pro'/);

  for (const customerSurface of [layout, app, checkout]) {
    assert.doesNotMatch(customerSurface, /The Prompt Refinery|Prompt Refinery Pro/);
  }
});

test('Google sign-in uses account selection and redirect fallback', () => {
  const loginHelper = readFileSync('src/firebase/non-blocking-login.tsx', 'utf8');
  const loginPage = readFileSync('src/components/auth/login-page.tsx', 'utf8');

  assert.match(loginHelper, /prompt:\s*'select_account'/);
  assert.match(loginHelper, /signInWithRedirect/);
  assert.equal((loginPage.match(/Continue with Google/g) ?? []).length, 2);
});

test('project refinements stay in the project workspace and support explicit project switching', () => {
  const app = readFileSync('src/components/prompt-refinery/prompt-refinery-app.tsx', 'utf8');
  const projectsTab = readFileSync('src/components/prompt-refinery/projects-tab.tsx', 'utf8');
  const refineryTab = readFileSync('src/components/prompt-refinery/refinery-tab.tsx', 'utf8');

  assert.match(refineryTab, /<SelectItem value=\{NO_PROJECT_VALUE\}>No project<\/SelectItem>/);
  assert.match(refineryTab, /const savedSession = await addProjectSessionAction/);
  assert.match(refineryTab, /onProjectRefinementSaved\?\.\(savedSession\.id\)/);
  assert.match(projectsTab, /<SelectItem value=\{ALL_PROJECTS_VALUE\}>All projects<\/SelectItem>/);
  assert.match(projectsTab, />\s*Leave Project\s*</);
  assert.match(projectsTab, /selectedProject && workspaceView === 'chat' && isComposing && \(/);
  assert.match(projectsTab, /<RefineryTab[\s\S]*projectWorkspace/);
  assert.doesNotMatch(projectsTab, /onStartRefinement/);
  assert.match(app, /setRequestedProjectSessionId\(sessionId\);\s*setActiveTab\('projects'\)/);
});

test('production responses define strict security headers without blocking Firebase services', () => {
  const nextConfig = readFileSync('next.config.ts', 'utf8');

  for (const headerName of [
    'Content-Security-Policy',
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Referrer-Policy',
    'Permissions-Policy',
  ]) {
    assert.match(nextConfig, new RegExp(`key: '${headerName}'`));
  }

  for (const directive of [
    "default-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    'https://*.googleapis.com',
    'https://*.firebaseio.com',
    'wss://*.firebaseio.com',
    'https://*.firebaseapp.com',
  ]) {
    assert.ok(nextConfig.includes(directive));
  }

  assert.match(nextConfig, /source: '\/:path\*'/);
  assert.doesNotMatch(nextConfig, /script-src[^"]*'unsafe-eval'/);
});
