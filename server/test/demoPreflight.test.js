import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessCurrentMarketContext,
  checkBrowserAndFinancialFlow,
  EXPECTED_PREFLIGHT_CHECKS,
  hasAuthenticatedDashboard,
  hasCurrentFinancialBinding,
  isRedisRequired,
  makeReporter,
  matchesRecommendationBinding,
  reportWtiProductChecks,
  qualifiesExactNiftyEtf,
} from '../scripts/demoPreflight.js';

const currentBinding = () => ({
  profileId: '64b000000000000000000001',
  profile_version: 4,
  recommendationId: '64b000000000000000000002',
  allocation_revision: 3,
  allocation_revision_id: '64b000000000000000000003',
  portfolio_fingerprint: 'a'.repeat(64),
  recommendation_fingerprint: 'b'.repeat(64),
  response_state: 'CURRENT',
  calculation_freshness: { fresh: true },
});

const qualifiedNiftyEtf = () => ({
  canonicalProductId: 'etf:isin:INF204KB14I2',
  parentInstrumentId: 'nifty_etf',
  productType: 'ETF',
  isin: 'INF204KB14I2',
  exchange: 'NSE',
  ticker: 'NIFTYBEES',
  externalIds: [
    { source: 'ISIN', value: 'INF204KB14I2' },
    { source: 'AMFI_SCHEME_CODE', value: '140084' },
    { source: 'NSE_TRADING_SYMBOL', value: 'NIFTYBEES' },
  ],
  benchmark: {
    id: 'NIFTY_50',
    canonicalProductId: 'market:index:nifty-50',
    returnVariant: 'NIFTY 50 TRI',
    source: { url: 'https://mf.nipponindiaim.com/FundsAndPerformance/ProductNotes/NipponIndia-ETF-Nifty-50-BeES-Feb-2026.pdf' },
  },
  identityEvidence: [
    { authority: 'NSE', url: 'https://nsearchives.nseindia.com/trading_security/mf/pdf/Nippon_20032026171200_NipponMutualFund.pdf' },
    { authority: 'NSE Clearing', url: 'https://nsearchives.nseindia.com/content/circulars/CMPT74390.pdf' },
  ],
  source: { provider: 'AMFI', url: 'https://portal.amfiindia.com/spages/NAVAll.txt' },
  nav: { value: 245.67, unit: 'NAV_PER_UNIT', observedAt: '2026-10-01T09:30:00.000Z' },
  marketPrice: { value: null, availabilityStatus: 'UNAVAILABLE' },
  primaryFact: {
    kind: 'MUTUAL_FUND_NAV',
    canonicalProductId: 'mf:amfi:140084',
    source: { provider: 'AMFI', instrumentId: '140084', url: 'https://portal.amfiindia.com/spages/NAVAll.txt' },
    unit: 'NAV_PER_UNIT',
    availabilityStatus: 'AVAILABLE',
    value: 245.67,
    observedAt: '2026-10-01T09:30:00.000Z',
    freshness: { status: 'FRESH' },
  },
});

function fakeHttpResponse(status, body, { malformed = false } = {}) {
  return {
    ok: () => status >= 200 && status < 300,
    status: () => status,
    json: async () => {
      if (malformed) throw new SyntaxError('body omitted from diagnostics');
      return body;
    },
  };
}

