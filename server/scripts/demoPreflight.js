import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { createClient } from 'redis';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(SERVER_DIR, '..');
const REACTAPP_DIR = path.join(REPO_ROOT, 'reactapp');
const NIFTY_ID = 'market:index:nifty-50';
const EXACT_NIFTY_ETF_EVIDENCE = Object.freeze({
  identity: 'https://nsearchives.nseindia.com/trading_security/mf/pdf/Nippon_20032026171200_NipponMutualFund.pdf',
  listing: 'https://nsearchives.nseindia.com/content/circulars/CMPT74390.pdf',
  benchmark: 'https://mf.nipponindiaim.com/FundsAndPerformance/ProductNotes/NipponIndia-ETF-Nifty-50-BeES-Feb-2026.pdf',
  amfiNav: 'https://portal.amfiindia.com/spages/NAVAll.txt',
});
const PROVIDER_HOSTS = /(?:nseindia\.com|amfiindia\.com|sbi\.bank|sbi\.co\.in|indiapost\.gov\.in|dea\.gov\.in|rbi\.org\.in|incometax(?:india)?\.gov\.in|upstox\.com)/i;

export function hasCurrentFinancialBinding(value) {
  return Boolean(value)
    && /^[a-f\d]{24}$/i.test(String(value.profileId || ''))
    && Number.isSafeInteger(value.profile_version) && value.profile_version > 0
    && /^[a-f\d]{24}$/i.test(String(value.recommendationId || value.recommendation_id || ''))
    && Number.isSafeInteger(value.allocation_revision) && value.allocation_revision > 0
    && /^[a-f\d]{24}$/i.test(String(value.allocation_revision_id || ''))
    && /^[a-f\d]{64}$/i.test(String(value.portfolio_fingerprint || ''))
    && /^[a-f\d]{64}$/i.test(String(value.recommendation_fingerprint || ''))
    && value.response_state === 'CURRENT'
    && value.calculation_freshness?.fresh === true;
}

export function matchesRecommendationBinding(binding, recommendation) {
  return Boolean(binding && recommendation)
    && binding.profileId === recommendation.profileId
    && binding.profileVersion === recommendation.profile_version
    && binding.recommendationId === (recommendation.recommendationId || recommendation.recommendation_id)
    && binding.allocationRevision === recommendation.allocation_revision
    && binding.allocationRevisionId === recommendation.allocation_revision_id
    && binding.portfolioFingerprint === recommendation.portfolio_fingerprint
    && binding.recommendationFingerprint === recommendation.recommendation_fingerprint;
}

export function hasAuthenticatedDashboard({ pathname, sidebarVisible } = {}) {
  const normalizedPath = typeof pathname === 'string' ? pathname.replace(/\/+$/, '') || '/' : '';
  return normalizedPath === '/profile' && sidebarVisible === true;
}

