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
const FINANCIAL_PROVIDER_HOSTS = Object.freeze([
  'nseindia.com',
  'amfiindia.com',
  'sbi.bank',
  'sbi.co.in',
  'indiapost.gov.in',
  'dea.gov.in',
  'rbi.org.in',
  'incometax.gov.in',
  'incometaxindia.gov.in',
  'upstox.com',
]);

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
    && product.parentInstrumentId === 'nifty_etf'
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

export const EXPECTED_PREFLIGHT_CHECKS = Object.freeze([
  'Explicit live-demo mode',
  'Backend URL configuration',
  'Profile completion payload',
  'Tax input payload',
  'Backend',
  'Backend readiness',
  'Mongo/transaction support',
  'Redis if required',
  'Market provider configuration',
  'NIFTY quote',
  'VIX quote',
  'Market history',
  'Market context',
  'Provider token presence',
  'Tax-policy metadata',
  'Profile completion/auth',
  'Recommendation current-state binding',
  'ETF product source',
  'Nifty ETF exact-product result',
  'Product tax workflow',
  'Critical browser path',
  'Production frontend build',
]);

export function makeReporter(write = line => process.stdout.write(`${line}\n`)) {
  const checks = EXPECTED_PREFLIGHT_CHECKS.map(name => ({
    name,
    passed: false,
    state: 'NOT_EVALUATED',
    detail: 'NOT_EVALUATED because this check has not run',
  }));
  const evaluated = new Set();
  let finalized = false;
  return {
    get checks() { return checks.map(check => ({ ...check })); },
    add(name, passed, detail) {
      if (finalized) throw new Error('Cannot add preflight checks after finalization.');
      const check = checks.find(candidate => candidate.name === name);
      if (!check) throw new Error(`Unexpected preflight check: ${name}`);
      if (evaluated.has(name)) throw new Error(`Preflight check already evaluated: ${name}`);
      if (typeof passed !== 'boolean') throw new TypeError(`Preflight check outcome must be boolean: ${name}`);
      check.passed = passed;
      check.state = passed ? 'PASS' : 'FAIL';
      check.detail = String(detail || (passed ? 'verified' : 'failed'));
      evaluated.add(name);
    },
    finish() {
      if (!finalized) {
        finalized = true;
        for (const check of checks) {
          if (!evaluated.has(check.name)) {
            check.passed = false;
            check.state = 'NOT_EVALUATED';
            check.detail = 'NOT_EVALUATED because a prerequisite failed or the check was not reached';
          }
        }
        let writeFailure = null;
        for (const check of checks) {
          try { write(`${check.passed ? 'PASS' : 'FAIL'} ${check.name} — ${check.detail}`); } catch (error) { writeFailure ||= error; }
        }
        if (writeFailure) throw writeFailure;
      }
      const passed = checks.filter(check => check.passed).length;
      return {
        checks: checks.map(check => ({ ...check })),
        passed,
        failed: checks.length - passed,
        total: checks.length,
      };
    },
    get failed() { return checks.some(check => !check.passed); },
  };
}

function safeStableCode(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : null;
}

function safeFailureKind(error) {
  const code = safeStableCode(error?.code) || safeStableCode(error?.cause?.code);
  const timeout = error?.name === 'TimeoutError'
    || error?.name === 'AbortError'
    || ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'ABORT_ERR'].includes(code);
  return { kind: timeout ? 'timeout' : 'network/stage error', code };
}

function elapsedMilliseconds(startedAt) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function emitSafeTiming(onTiming, event) {
  if (typeof onTiming !== 'function') return;
  try { onTiming(event); } catch { /* diagnostic hooks must not change request behavior */ }
}

function responseStatus(response) {
  return Number(typeof response?.status === 'function' ? response.status() : response?.status) || 0;
}

function responseOk(response) {
  return typeof response?.ok === 'function' ? response.ok() : response?.ok === true;
}

function isFinancialProviderRequestUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return FINANCIAL_PROVIDER_HOSTS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return null;
  }
}