function browserFlowFixture(scenario = {}) {
  let currentUrl = 'http://127.0.0.1:5173/login';
  let requestListener = null;
  const recommendation = currentBinding();
  const rankBinding = {
    profileId: recommendation.profileId,
    profileVersion: recommendation.profile_version,
    recommendationId: recommendation.recommendationId,
    allocationRevision: recommendation.allocation_revision,
    allocationRevisionId: recommendation.allocation_revision_id,
    portfolioFingerprint: recommendation.portfolio_fingerprint,
    recommendationFingerprint: recommendation.recommendation_fingerprint,
  };
  const login = fakeHttpResponse(scenario.loginStatus ?? 200, {});
  const page = {
    on(event, callback) { if (event === 'request') requestListener = callback; },
    async goto(url) {
      if (url.endsWith('/login')) {
        currentUrl = url;
        if (scenario.loginNavigationStatus) return fakeHttpResponse(scenario.loginNavigationStatus, {});
        return fakeHttpResponse(200, {});
      }
      currentUrl = url;
      if (url.endsWith('/profile')) {
        if (scenario.dashboardRedirectLogin) currentUrl = 'http://127.0.0.1:5173/login';
        if (scenario.dashboardWrongPath) currentUrl = 'http://127.0.0.1:5173/';
        const providerUrl = typeof scenario.directProviderRequest === 'string'
          ? scenario.directProviderRequest
          : scenario.directProviderRequest
            ? 'https://portal.amfiindia.com/private?token=hidden'
            : null;
        if (providerUrl) requestListener?.({ url: () => providerUrl });
        if (scenario.providerRequestInspectionError) requestListener?.({ url: () => { throw new Error('uninspectable request'); } });
        if (scenario.profileNavigationStatus) return fakeHttpResponse(scenario.profileNavigationStatus, {});
      }
      if (scenario.dashboardError) throw Object.assign(new Error('secret browser detail'), { code: 'DASHBOARD_FAILED' });
      return fakeHttpResponse(200, {});
    },
    locator(selector) {
      return {
        async waitFor() {
          if (selector === 'aside.sidebar' && scenario.dashboardError) throw Object.assign(new Error('secret dashboard detail'), { code: 'DASHBOARD_FAILED' });
          if (selector === 'aside.sidebar' && scenario.sidebarMissing) throw Object.assign(new Error('sidebar missing'), { name: 'TimeoutError' });
          if (selector === '#login-form' && scenario.loginFormError) throw Object.assign(new Error('secret login detail'), { code: 'LOGIN_FORM_TIMEOUT' });
          if (selector !== '#login-form' && selector !== 'aside.sidebar' && scenario.loginControlError) throw Object.assign(new Error('secret login control detail'), { code: 'LOGIN_CONTROL_TIMEOUT' });
        },
        async fill() {},
        async click() {},
        async isVisible() { return selector !== 'aside.sidebar' || !scenario.sidebarMissing; },
      };
    },
    async waitForResponse(predicate) {
      const response = {
        ...login,
        url: () => 'http://127.0.0.1:5000/api/auth/login',
        request: () => ({ method: () => 'POST' }),
      };
      assert.equal(predicate(response), true);
      return response;
    },
    url: () => currentUrl,
    request: {
      async post(url) {
        if (url.endsWith('/profile/complete')) {
          return fakeHttpResponse(scenario.completionStatus ?? 200, { profile: { profileId: recommendation.profileId } });
        }
        if (url.endsWith('/instruments/rank-wti')) {
          if (scenario.wtiError) throw scenario.wtiError;
          if (scenario.wtiStatus) return fakeHttpResponse(scenario.wtiStatus, { code: scenario.wtiCode || 'UPSTREAM_UNAVAILABLE' });
          if (scenario.wtiMalformed) return fakeHttpResponse(200, null, { malformed: true });
          return fakeHttpResponse(200, {
            ...(scenario.wtiMissingBinding ? {} : {
              financialStateBinding: scenario.wtiBindingMismatch ? { ...rankBinding, allocationRevision: 99 } : rankBinding,
            }),
            products: scenario.products ?? [{ ...qualifiedNiftyEtf(), postTaxAnalysis: { status: 'TAX_CLASSIFICATION_UNAVAILABLE' } }],
          });
        }
        throw new Error('unexpected fake POST endpoint');
      },
      async get(url) {
        if (url.endsWith('/profile/current')) return fakeHttpResponse(200, { profileId: recommendation.profileId });
        if (url.includes('/recommend/current?')) {
          if (scenario.recommendationError) throw Object.assign(new Error('secret recommendation URL'), { code: 'ECONNRESET' });
          if (scenario.recommendationStatus) return fakeHttpResponse(scenario.recommendationStatus, {});
          return fakeHttpResponse(200, recommendation);
        }
        throw new Error('unexpected fake GET endpoint');
      },
    },
  };
  const browser = {
    async newContext() {
      return {
        newPage: async () => page,
        cookies: async () => scenario.missingCsrfCookie ? [] : [{ name: 'wg_csrf', value: 'fake-csrf-value' }],
      };
    },
    async close() {},
  };
  return { browser, launchBrowser: scenario.launchError ? async () => { throw scenario.launchError; } : async () => browser };
}

async function runBrowserFlow(scenario = {}) {
  const lines = [];
  const reporter = makeReporter(line => lines.push(line));
  const fixture = browserFlowFixture(scenario);
  await checkBrowserAndFinancialFlow(reporter, {
    apiBase: 'http://127.0.0.1:5000/api',
    frontendUrl: 'http://127.0.0.1:5173',
    completionPayload: { profile: 'fixture only' },
    taxContext: { fiscalYear: 'FY2026-27' },
    email: 'demo@example.invalid',
    password: 'fixture-password',
    idempotencyKey: 'fixture-idempotency-key',
    parentInstrumentId: scenario.parentInstrumentId ?? 'nifty_etf',
  }, fixture);
  return { ...reporter.finish(), lines };
}