export function qualifiesExactNiftyEtf(product) {
  const fact = product?.primaryFact;
  let benchmarkUrl = null;
  try {
    benchmarkUrl = new URL(product?.benchmark?.source?.url || '');
  } catch {
    benchmarkUrl = null;
  }
  const stableIds = new Map((Array.isArray(product?.externalIds) ? product.externalIds : [])
    .map(item => [item?.source, String(item?.value ?? '')]));
  const identityEvidenceUrls = new Set((Array.isArray(product?.identityEvidence) ? product.identityEvidence : [])
    .map(evidence => evidence?.url));
  const hasExactIdentityEvidence = identityEvidenceUrls.has(EXACT_NIFTY_ETF_EVIDENCE.identity)
    && identityEvidenceUrls.has(EXACT_NIFTY_ETF_EVIDENCE.listing);
  return Boolean(product)
    && product.productType === 'ETF'
    && product.canonicalProductId === 'etf:isin:INF204KB14I2'
    && product.isin === 'INF204KB14I2'
    && product.exchange === 'NSE'
    && product.ticker === 'NIFTYBEES'
    && stableIds.get('ISIN') === 'INF204KB14I2'
    && stableIds.get('AMFI_SCHEME_CODE') === '140084'
    && stableIds.get('NSE_TRADING_SYMBOL') === 'NIFTYBEES'
    && product.benchmark?.canonicalProductId === NIFTY_ID
    && product.benchmark?.id === 'NIFTY_50'
    && product.benchmark?.returnVariant === 'NIFTY 50 TRI'
    && benchmarkUrl?.protocol === 'https:'
    && benchmarkUrl.hostname === 'mf.nipponindiaim.com'
    && product.benchmark.source.url === EXACT_NIFTY_ETF_EVIDENCE.benchmark
    && hasExactIdentityEvidence
    && product.source?.provider === 'AMFI'
    && product.source?.url === EXACT_NIFTY_ETF_EVIDENCE.amfiNav
    && fact?.kind === 'MUTUAL_FUND_NAV'
    && fact?.canonicalProductId === 'mf:amfi:140084'
    && fact?.unit === 'NAV_PER_UNIT'
    && fact?.availabilityStatus === 'AVAILABLE'
    && typeof fact.value === 'number' && Number.isFinite(fact.value) && fact.value > 0
    && fact?.source?.provider === product.source.provider
    && fact?.source?.instrumentId === '140084'
    && fact?.source?.url === EXACT_NIFTY_ETF_EVIDENCE.amfiNav
    && fact?.freshness?.status === 'FRESH'
    && product.nav?.value === fact.value
    && product.nav?.observedAt === fact.observedAt
    && typeof fact?.observedAt === 'string' && Number.isFinite(Date.parse(fact.observedAt));
}

export function assessCurrentMarketContext(result) {
  const body = result?.body;
  const snapshot = body?.marketSnapshot;
  const facts = Array.isArray(snapshot?.observedFacts) ? snapshot.observedFacts : [];
  const selection = snapshot?.providerSelection || body?.liveProviderSelection || null;
  const selectedProvider = selection?.selectedProvider || null;
  const quote = key => facts.find(fact => fact.key === key) || null;
  const nifty = quote('nifty50Current');
  const vix = quote('indiaVixCurrent');
  const providerStatus = snapshot?.providerStatus || {};
  const coherentProviderPair = Boolean(selectedProvider)
    && providerStatus.quotes?.provider === selectedProvider
    && providerStatus.history?.provider === selectedProvider
    && nifty?.source?.provider === selectedProvider
    && vix?.source?.provider === selectedProvider;
  const isFreshQuote = fact => Boolean(fact)
    && fact.availabilityStatus === 'AVAILABLE'
    && typeof fact.value === 'number' && Number.isFinite(fact.value) && fact.value > 0
    && typeof fact.observedAt === 'string' && Number.isFinite(Date.parse(fact.observedAt))
    && fact.freshness?.status === 'FRESH'
    && fact.source?.provider === selectedProvider;
  const hasHistory = providerStatus.history?.provider === selectedProvider
    && Array.isArray(snapshot?.derivedFacts)
    && snapshot.derivedFacts.some(fact => fact.availabilityStatus === 'AVAILABLE'
      && typeof fact.value === 'number' && Number.isFinite(fact.value)
      && fact.freshness?.status === 'FRESH');
  const marketContextAvailable = result?.response?.ok === true
    && body?.status === 'MARKET_CONTEXT_AVAILABLE'
    && snapshot?.availability === 'AVAILABLE'
    && snapshot?.status === 'CURRENT'
    && coherentProviderPair
    && isFreshQuote(nifty) && isFreshQuote(vix)
    && hasHistory
    && typeof snapshot?.observedAt === 'string'
    && Number.isFinite(Date.parse(snapshot.observedAt))
    && facts.every(fact => fact.availabilityStatus !== 'AVAILABLE'
      || (fact.source?.provider === selectedProvider
        && fact.observedAt && fact.freshness?.status === 'FRESH'));
  return {
    selectedProvider,
    niftyAvailable: result?.response?.ok === true && isFreshQuote(nifty),
    vixAvailable: result?.response?.ok === true && isFreshQuote(vix),
    hasHistory,
    marketContextAvailable,
  };
}

