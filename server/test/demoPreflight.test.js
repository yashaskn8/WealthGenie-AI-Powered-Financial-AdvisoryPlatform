import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessCurrentMarketContext,
  hasAuthenticatedDashboard,
  hasCurrentFinancialBinding,
  isRedisRequired,
  matchesRecommendationBinding,
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
    product => { product.benchmark.canonicalProductId = 'market:index:sensex'; },
    product => { product.identityEvidence[0].url = 'https://nsearchives.nseindia.com/trading_security/mf/pdf/unrelated.pdf'; },
    product => { product.identityEvidence.pop(); },
    product => { product.benchmark.source.url = 'https://mf.nipponindiaim.com.evil.example/fake'; },
    product => { product.benchmark.source.url = 'https://mf.nipponindiaim.com/FundsAndPerformance/Pages/unrelated.aspx'; },
    product => { product.source.url = 'https://portal.amfiindia.com.evil.example/fake'; },
    product => { product.source.url = 'https://portal.amfiindia.com/spages/unrelated.txt'; },
    product => { product.primaryFact.source.instrumentId = '999999'; },
    product => { product.primaryFact.freshness.status = 'STALE'; },
    product => { product.primaryFact.source.provider = 'OTHER_SOURCE'; },
    product => { product.primaryFact.source.url = 'http://unverified.example/nav'; },
    product => { product.nav.value = 99999; },
    product => { product.primaryFact.availabilityStatus = 'UNAVAILABLE'; },
    product => { product.primaryFact.observedAt = 'not-a-date'; },
    product => { product.canonicalProductId = ''; },
    product => { product.isin = 'INF204KB15I9'; },
    product => { product.externalIds[1].value = 'INF204KB15I9'; },
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