test('demo preflight only accepts a complete current financial-state binding', () => {
  assert.equal(hasCurrentFinancialBinding(currentBinding()), true);

  for (const mutation of [
    value => { value.response_state = 'HISTORICAL_GENERATION'; },
    value => { value.calculation_freshness.fresh = false; },
    value => { value.allocation_revision_id = ''; },
    value => { value.portfolio_fingerprint = 'not-a-fingerprint'; },
    value => { value.profile_version = 0; },
    value => { value.profile_version = '4'; },
  ]) {
    const staleOrIncomplete = currentBinding();
    mutation(staleOrIncomplete);
    assert.equal(hasCurrentFinancialBinding(staleOrIncomplete), false);
  }
});

test('demo preflight does not treat the login React root as an authenticated dashboard', () => {
  assert.equal(hasAuthenticatedDashboard({ pathname: '/profile', sidebarVisible: true }), true);
  assert.equal(hasAuthenticatedDashboard({ pathname: '/profile', sidebarVisible: false }), false);
  assert.equal(hasAuthenticatedDashboard({ pathname: '/login', sidebarVisible: true }), false);
  assert.equal(hasAuthenticatedDashboard({ pathname: '/profile/', sidebarVisible: true }), true);
});

test('demo preflight binds product-ranking results to the same recommendation state', () => {
  const recommendation = currentBinding();
  const rankBinding = {
    profileId: recommendation.profileId,
    profileVersion: recommendation.profile_version,
    recommendationId: recommendation.recommendationId,
    allocationRevision: recommendation.allocation_revision,
    allocationRevisionId: recommendation.allocation_revision_id,
    portfolioFingerprint: recommendation.portfolio_fingerprint,
    recommendationFingerprint: recommendation.recommendation_fingerprint,
  };
  assert.equal(matchesRecommendationBinding(rankBinding, recommendation), true);
  assert.equal(matchesRecommendationBinding({ ...rankBinding, allocationRevisionId: '64b000000000000000000004' }, recommendation), false);
  assert.equal(matchesRecommendationBinding(rankBinding, null), false);
});

test('demo preflight never allows optional Redis settings to weaken production readiness', () => {
  assert.equal(isRedisRequired({ NODE_ENV: 'production', DEMO_REQUIRE_REDIS: 'false', REQUIRE_REDIS: 'false' }), true);
  assert.equal(isRedisRequired({ NODE_ENV: 'test', REQUIRE_REDIS: 'true' }), true);
  assert.equal(isRedisRequired({ NODE_ENV: 'development' }), false);
});

test('demo preflight requires exact NIFTY 50 identity and fresh primary-fact provenance', () => {
  assert.equal(qualifiesExactNiftyEtf(qualifiedNiftyEtf()), true);

  const invalidProducts = [
    product => { product.parentInstrumentId = 'liquid_etf'; },
    product => { product.benchmark.canonicalProductId = 'market:index:sensex'; },
    product => { product.identityEvidence[0].url = 'https://nsearchives.nseindia.com/trading_security/mf/pdf/unrelated.pdf'; },
    product => { product.identityEvidence.pop(); },
    product => { product.benchmark.source.url = 'https://mf.nipponindiaim.com.evil.example/fake'; },
    product => { product.benchmark.source.url = 'https://mf.nipponindiaim.com/FundsAndPerformance/Pages/unrelated.aspx'; },
    product => { product.source.url = 'https://portal.amfiindia.com.evil.example/fake'; },
    product => { product.source.url = 'https://portal.amfiindia.com/spages/unrelated.txt'; },
    product => { product.primaryFact.source.instrumentId = '999999'; },
    product => { product.primaryFact.canonicalProductId = 'mf:amfi:140085'; },
    product => { product.primaryFact.freshness.status = 'STALE'; },
    product => { product.primaryFact.source.provider = 'OTHER_SOURCE'; },
    product => { product.primaryFact.source.url = 'http://unverified.example/nav'; },
    product => { product.nav.value = 99999; },
    product => { product.primaryFact.availabilityStatus = 'UNAVAILABLE'; },
    product => { product.primaryFact.observedAt = 'not-a-date'; },
    product => { product.canonicalProductId = ''; },
    product => { product.isin = 'INF204KB15I9'; },
    product => { product.externalIds[1].value = 'INF204KB15I9'; },
    product => { product.ticker = 'NIFTY50BEES'; },
    product => { product.externalIds[2].value = 'NIFTY50BEES'; },
    product => { product.productType = 'MUTUAL_FUND'; },
  ];

  for (const mutate of invalidProducts) {
    const product = qualifiedNiftyEtf();
    mutate(product);
    assert.equal(qualifiesExactNiftyEtf(product), false);
  }

  const renamedProduct = qualifiedNiftyEtf();
  renamedProduct.name = 'A totally different display name';
  assert.equal(qualifiesExactNiftyEtf(renamedProduct), true, 'stable source IDs, not the display name, establish identity');
  const differentExchangePrice = qualifiedNiftyEtf();
  differentExchangePrice.marketPrice.value = 99999;
  assert.equal(qualifiesExactNiftyEtf(differentExchangePrice), true, 'an exchange price is not substituted for the AMFI NAV fact');
});