function makeReporter() {
  const checks = [];
  return {
    checks,
    add(name, passed, detail) {
      checks.push({ name, passed: Boolean(passed), detail });
      process.stdout.write(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}\n`);
    },
    get failed() { return checks.some(check => !check.passed); },
  };
}

export function isRedisRequired(environment = process.env) {
  const explicit = value => ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
  return environment.NODE_ENV === 'production'
    || explicit(environment.REQUIRE_REDIS)
    || explicit(environment.DEMO_REQUIRE_REDIS);
}

async function readJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12_000) });
  let body = null;
  try { body = await response.json(); } catch { /* the caller records a safe status */ }
  return { response, body };
}

function safeHttpDetail(result) {
  if (!result) return 'request unavailable';
  if (!result.response.ok) return `HTTP ${result.response.status}${result.body?.code ? ` (${result.body.code})` : ''}`;
  return 'verified';
}

async function readConfiguredJson(filePath, label, reporter) {
  if (!filePath) {
    reporter.add(label, false, 'configure the required JSON file path');
    return null;
  }
  try {
    const parsed = JSON.parse(await readFile(path.resolve(filePath), 'utf8'));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new TypeError('Expected a JSON object.');
    return parsed;
  } catch {
    reporter.add(label, false, 'file must contain one valid JSON object; contents are never printed');
    return null;
  }
}

async function checkMongoTransaction(reporter) {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    reporter.add('Mongo transaction support', false, 'MONGODB_URI is not configured');
    return;
  }
  let session;
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 7000, connectTimeoutMS: 7000 });
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!hello.setName) throw new Error('MongoDB is not a replica set.');
    session = await mongoose.startSession();
    session.startTransaction();
    await mongoose.connection.db.collection('financialprofiles').findOne({}, { session });
    await session.commitTransaction();
    reporter.add('Mongo/transaction support', true, 'replica-set transaction probe committed read-only');
  } catch {
    if (session?.inTransaction()) await session.abortTransaction().catch(() => {});
    reporter.add('Mongo/transaction support', false, 'replica-set transaction probe failed; check MONGODB_URI and replica-set readiness');
  } finally {
    await session?.endSession().catch(() => {});
    await mongoose.disconnect().catch(() => {});
  }
}

async function checkRedis(reporter) {
  const required = isRedisRequired();
  if (!required) {
    reporter.add('Redis if required', true, 'Redis is not declared as a live-demo critical dependency');
    return;
  }
  const url = process.env.REDIS_URL;
  if (!url) {
    reporter.add('Redis if required', false, 'Redis is required but REDIS_URL is not configured');
    return;
  }
  const client = createClient({ url });
  client.on('error', () => {});
  try {
    await client.connect();
    const pong = await client.ping();
    reporter.add('Redis if required', pong === 'PONG', pong === 'PONG' ? 'PING verified' : 'Redis PING did not return PONG');
  } catch {
    reporter.add('Redis if required', false, 'Redis connection or PING failed');
  } finally {
    if (client.isOpen) await client.quit().catch(() => {});
  }
}

async function checkBrowserAndFinancialFlow(reporter, { apiBase, frontendUrl, completionPayload, taxContext }) {
  const email = process.env.DEMO_EMAIL;
  const password = process.env.DEMO_PASSWORD;
  const idempotencyKey = process.env.DEMO_COMPLETION_IDEMPOTENCY_KEY;
  const parentInstrumentId = process.env.DEMO_NIFTY_ETF_PARENT_ID;
  if (!frontendUrl || !email || !password) {
    reporter.add('Critical browser path', false, 'set DEMO_FRONTEND_URL, DEMO_EMAIL, and DEMO_PASSWORD');
    reporter.add('Profile completion/auth', false, 'set a dedicated demo identity and credentials');
    reporter.add('Nifty ETF exact-product result', false, 'live demo identity is not configured');
    reporter.add('Product tax workflow', false, 'live demo identity is not configured');
    return;
  }

  let browser;
  try {
    const frontend = new URL(frontendUrl);
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    if (!['http:', 'https:'].includes(frontend.protocol)
        || (frontend.protocol !== 'https:' && !localHosts.has(frontend.hostname))
        || frontend.username || frontend.password || frontend.search || frontend.hash) {
      throw new Error('DEMO_FRONTEND_URL must be a safe HTTPS URL (or local HTTP URL).');
    }
    const requireFromReactapp = createRequire(path.join(REACTAPP_DIR, 'package.json'));
    const { chromium } = requireFromReactapp('@playwright/test');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const providerRequests = [];
    page.on('request', request => {
      if (PROVIDER_HOSTS.test(request.url())) providerRequests.push(request.url());
    });

    const frontendResponse = await page.goto(new URL('/login', frontendUrl).toString(), { waitUntil: 'domcontentloaded' });
    const loginRendered = Boolean(frontendResponse?.ok()) && await page.locator('#login-form').count() === 1;
    if (!loginRendered) throw new Error('Frontend login page was not reachable.');
    await page.locator('#login-email').fill(email);
    await page.locator('#login-password').fill(password);
    const configuredApiOrigin = new URL(apiBase).origin;
    const loginResponsePromise = page.waitForResponse(response => {
      const responseUrl = new URL(response.url());
      return response.request().method() === 'POST'
        && responseUrl.origin === configuredApiOrigin
        && responseUrl.pathname.endsWith('/api/auth/login');
    }, { timeout: 20_000 });
    await page.locator('#login-form button[type="submit"]').click();
    const loginResponse = await loginResponsePromise;
    if (!loginResponse.ok()) throw new Error(`Login returned HTTP ${loginResponse.status()}.`);

    let profileId = null;
    if (!completionPayload || !idempotencyKey || idempotencyKey.length > 200) {
      reporter.add('Profile completion/auth', false, 'configure DEMO_PROFILE_COMPLETION_FILE and a stable DEMO_COMPLETION_IDEMPOTENCY_KEY');
    } else {
      const cookies = await context.cookies(apiBase);
      const csrf = cookies.find(cookie => cookie.name === 'wg_csrf')?.value;
      if (!csrf) throw new Error('The authenticated browser session has no CSRF cookie.');
      const completion = await page.request.post(`${apiBase}/profile/complete`, {
        data: completionPayload,
        headers: {
          'X-CSRF-Token': csrf,
          'Idempotency-Key': idempotencyKey,
          Origin: new URL(frontendUrl).origin,
        },
        timeout: 120_000,
      });
      const completionBody = completion.ok() ? await completion.json() : null;
      const completedProfileId = completionBody?.profile?.profileId;
      reporter.add('Profile completion/auth', completion.ok() && Boolean(completedProfileId), completion.ok()
        ? 'profile completion committed or safely replayed'
        : `HTTP ${completion.status()}${completionBody?.code ? ` (${completionBody.code})` : ''}`);
      if (completion.ok() && completedProfileId) profileId = completedProfileId;
    }

    if (!profileId) {
      const profileResult = await page.request.get(`${apiBase}/profile/current`);
      const profile = profileResult.ok() ? await profileResult.json() : null;
      profileId = profile?.profileId || null;
      if (!profileId) {
        reporter.add('Recommendation current-state binding', false,
          `authenticated current profile unavailable (HTTP ${profileResult.status()})`);
        reporter.add('ETF product source', false, 'current profile and recommendation state unavailable');
        reporter.add('Nifty ETF exact-product result', false, 'current profile and recommendation state unavailable');
        reporter.add('Product tax workflow', false, 'current profile and recommendation state unavailable');
        reporter.add('Critical browser path', false, 'authenticated profile could not be resolved');
        return;
      }
    }

    const finalProfileId = profileId;
    const recommendationResult = await page.request.get(`${apiBase}/recommend/current?profileId=${encodeURIComponent(finalProfileId)}`);
    const recommendation = recommendationResult.ok() ? await recommendationResult.json() : null;
    const bindingValid = recommendationResult.ok()
      && hasCurrentFinancialBinding(recommendation)
      && recommendation.profileId === finalProfileId;
    reporter.add('Recommendation current-state binding', bindingValid, bindingValid
      ? 'CURRENT response contains profile/recommendation/allocation fingerprints and fresh provenance'
      : `HTTP ${recommendationResult.status()} or incomplete/stale current-state binding`);

    if (!parentInstrumentId) {
      reporter.add('Nifty ETF exact-product result', false, 'set DEMO_NIFTY_ETF_PARENT_ID to the qualified current recommendation parent');
      reporter.add('Product tax workflow', false, 'no designated Nifty 50 ETF parent is configured');
    } else if (!bindingValid) {
      reporter.add('Nifty ETF exact-product result', false, 'current recommendation state is missing or stale');
      reporter.add('Product tax workflow', false, 'current recommendation state is missing or stale');
    } else {
      const csrf = (await context.cookies(apiBase)).find(cookie => cookie.name === 'wg_csrf')?.value;
      const rankResult = await page.request.post(`${apiBase}/instruments/rank-wti`, {
        data: {
          profileId: finalProfileId,
          profileVersion: recommendation.profile_version,
          recommendationId: recommendation.recommendationId,
          expectedAllocationRevision: recommendation.allocation_revision,
          expectedAllocationRevisionId: recommendation.allocation_revision_id,
          expectedPortfolioFingerprint: recommendation.portfolio_fingerprint,
          expectedRecommendationFingerprint: recommendation.recommendation_fingerprint,
          parentInstrumentId,
          ...(taxContext ? { taxCalculationContext: taxContext } : {}),
        },
        headers: {
          'X-CSRF-Token': csrf || '',
          'Idempotency-Key': randomUUID(),
          Origin: new URL(frontendUrl).origin,
        },
        timeout: 120_000,
      });
      const rankBody = rankResult.ok() ? await rankResult.json() : null;
      const etfProducts = Array.isArray(rankBody?.products) ? rankBody.products : [];
      const rankBindingValid = matchesRecommendationBinding(rankBody?.financialStateBinding, recommendation);
      const qualifiedProducts = rankBindingValid ? etfProducts.filter(qualifiesExactNiftyEtf) : [];
      reporter.add('ETF product source', qualifiedProducts.length > 0, qualifiedProducts.length
        ? 'exact identity, NIFTY 50 benchmark, official HTTPS source, fresh primary fact, and provenance verified'
        : `rank-wti returned HTTP ${rankResult.status()}, mismatched financial binding, or no product passed exact identity/source/freshness checks`);
      reporter.add('Nifty ETF exact-product result', qualifiedProducts.length > 0, qualifiedProducts.length
        ? `${qualifiedProducts.length} exact qualified product(s)`
        : 'no exact source-qualified Nifty 50 ETF result');
      const validTaxResult = Boolean(taxContext) && qualifiedProducts.some(product => (
        product.postTaxAnalysis?.status === 'CALCULATED'
        && product.postTaxAnalysis?.fiscalYear === taxContext.fiscalYear
      ));
      reporter.add('Product tax workflow', validTaxResult, validTaxResult
        ? 'exact-product tax calculation is bound to the supplied fiscal year'
        : 'provide real required tax facts and verify CALCULATED exact-product output; no tax values are inferred');
    }

    await page.goto(new URL('/profile', frontendUrl).toString(), { waitUntil: 'domcontentloaded' });
    const dashboard = page.locator('aside.sidebar');
    await dashboard.waitFor({ state: 'visible', timeout: 45_000 });
    const dashboardVisible = hasAuthenticatedDashboard({
      pathname: new URL(page.url()).pathname,
      sidebarVisible: await dashboard.isVisible(),
    });
    reporter.add('Critical browser path', dashboardVisible && providerRequests.length === 0, providerRequests.length
      ? 'browser attempted a direct provider request; frontend must use backend APIs only'
      : dashboardVisible ? 'authenticated profile/dashboard shell rendered without direct provider calls' : 'authenticated dashboard shell is unavailable');
  } catch (error) {
    const message = /HTTP \d{3}/.test(error?.message || '') ? error.message : 'browser/authenticated critical path failed; verify URLs, credentials, and browser installation';
    reporter.add('Critical browser path', false, message);
  } finally {
    await browser?.close().catch(() => {});
  }
}

export async function runDemoPreflight() {
  const reporter = makeReporter();
  if (process.env.DEMO_LIVE_PREFLIGHT !== '1') {
    reporter.add('Explicit live-demo mode', false, 'set DEMO_LIVE_PREFLIGHT=1 to run external live checks intentionally');
    process.stdout.write('\nLive-demo preflight: 0 PASS, 1 FAIL.\n');
    return { exitCode: 1, checks: reporter.checks };
  }

  const configuredApiBase = (process.env.DEMO_API_BASE_URL || 'http://127.0.0.1:5000/api').replace(/\/$/, '');
  let apiBase = configuredApiBase;
  let backendOrigin;
  try {
    const apiUrl = new URL(apiBase);
    if (!['http:', 'https:'].includes(apiUrl.protocol)) throw new TypeError('Unsupported API URL protocol.');
    if (!apiUrl.pathname.replace(/\/+$/, '').endsWith('/api') || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
      throw new TypeError('API URL must end in /api and contain no credentials, query, or fragment.');
    }
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    if (apiUrl.protocol !== 'https:' && !localHosts.has(apiUrl.hostname)) {
      throw new TypeError('Remote API URLs must use HTTPS.');
    }
    apiBase = `${apiUrl.origin}${apiUrl.pathname.replace(/\/+$/, '')}`;
    backendOrigin = apiUrl.origin;
  } catch {
    reporter.add('Backend URL configuration', false, 'DEMO_API_BASE_URL must be a valid safe HTTP(S) URL ending in /api');
    const passed = reporter.checks.filter(check => check.passed).length;
    const failed = reporter.checks.length - passed;
    process.stdout.write(`\nLive-demo preflight: ${passed} PASS, ${failed} FAIL.\n`);
    return { exitCode: 1, checks: reporter.checks };
  }
  const frontendUrl = process.env.DEMO_FRONTEND_URL;
  const completionPayload = await readConfiguredJson(process.env.DEMO_PROFILE_COMPLETION_FILE, 'Profile completion payload', reporter);
  const taxContext = await readConfiguredJson(process.env.DEMO_TAX_CONTEXT_FILE, 'Tax input payload', reporter);

  const health = await readJson(`${backendOrigin}/health/live`).catch(() => null);
  reporter.add('Backend', Boolean(health?.response.ok && health.body?.status === 'ALIVE'), safeHttpDetail(health));
  const readiness = await readJson(`${backendOrigin}/health/ready`).catch(() => null);
  reporter.add('Backend readiness', Boolean(readiness?.response.ok && readiness.body?.status === 'READY'), safeHttpDetail(readiness));

  await checkMongoTransaction(reporter);
  await checkRedis(reporter);

  const deep = await readJson(`${backendOrigin}/health/deep`).catch(() => null);
  const services = deep?.body?.services || {};
  const redisRequired = isRedisRequired();
  reporter.add('Market provider configuration', Boolean(services.database === 'UP')
    && (!redisRequired || services.redis === 'UP'), 'backend dependency health is evaluated without exposing configuration values');

  const contextResult = await readJson(`${apiBase}/regime/current`).catch(() => null);
  const marketAssessment = assessCurrentMarketContext(contextResult);
  const selectedProvider = marketAssessment.selectedProvider;
  reporter.add('NIFTY quote', marketAssessment.niftyAvailable, safeHttpDetail(contextResult));
  reporter.add('VIX quote', marketAssessment.vixAvailable, safeHttpDetail(contextResult));
  reporter.add('Market history', marketAssessment.hasHistory, marketAssessment.hasHistory ? 'source-qualified history produced at least one derived fact' : 'verified history is missing');
  reporter.add('Market context', marketAssessment.marketContextAvailable, marketAssessment.marketContextAvailable
    ? 'current context has fresh NIFTY/VIX facts and observed timestamps'
    : 'current complete market context is unavailable or stale; a last-known-good snapshot is not counted as live');

  const marketProvider = selectedProvider;
  const upstoxTokenPresent = Boolean(process.env.UPSTOX_ANALYTICS_TOKEN || process.env.UPSTOX_ACCESS_TOKEN);
  const tokenCheck = marketProvider === 'UPSTOX' ? upstoxTokenPresent : marketProvider === 'NSE';
  reporter.add('Provider token presence', tokenCheck, marketProvider === 'UPSTOX'
    ? (upstoxTokenPresent ? 'required Upstox token is present (value hidden)' : 'Upstox selected but token is absent')
    : marketProvider === 'NSE' ? 'NSE source does not require a provider token' : 'no qualified market provider selected');

  const policies = await readJson(`${apiBase}/tax/policies`).catch(() => null);
  const taxVerified = policies?.response.ok && policies.body?.currentFiscalYearVerified === true
    && typeof policies.body?.currentFiscalYear === 'string';
  reporter.add('Tax-policy metadata', taxVerified, taxVerified
    ? `current policy ${policies.body.currentFiscalYear} is server-verified`
    : 'current fiscal-year policy metadata is missing or unverified');

  const browserConfigPresent = Boolean(frontendUrl && process.env.DEMO_EMAIL && process.env.DEMO_PASSWORD);
  if (!browserConfigPresent) {
    reporter.add('Critical browser path', false, 'set DEMO_FRONTEND_URL, DEMO_EMAIL, and DEMO_PASSWORD');
    reporter.add('Profile completion/auth', false, 'set a dedicated demo identity and credentials');
    reporter.add('Recommendation current-state binding', false, 'authenticated profile completion was not run');
    reporter.add('ETF product source', false, 'authenticated rank-wti flow was not run');
    reporter.add('Nifty ETF exact-product result', false, 'authenticated rank-wti flow was not run');
    reporter.add('Product tax workflow', false, 'authenticated rank-wti flow was not run');
  } else {
    await checkBrowserAndFinancialFlow(reporter, { apiBase, frontendUrl, completionPayload, taxContext });
  }

  const build = spawnSync(process.execPath, [path.join(REACTAPP_DIR, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
    cwd: REACTAPP_DIR,
    encoding: 'utf8',
    timeout: 180_000,
    windowsHide: true,
  });
  reporter.add('Production frontend build', build.status === 0, build.status === 0
    ? 'Vite production build succeeded'
    : 'production build failed or frontend dependencies are unavailable');

  const passed = reporter.checks.filter(check => check.passed).length;
  const failed = reporter.checks.length - passed;
  process.stdout.write(`\nLive-demo preflight: ${passed} PASS, ${failed} FAIL.\n`);
  if (failed) process.stdout.write('FINAL LIVE DEMO ENVIRONMENT NOT READY. Resolve the failed checks above; this is separate from deterministic product-integrity certification.\n');
  return { exitCode: failed ? 1 : 0, checks: reporter.checks };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runDemoPreflight();
  process.exitCode = result.exitCode;
}