async function readSafeResponseBody(response) {
  try {
    const body = await response.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

function reportWtiNotEvaluated(reporter, reason) {
  reporter.add('Nifty ETF exact-product result', false, `NOT_EVALUATED because ${reason}`);
  reporter.add('Product tax workflow', false, `NOT_EVALUATED because ${reason}`);
}

export async function reportWtiProductChecks(reporter, {
  requestWti,
  recommendation,
  parentInstrumentId,
  taxContext,
  onTiming,
} = {}) {
  if (parentInstrumentId !== 'nifty_etf') {
    reporter.add('ETF product source', false, 'NOT_EVALUATED because the exact qualified Nifty ETF parent is not configured');
    reportWtiNotEvaluated(reporter, 'the exact qualified Nifty ETF parent is not configured');
    return;
  }

  const startedAt = performance.now();
  let timingStatus = 'NOT_STARTED';
  let timingCode = null;
  try {
    const response = await requestWti();
    const status = responseStatus(response);
    timingStatus = `HTTP_${status || 'UNKNOWN'}`;
    const body = await readSafeResponseBody(response);
    if (!responseOk(response)) {
      timingCode = safeStableCode(body?.code);
      const detail = `WTI HTTP ${status || 'unknown'}${timingCode ? ` (${timingCode})` : ''}; ${elapsedMilliseconds(startedAt)}ms`;
      reporter.add('ETF product source', false, detail);
      reportWtiNotEvaluated(reporter, `WTI returned HTTP ${status || 'unknown'}`);
      return;
    }
    if (!body) {
      timingStatus = 'MALFORMED_JSON';
      timingCode = 'MALFORMED_JSON';
      reporter.add('ETF product source', false, `WTI response contained malformed JSON; ${elapsedMilliseconds(startedAt)}ms`);
      reportWtiNotEvaluated(reporter, 'WTI response could not be parsed');
      return;
    }

    const products = Array.isArray(body.products) ? body.products : [];
    const bindingValid = matchesRecommendationBinding(body.financialStateBinding, recommendation);
    const qualifiedProducts = bindingValid ? products.filter(qualifiesExactNiftyEtf) : [];
    const uniqueQualifiedProduct = qualifiedProducts.length === 1 ? qualifiedProducts[0] : null;
    const wtiElapsedMs = elapsedMilliseconds(startedAt);
    reporter.add('ETF product source', Boolean(uniqueQualifiedProduct), uniqueQualifiedProduct
      ? `exact identity, NIFTY 50 benchmark, official HTTPS source, fresh primary fact, and provenance verified; ${wtiElapsedMs}ms`
      : qualifiedProducts.length > 1
        ? `ambiguous duplicate exact-product results (${qualifiedProducts.length}); ${wtiElapsedMs}ms`
        : `WTI HTTP ${status || 200}, mismatched financial binding, or no product passed exact identity/source/freshness checks; ${wtiElapsedMs}ms`);
    reporter.add('Nifty ETF exact-product result', Boolean(uniqueQualifiedProduct), uniqueQualifiedProduct
      ? 'one exact qualified product'
      : qualifiedProducts.length > 1 ? 'ambiguous duplicate exact-product results' : bindingValid
        ? 'no exact source-qualified Nifty 50 ETF result'
        : 'WTI response financial-state binding did not match the current recommendation');

    const taxStartedAt = performance.now();
    const validTaxResult = Boolean(taxContext && uniqueQualifiedProduct)
      && uniqueQualifiedProduct.postTaxAnalysis?.status === 'CALCULATED'
      && uniqueQualifiedProduct.postTaxAnalysis?.fiscalYear === taxContext.fiscalYear;
    const taxStatus = uniqueQualifiedProduct?.postTaxAnalysis?.status;
    reporter.add('Product tax workflow', validTaxResult, validTaxResult
      ? `exact-product tax calculation is bound to the supplied fiscal year; ${elapsedMilliseconds(taxStartedAt)}ms`
      : !taxContext
        ? 'TAX_INPUTS_UNAVAILABLE; provide actual required tax facts; no tax values are inferred'
        : !uniqueQualifiedProduct
          ? 'NOT_EVALUATED because no exact current product passed identity and financial-state checks'
          : safeStableCode(taxStatus)
            ? `${safeStableCode(taxStatus)}; no tax values are inferred`
            : 'exact-product tax result is not calculated; no tax values are inferred');
    timingStatus = 'COMPLETED';
  } catch (error) {
    const failure = safeFailureKind(error);
    timingStatus = failure.kind === 'timeout' ? 'TIMEOUT' : 'NETWORK_ERROR';
    timingCode = failure.code;
    const errorDetail = `WTI ${failure.kind}${failure.code ? ` (${failure.code})` : ''}; ${elapsedMilliseconds(startedAt)}ms`;
    reporter.add('ETF product source', false, errorDetail);
    reportWtiNotEvaluated(reporter, 'WTI request failed');
  } finally {
    emitSafeTiming(onTiming, {
      stage: 'rank_wti_request',
      elapsedMs: elapsedMilliseconds(startedAt),
      status: timingStatus,
      ...(timingCode ? { code: timingCode } : {}),
    });
  }
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
  if (!result.response.ok) {
    const code = safeStableCode(result.body?.code);
    return `HTTP ${result.response.status}${code ? ` (${code})` : ''}`;
  }
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
    reporter.add(label, true, 'valid JSON object loaded; contents are never printed');
    return parsed;
  } catch {
    reporter.add(label, false, 'file must contain one valid JSON object; contents are never printed');
    return null;
  }
}

async function checkMongoTransaction(reporter) {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    reporter.add('Mongo/transaction support', false, 'MONGODB_URI is not configured');
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

export async function checkBrowserAndFinancialFlow(reporter, {
  apiBase,
  frontendUrl,
  completionPayload,
  taxContext,
  email = process.env.DEMO_EMAIL,
  password = process.env.DEMO_PASSWORD,
  idempotencyKey = process.env.DEMO_COMPLETION_IDEMPOTENCY_KEY,
  parentInstrumentId = process.env.DEMO_NIFTY_ETF_PARENT_ID,
}, { launchBrowser, onTiming } = {}) {
  if (!frontendUrl || !email || !password) {
    reporter.add('Critical browser path', false, 'browser launch/navigation NOT_EVALUATED because demo browser configuration is missing');
    reporter.add('Profile completion/auth', false, 'NOT_EVALUATED because demo identity configuration is missing');
    reporter.add('Recommendation current-state binding', false, 'NOT_EVALUATED because authentication was not run');
    reporter.add('ETF product source', false, 'NOT_EVALUATED because authentication was not run');
    reportWtiNotEvaluated(reporter, 'authentication was not run');
    return;
  }

  let browser;
  let context;
  let page;
  let browserLaunched = false;
  let loginPageRendered = false;
  let authenticated = false;
  let providerRequestObserved = false;
  let providerRequestInspectionFailed = false;
  let criticalPathRecorded = false;
  const recordCriticalPath = (passed, detail) => {
    reporter.add('Critical browser path', passed, detail);
    criticalPathRecorded = true;
  };
  try {
    try {
      const frontend = new URL(frontendUrl);
      const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
      if (!['http:', 'https:'].includes(frontend.protocol)
          || (frontend.protocol !== 'https:' && !localHosts.has(frontend.hostname))
          || frontend.username || frontend.password || frontend.search || frontend.hash) {
        throw new Error('Unsafe frontend URL configuration.');
      }
      if (launchBrowser) {
        browser = await launchBrowser();
      } else {
        const requireFromReactapp = createRequire(path.join(REACTAPP_DIR, 'package.json'));
        const { chromium } = requireFromReactapp('@playwright/test');
        browser = await chromium.launch({ headless: true });
      }
      if (!browser || typeof browser.newContext !== 'function') {
        throw Object.assign(new Error('Browser launch returned an invalid browser handle.'), { code: 'BROWSER_HANDLE_INVALID' });
      }
      browserLaunched = true;
      context = await browser.newContext();
      page = await context.newPage();
      page.on('request', request => {
        try {
          const providerRequest = isFinancialProviderRequestUrl(request.url());
          if (providerRequest === null) providerRequestInspectionFailed = true;
          else if (providerRequest) providerRequestObserved = true;
        } catch {
          providerRequestInspectionFailed = true;
        }
      });

      const frontendResponse = await page.goto(new URL('/login', frontendUrl).toString(), { waitUntil: 'domcontentloaded' });
      if (!frontendResponse) throw Object.assign(new Error('No HTTP response.'), { code: 'NO_HTTP_RESPONSE' });
      if (!responseOk(frontendResponse)) {
        throw Object.assign(new Error('Navigation returned non-success HTTP status.'), {
          code: 'HTTP_STATUS',
          status: responseStatus(frontendResponse),
        });
      }
      const loginReadyTimeoutMs = 15_000;
      await Promise.all([
        page.locator('#login-form'),
        page.locator('#login-email'),
        page.locator('#login-password'),
      ].map(locator => locator.waitFor({ state: 'visible', timeout: loginReadyTimeoutMs })));
      loginPageRendered = true;
    } catch (error) {
      const status = Number.isInteger(error?.status) ? ` HTTP ${error.status}` : '';
      const failure = safeFailureKind(error);
      recordCriticalPath(false, `browser launch/navigation failed${status} (${failure.kind}${failure.code ? ` ${failure.code}` : ''})`);
      reporter.add('Profile completion/auth', false, 'NOT_EVALUATED because browser launch/navigation failed');
      reporter.add('Recommendation current-state binding', false, 'NOT_EVALUATED because browser launch/navigation failed');
      reporter.add('ETF product source', false, 'NOT_EVALUATED because browser launch/navigation failed');
      reportWtiNotEvaluated(reporter, 'browser launch/navigation failed');
      return;
    }

    try {
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
      if (!responseOk(loginResponse)) {
        throw Object.assign(new Error('Login returned non-success HTTP status.'), {
          code: 'HTTP_STATUS', status: responseStatus(loginResponse),
        });
      }
      authenticated = true;
    } catch (error) {
      const status = Number.isInteger(error?.status) ? ` HTTP ${error.status}` : '';
      const failure = safeFailureKind(error);
      reporter.add('Profile completion/auth', false, `authentication failed${status} (${failure.kind}${failure.code ? ` ${failure.code}` : ''})`);
      reporter.add('Recommendation current-state binding', false, 'NOT_EVALUATED because authentication failed');
      reporter.add('ETF product source', false, 'NOT_EVALUATED because authentication failed');
      reportWtiNotEvaluated(reporter, 'authentication failed');
    }

    if (authenticated) {
      let profileId = null;
      if (!completionPayload || !idempotencyKey || idempotencyKey.length > 200) {
        reporter.add('Profile completion/auth', false, 'profile completion NOT_EVALUATED because payload or stable idempotency key is missing');
      } else {
        try {
          const csrf = (await context.cookies(apiBase)).find(cookie => cookie.name === 'wg_csrf')?.value;
          if (!csrf) throw Object.assign(new Error('CSRF cookie unavailable.'), { code: 'CSRF_COOKIE_MISSING' });
          const completion = await page.request.post(`${apiBase}/profile/complete`, {
            data: completionPayload,
            headers: {
              'X-CSRF-Token': csrf,
              'Idempotency-Key': idempotencyKey,
              Origin: new URL(frontendUrl).origin,
            },
            timeout: 120_000,
          });
          const completionBody = await readSafeResponseBody(completion);
          const completedProfileId = completionBody?.profile?.profileId;
          const completed = responseOk(completion) && Boolean(completedProfileId);
          const code = safeStableCode(completionBody?.code);
          reporter.add('Profile completion/auth', completed, completed
            ? 'profile completion committed or safely replayed'
            : `profile completion HTTP ${responseStatus(completion)}${code ? ` (${code})` : ''}`);
          if (completed) profileId = completedProfileId;
        } catch (error) {
          const failure = safeFailureKind(error);
          reporter.add('Profile completion/auth', false, `profile completion failed (${failure.kind}${failure.code ? ` ${failure.code}` : ''})`);
        }
      }

      if (!profileId) {
        try {
          const profileResult = await page.request.get(`${apiBase}/profile/current`);
          const profile = responseOk(profileResult) ? await readSafeResponseBody(profileResult) : null;
          profileId = profile?.profileId || null;
        } catch { /* record the safe unavailable state below */ }
      }

      if (!profileId) {
        reporter.add('Recommendation current-state binding', false, 'NOT_EVALUATED because an authenticated current profile could not be resolved');
        reporter.add('ETF product source', false, 'NOT_EVALUATED because an authenticated current profile could not be resolved');
        reportWtiNotEvaluated(reporter, 'an authenticated current profile could not be resolved');
      } else {
        let recommendation = null;
        let bindingValid = false;
        try {
          const recommendationResult = await page.request.get(`${apiBase}/recommend/current?profileId=${encodeURIComponent(profileId)}`);
          recommendation = responseOk(recommendationResult) ? await readSafeResponseBody(recommendationResult) : null;
          bindingValid = responseOk(recommendationResult)
            && hasCurrentFinancialBinding(recommendation)
            && recommendation.profileId === profileId;
          reporter.add('Recommendation current-state binding', bindingValid, bindingValid
            ? 'CURRENT response contains profile/recommendation/allocation fingerprints and fresh provenance'
            : `HTTP ${responseStatus(recommendationResult)} or incomplete/stale current-state binding`);
        } catch (error) {
          const failure = safeFailureKind(error);
          reporter.add('Recommendation current-state binding', false, `current recommendation lookup failed (${failure.kind}${failure.code ? ` ${failure.code}` : ''})`);
        }

        if (!bindingValid) {
          reporter.add('ETF product source', false, 'NOT_EVALUATED because current recommendation state is missing or stale');
          reportWtiNotEvaluated(reporter, 'current recommendation state is missing or stale');
        } else {
          let csrf = '';
          try { csrf = (await context.cookies(apiBase)).find(cookie => cookie.name === 'wg_csrf')?.value || ''; } catch { /* request fails closed */ }
          await reportWtiProductChecks(reporter, {
            recommendation,
            parentInstrumentId,
            taxContext,
            onTiming,
            requestWti: () => page.request.post(`${apiBase}/instruments/rank-wti`, {
              data: {
                profileId,
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
                'X-CSRF-Token': csrf,
                'Idempotency-Key': randomUUID(),
                Origin: new URL(frontendUrl).origin,
              },
              timeout: 120_000,
            }),
          });
        }
      }

      try {
        const profileResponse = await page.goto(new URL('/profile', frontendUrl).toString(), { waitUntil: 'domcontentloaded' });
        if (!profileResponse) throw Object.assign(new Error('Profile navigation returned no HTTP response.'), { code: 'NO_HTTP_RESPONSE' });
        if (!responseOk(profileResponse)) {
          throw Object.assign(new Error('Profile navigation returned a non-success HTTP status.'), {
            code: 'HTTP_STATUS',
            status: responseStatus(profileResponse),
          });
        }
        const dashboard = page.locator('aside.sidebar');
        await dashboard.waitFor({ state: 'visible', timeout: 45_000 });
        const sidebarVisible = await dashboard.isVisible();
        const profilePath = new URL(page.url()).pathname;
        const dashboardVisible = hasAuthenticatedDashboard({
          pathname: profilePath,
          sidebarVisible,
        });
        const noDirectProviderRequest = !providerRequestObserved && !providerRequestInspectionFailed;
        const criticalPathPassed = browserLaunched
          && loginPageRendered
          && authenticated
          && responseOk(profileResponse)
          && dashboardVisible
          && noDirectProviderRequest;
        const detail = providerRequestObserved
          ? 'browser attempted a direct provider request; frontend must use backend APIs only'
          : providerRequestInspectionFailed
            ? 'browser request inspection failed; provider isolation could not be verified'
            : dashboardVisible
              ? 'authenticated profile/dashboard shell rendered without direct provider calls'
              : 'dashboard rendering failed authenticated profile/path checks';
        recordCriticalPath(criticalPathPassed, detail);
      } catch (error) {
        const status = Number.isInteger(error?.status) ? ` HTTP ${error.status}` : '';
        const failure = safeFailureKind(error);
        recordCriticalPath(false, `authenticated dashboard rendering failed${status} (${failure.kind}${failure.code ? ` ${failure.code}` : ''})`);
      }
    } else {
      recordCriticalPath(false, 'NOT_EVALUATED because authentication failed before dashboard verification');
    }
  } catch (error) {
    if (!criticalPathRecorded) {
      const failure = safeFailureKind(error);
      recordCriticalPath(false, `browser preflight stage failed (${failure.kind}${failure.code ? ` ${failure.code}` : ''})`);
    }
  } finally {
    await browser?.close().catch(() => {});
  }
}

export async function runDemoPreflight() {
  const reporter = makeReporter();
  if (process.env.DEMO_LIVE_PREFLIGHT !== '1') {
    reporter.add('Explicit live-demo mode', false, 'set DEMO_LIVE_PREFLIGHT=1 to run external live checks intentionally');
    return finishPreflight(reporter);
  }
  reporter.add('Explicit live-demo mode', true, 'live checks were explicitly enabled');

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
    return finishPreflight(reporter);
  }
  reporter.add('Backend URL configuration', true, 'safe local HTTP or remote HTTPS API URL verified');
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

  return finishPreflight(reporter);
}

function finishPreflight(reporter) {
  const summary = reporter.finish();
  process.stdout.write(`\nLive-demo preflight: ${summary.passed} PASS, ${summary.failed} FAIL.\n`);
  if (summary.failed) {
    process.stdout.write('FINAL LIVE DEMO ENVIRONMENT NOT READY. Resolve the failed checks above; this is separate from deterministic product-integrity certification.\n');
  }
  return { exitCode: summary.failed ? 1 : 0, checks: summary.checks };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runDemoPreflight();
  process.exitCode = result.exitCode;
}