test('demo preflight requires current fresh NIFTY/VIX and one selected quote/history provider', () => {
  const result = {
    response: { ok: true },
    body: {
      status: 'MARKET_CONTEXT_AVAILABLE',
      marketSnapshot: {
        status: 'CURRENT',
        availability: 'AVAILABLE',
        observedAt: '2026-10-01T09:30:00.000Z',
        providerSelection: { selectedProvider: 'UPSTOX' },
        providerStatus: {
          quotes: { provider: 'UPSTOX' },
          history: { provider: 'UPSTOX' },
        },
        observedFacts: ['nifty50Current', 'indiaVixCurrent'].map((key, index) => ({
          key,
          value: index === 0 ? 24000 : 14,
          availabilityStatus: 'AVAILABLE',
          observedAt: '2026-10-01T09:29:00.000Z',
          freshness: { status: 'FRESH' },
          source: { provider: 'UPSTOX' },
        })),
        derivedFacts: [{ value: 0.25, availabilityStatus: 'AVAILABLE', freshness: { status: 'FRESH' } }],
      },
    },
  };

  const healthy = assessCurrentMarketContext(result);
  assert.equal(healthy.marketContextAvailable, true);
  assert.equal(healthy.selectedProvider, 'UPSTOX');

  const mixed = structuredClone(result);
  mixed.body.marketSnapshot.providerStatus.history.provider = 'NSE';
  assert.equal(assessCurrentMarketContext(mixed).marketContextAvailable, false);

  const stale = structuredClone(result);
  stale.body.marketSnapshot.observedFacts[1].freshness.status = 'STALE';
  assert.equal(assessCurrentMarketContext(stale).vixAvailable, false);
  assert.equal(assessCurrentMarketContext(stale).marketContextAvailable, false);

  const historical = structuredClone(result);
  historical.body.marketSnapshot.status = 'LAST_AVAILABLE';
  assert.equal(assessCurrentMarketContext(historical).marketContextAvailable, false);
});

test('preflight reporter emits every required check once and leaves unevaluated checks failed', () => {
  const lines = [];
  const reporter = makeReporter(line => lines.push(line));
  reporter.add('Backend', true, 'health verified');
  const result = reporter.finish();

  assert.deepEqual(result.checks.map(check => check.name), EXPECTED_PREFLIGHT_CHECKS);
  assert.equal(new Set(result.checks.map(check => check.name)).size, EXPECTED_PREFLIGHT_CHECKS.length);
  assert.equal(result.checks.find(check => check.name === 'Backend').passed, true);
  const skipped = result.checks.find(check => check.name === 'Product tax workflow');
  assert.equal(skipped.passed, false);
  assert.match(skipped.detail, /^NOT_EVALUATED/);
  assert.ok(result.failed > 0);
  assert.ok(lines.some(line => line.includes('FAIL Product tax workflow')));
});

test('preflight reporter rejects duplicate and unknown writes and protects finalized check accounting', () => {
  const attempts = [
    { initial: true, duplicate: false, expectedPassed: true },
    { initial: false, duplicate: true, expectedPassed: false },
    { initial: true, duplicate: true, expectedPassed: true },
    { initial: false, duplicate: false, expectedPassed: false },
  ];
  for (const { initial, duplicate, expectedPassed } of attempts) {
    const lines = [];
    const reporter = makeReporter(line => lines.push(line));
    reporter.add('Critical browser path', initial, 'first terminal outcome');
    assert.throws(
      () => reporter.add('Critical browser path', duplicate, 'attempted overwrite'),
      /already evaluated/i,
    );
    const result = reporter.finish();
    const check = result.checks.find(item => item.name === 'Critical browser path');
    assert.equal(check.passed, expectedPassed);
    assert.equal(check.state, expectedPassed ? 'PASS' : 'FAIL');
    assert.throws(() => reporter.add('Critical browser path', true, 'late write'), /finalization/i);
    assert.equal(reporter.finish().passed, result.passed);
    assert.equal(lines.length, EXPECTED_PREFLIGHT_CHECKS.length);
    assert.deepEqual(lines.map(line => line.match(/^(?:PASS|FAIL) (.+?) —/)?.[1]), EXPECTED_PREFLIGHT_CHECKS);
  }

  const reporter = makeReporter(() => {});
  assert.throws(() => reporter.add('Not a real check', true, 'bad name'), /Unexpected preflight check/);
  reporter.add('Backend', true, 'safe terminal outcome');
  reporter.checks.find(check => check.name === 'Backend').passed = false;
  const result = reporter.finish();
  assert.equal(result.checks.find(check => check.name === 'Backend').passed, true);
  assert.equal(result.checks.length, EXPECTED_PREFLIGHT_CHECKS.length);
  assert.equal(new Set(result.checks.map(check => check.name)).size, EXPECTED_PREFLIGHT_CHECKS.length);
  assert.equal(result.passed + result.failed, EXPECTED_PREFLIGHT_CHECKS.length);
  assert.ok(result.checks.every(check => ['PASS', 'FAIL', 'NOT_EVALUATED'].includes(check.state)));
  assert.ok(result.checks.filter(check => check.state === 'NOT_EVALUATED').every(check => !check.passed));
});

test('WTI HTTP failures stay under WTI checks and never become browser failures', async () => {
  for (const status of [409, 500]) {
    const lines = [];
    const timingEvents = [];
    const reporter = makeReporter(line => lines.push(line));
    await reportWtiProductChecks(reporter, {
      requestWti: async () => ({
        ok: false,
        status,
        json: async () => ({ code: status === 409 ? 'RECOMMENDATION_PARENT_MISMATCH' : 'UPSTREAM_UNAVAILABLE', message: 'must not print this response body' }),
      }),
      recommendation: currentBinding(),
      parentInstrumentId: 'nifty_etf',
      taxContext: { fiscalYear: 'FY2026-27' },
      onTiming: event => timingEvents.push(event),
    });
    const result = reporter.finish();

    assert.equal(result.checks.find(check => check.name === 'ETF product source').passed, false);
    assert.match(result.checks.find(check => check.name === 'ETF product source').detail, new RegExp(`HTTP ${status}`));
    assert.match(result.checks.find(check => check.name === 'ETF product source').detail, /RECOMMENDATION_PARENT_MISMATCH|UPSTREAM_UNAVAILABLE/);
    assert.match(result.checks.find(check => check.name === 'Nifty ETF exact-product result').detail, /^NOT_EVALUATED/);
    assert.match(result.checks.find(check => check.name === 'Product tax workflow').detail, /^NOT_EVALUATED/);
    assert.doesNotMatch(lines.join('\n'), /must not print this response body/);
    assert.doesNotMatch(lines.join('\n'), /Critical browser path.*HTTP/);
    assert.equal(timingEvents[0].stage, 'rank_wti_request');
    assert.equal(timingEvents[0].status, `HTTP_${status}`);
    assert.ok(Number.isInteger(timingEvents[0].elapsedMs) && timingEvents[0].elapsedMs >= 0);
  }
});

test('WTI timeout and network exceptions are attributed to WTI without exposing exception text', async () => {
  for (const error of [
    Object.assign(new Error('mongodb+srv://user:secret@host/db?token=hidden'), { name: 'TimeoutError', code: 'ETIMEDOUT' }),
    Object.assign(new Error('https://api.example/path?access_token=hidden'), { code: 'ECONNRESET' }),
  ]) {
    const lines = [];
    const reporter = makeReporter(line => lines.push(line));
    await reportWtiProductChecks(reporter, {
      requestWti: async () => { throw error; },
      recommendation: currentBinding(),
      parentInstrumentId: 'nifty_etf',
      taxContext: { fiscalYear: 'FY2026-27' },
    });
    const result = reporter.finish();

    assert.equal(result.checks.find(check => check.name === 'ETF product source').passed, false);
    assert.match(result.checks.find(check => check.name === 'ETF product source').detail, /WTI.*(timeout|network)/i);
    assert.match(result.checks.find(check => check.name === 'Nifty ETF exact-product result').detail, /^NOT_EVALUATED/);
    assert.match(result.checks.find(check => check.name === 'Product tax workflow').detail, /^NOT_EVALUATED/);
    assert.doesNotMatch(lines.join('\n'), /secret|access_token|mongodb\+srv|api\.example/);
    assert.doesNotMatch(lines.join('\n'), /Critical browser path.*WTI/);
  }
});

test('untrusted WTI error codes are omitted from timing while exception class remains useful', async () => {
  for (const code of ['lowercase-secret-token', { token: 'must-not-escape' }]) {
    const timingEvents = [];
    const reporter = makeReporter(() => {});
    await reportWtiProductChecks(reporter, {
      requestWti: async () => { throw Object.assign(new Error('private detail'), { code }); },
      recommendation: currentBinding(),
      parentInstrumentId: 'nifty_etf',
      taxContext: { fiscalYear: 'FY2026-27' },
      onTiming: event => timingEvents.push(event),
    });
    reporter.finish();

    assert.equal(timingEvents.length, 1);
    assert.equal(timingEvents[0].status, 'NETWORK_ERROR');
    assert.equal(Object.hasOwn(timingEvents[0], 'code'), false);
  }
});

test('malformed WTI JSON fails source qualification and leaves exact-product/tax checks explicit', async () => {
  const reporter = makeReporter(() => {});
  await reportWtiProductChecks(reporter, {
    requestWti: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('sensitive payload'); } }),
    recommendation: currentBinding(),
    parentInstrumentId: 'nifty_etf',
    taxContext: { fiscalYear: 'FY2026-27' },
  });
  const result = reporter.finish();
  assert.match(result.checks.find(check => check.name === 'ETF product source').detail, /malformed JSON/i);
  assert.match(result.checks.find(check => check.name === 'Nifty ETF exact-product result').detail, /^NOT_EVALUATED/);
  assert.match(result.checks.find(check => check.name === 'Product tax workflow').detail, /^NOT_EVALUATED/);
});

test('browser launch, login navigation, and login-control failures cannot pass the critical browser path', async () => {
  const launchFailure = await runBrowserFlow({ launchError: Object.assign(new Error('secret launch detail'), { code: 'BROWSER_MISSING' }) });
  assert.equal(launchFailure.checks.find(check => check.name === 'Critical browser path').passed, false);
  assert.match(launchFailure.checks.find(check => check.name === 'Critical browser path').detail, /browser launch\/navigation failed/);
  assert.match(launchFailure.checks.find(check => check.name === 'ETF product source').detail, /^NOT_EVALUATED/);
  assert.doesNotMatch(launchFailure.lines.join('\n'), /secret launch detail/);

  const navigationFailure = await runBrowserFlow({ loginNavigationStatus: 503 });
  assert.equal(navigationFailure.checks.find(check => check.name === 'Critical browser path').passed, false);
  assert.match(navigationFailure.checks.find(check => check.name === 'Critical browser path').detail, /browser launch\/navigation failed HTTP 503/);

  for (const scenario of [{ loginFormError: true }, { loginControlError: true }]) {
    const result = await runBrowserFlow(scenario);
    assert.equal(result.checks.find(check => check.name === 'Critical browser path').passed, false);
    assert.equal(result.checks.find(check => check.name === 'Profile completion/auth').passed, false);
    assert.match(result.checks.find(check => check.name === 'Recommendation current-state binding').detail, /^NOT_EVALUATED/);
    assert.match(result.checks.find(check => check.name === 'ETF product source').detail, /^NOT_EVALUATED/);
  }
});

test('login 401/500 fail the critical path and leave downstream financial checks unevaluated', async () => {
  for (const status of [401, 500]) {
    const result = await runBrowserFlow({ loginStatus: status });
    assert.equal(result.checks.find(check => check.name === 'Profile completion/auth').passed, false);
    assert.match(result.checks.find(check => check.name === 'Profile completion/auth').detail, new RegExp(`HTTP ${status}`));
    assert.equal(result.checks.find(check => check.name === 'Critical browser path').passed, false);
    assert.match(result.checks.find(check => check.name === 'Recommendation current-state binding').detail, /^NOT_EVALUATED/);
    assert.match(result.checks.find(check => check.name === 'ETF product source').detail, /^NOT_EVALUATED/);
    assert.match(result.checks.find(check => check.name === 'Nifty ETF exact-product result').detail, /^NOT_EVALUATED/);
    assert.match(result.checks.find(check => check.name === 'Product tax workflow').detail, /^NOT_EVALUATED/);
    assert.equal(result.lines.filter(line => line.startsWith('PASS Critical browser path')).length, 0);
    assert.equal(result.lines.filter(line => line.includes('Critical browser path')).length, 1);
  }
});

test('CSRF and profile-completion failures remain distinct from the authenticated browser path', async () => {
  const missingCsrf = await runBrowserFlow({ missingCsrfCookie: true });
  assert.equal(missingCsrf.checks.find(check => check.name === 'Profile completion/auth').passed, false);
  assert.match(missingCsrf.checks.find(check => check.name === 'Profile completion/auth').detail, /CSRF_COOKIE_MISSING/);
  assert.equal(missingCsrf.checks.find(check => check.name === 'Critical browser path').passed, true);
  assert.match(missingCsrf.checks.find(check => check.name === 'Critical browser path').detail, /authenticated profile\/dashboard shell/);

  const missingCsrfAndDashboard = await runBrowserFlow({ missingCsrfCookie: true, dashboardError: true });
  assert.equal(missingCsrfAndDashboard.checks.find(check => check.name === 'Profile completion/auth').passed, false);
  assert.equal(missingCsrfAndDashboard.checks.find(check => check.name === 'Critical browser path').passed, false);

  const completionConflict = await runBrowserFlow({ completionStatus: 409 });
  assert.equal(completionConflict.checks.find(check => check.name === 'Profile completion/auth').passed, false);
  assert.equal(completionConflict.checks.find(check => check.name === 'Critical browser path').passed, true);
  assert.match(completionConflict.checks.find(check => check.name === 'Critical browser path').detail, /authenticated profile\/dashboard shell/);
});

test('authenticated profile navigation must return successfully, remain on /profile, and render the sidebar', async () => {
  for (const scenario of [
    { profileNavigationStatus: 503 },
    { dashboardRedirectLogin: true },
    { dashboardWrongPath: true },
    { sidebarMissing: true },
  ]) {
    const result = await runBrowserFlow(scenario);
    assert.equal(result.checks.find(check => check.name === 'Critical browser path').passed, false);
  }
});

test('profile and recommendation failures retain all dependent checks as NOT_EVALUATED', async () => {
  const profileFailure = await runBrowserFlow({ completionStatus: 503 });
  assert.match(profileFailure.checks.find(check => check.name === 'Profile completion/auth').detail, /profile completion HTTP 503/);

  const recommendationFailure = await runBrowserFlow({ recommendationStatus: 409 });
  assert.match(recommendationFailure.checks.find(check => check.name === 'Recommendation current-state binding').detail, /HTTP 409/);
  assert.match(recommendationFailure.checks.find(check => check.name === 'ETF product source').detail, /^NOT_EVALUATED/);
  assert.match(recommendationFailure.checks.find(check => check.name === 'Product tax workflow').detail, /^NOT_EVALUATED/);
});

test('WTI exceptions, 409, 500, and malformed JSON never fail the browser stage', async () => {
  const scenarios = [
    { wtiStatus: 409, wtiCode: 'RECOMMENDATION_PARENT_MISMATCH' },
    { wtiStatus: 500, wtiCode: 'UPSTREAM_UNAVAILABLE' },
    { wtiMalformed: true },
    { wtiError: Object.assign(new Error('https://private.invalid/?token=hidden'), { name: 'TimeoutError', code: 'ETIMEDOUT' }) },
    { wtiError: Object.assign(new Error('private provider details'), { code: 'ECONNRESET' }) },
  ];
  for (const scenario of scenarios) {
    const result = await runBrowserFlow(scenario);
    assert.equal(result.checks.find(check => check.name === 'Critical browser path').passed, true);
    assert.equal(result.checks.find(check => check.name === 'ETF product source').passed, false);
    assert.equal(result.checks.find(check => check.name === 'Nifty ETF exact-product result').passed, false);
    assert.equal(result.checks.find(check => check.name === 'Product tax workflow').passed, false);
    assert.doesNotMatch(result.lines.join('\n'), /private\.invalid|token=hidden|private provider details/);
  }
});

test('exact product and tax failures remain independently visible', async () => {
  const cases = [
    { products: [] },
    { products: { unexpected: 'not-an-array' } },
    { products: [qualifiedNiftyEtf(), qualifiedNiftyEtf()] },
    { products: [(() => { const product = qualifiedNiftyEtf(); product.externalIds[1].value = 'different'; return product; })()] },
    { products: [(() => { const product = qualifiedNiftyEtf(); product.primaryFact.canonicalProductId = 'mf:amfi:140085'; return product; })()] },
    { products: [(() => { const product = qualifiedNiftyEtf(); delete product.primaryFact.canonicalProductId; return product; })()] },
    { products: [(() => { const product = qualifiedNiftyEtf(); product.primaryFact.freshness.status = 'STALE'; return product; })()] },
    { products: [(() => { const product = qualifiedNiftyEtf(); product.primaryFact.source.provider = 'OTHER_SOURCE'; return product; })()] },
    { wtiBindingMismatch: true },
    { wtiMissingBinding: true },
    { parentInstrumentId: 'liquid_etf' },
  ];
  for (const scenario of cases) {
    const result = await runBrowserFlow(scenario);
    assert.equal(result.checks.find(check => check.name === 'Nifty ETF exact-product result').passed, false);
  }

  const taxUnavailable = await runBrowserFlow();
  assert.equal(taxUnavailable.checks.find(check => check.name === 'ETF product source').passed, true);
  assert.equal(taxUnavailable.checks.find(check => check.name === 'Nifty ETF exact-product result').passed, true);
  assert.equal(taxUnavailable.checks.find(check => check.name === 'Product tax workflow').passed, false);
  assert.match(taxUnavailable.checks.find(check => check.name === 'Product tax workflow').detail, /TAX_CLASSIFICATION_UNAVAILABLE/);

  const wrongTaxYear = await runBrowserFlow({ products: [{
    ...qualifiedNiftyEtf(), postTaxAnalysis: { status: 'CALCULATED', fiscalYear: 'FY2025-26' },
  }] });
  assert.equal(wrongTaxYear.checks.find(check => check.name === 'Nifty ETF exact-product result').passed, true);
  assert.equal(wrongTaxYear.checks.find(check => check.name === 'Product tax workflow').passed, false);
  const noExactButClaimedTax = await runBrowserFlow({ products: [{
    ...qualifiedNiftyEtf(), canonicalProductId: 'etf:isin:OTHER',
    postTaxAnalysis: { status: 'CALCULATED', fiscalYear: 'FY2026-27' },
  }] });
  assert.equal(noExactButClaimedTax.checks.find(check => check.name === 'Nifty ETF exact-product result').passed, false);
  assert.equal(noExactButClaimedTax.checks.find(check => check.name === 'Product tax workflow').passed, false);
});

test('dashboard and direct-provider failures affect only the critical browser check', async () => {
  const dashboardFailure = await runBrowserFlow({ dashboardError: true });
  assert.equal(dashboardFailure.checks.find(check => check.name === 'Critical browser path').passed, false);
  assert.equal(dashboardFailure.checks.find(check => check.name === 'ETF product source').passed, true);
  assert.equal(dashboardFailure.checks.find(check => check.name === 'Nifty ETF exact-product result').passed, true);

  const directProvider = await runBrowserFlow({ directProviderRequest: true });
  assert.equal(directProvider.checks.find(check => check.name === 'Critical browser path').passed, false);
  assert.match(directProvider.checks.find(check => check.name === 'Critical browser path').detail, /direct provider request/);

  const providerHosts = [
    'https://www.nseindia.com/market-data',
    'https://portal.amfiindia.com/spages/NAVAll.txt',
    'https://api.upstox.com/v2/market-quote',
    'https://sbi.bank/rates',
    'https://sbi.co.in/rates',
    'https://www.rbi.org.in/rates',
    'https://www.dea.gov.in/rates',
    'https://www.indiapost.gov.in/rates',
    'https://www.incometax.gov.in/iec/foportal',
    'https://www.incometaxindia.gov.in/rates',
  ];
  for (const directProviderRequest of providerHosts) {
    const result = await runBrowserFlow({ directProviderRequest });
    assert.equal(result.checks.find(check => check.name === 'Critical browser path').passed, false, directProviderRequest);
    assert.doesNotMatch(result.lines.join('\n'), /token=hidden/);
  }

  const spoofedHost = await runBrowserFlow({ directProviderRequest: 'https://amfiindia.com.attacker.invalid/not-provider' });
  assert.equal(spoofedHost.checks.find(check => check.name === 'Critical browser path').passed, true);

  const uninspectableRequest = await runBrowserFlow({ providerRequestInspectionError: true });
  assert.equal(uninspectableRequest.checks.find(check => check.name === 'Critical browser path').passed, false);
  assert.match(uninspectableRequest.checks.find(check => check.name === 'Critical browser path').detail, /request inspection failed/);
});
