import assert from 'node:assert/strict';
import test from 'node:test';
import { rankWhereToInvestBackend } from '../services/RecommendationPipeline.js';
import {
  isQualifiedNiftyEtfIdentity,
  rankQualifiedNiftyEtfProducts,
  supportsQualifiedEtfParentCategory,
} from '../services/niftyEtfProductRanking.js';
import { canonicalProfile } from './helpers/canonicalProfile.js';

const NOW = '2026-10-01T10:00:00.000Z';
const AMFI_NAV_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt';
const AMFI_HISTORY_URL = 'https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx?frmdt=28-Sep-2025&todt=04-Oct-2025';
const ETF_CATEGORY = 'Open Ended Schemes(Other Scheme - Other ETFs)';

function amfiProduct({
  schemeCode = '140084',
  isin = 'INF204KB14I2',
  name = 'Issuer-provided ETF scheme name',
  category = ETF_CATEGORY,
} = {}) {
  return {
    canonicalProductId: `mf:amfi:${schemeCode}`,
    productType: 'MUTUAL_FUND',
    name,
    providerName: 'Nippon India Mutual Fund',
    schemeCategory: category,
    externalIds: [
      { source: 'AMFI_SCHEME_CODE', value: schemeCode },
      { source: 'ISIN', value: isin },
    ],
    source: { provider: 'AMFI', url: AMFI_NAV_URL },
  };
}

function amfiNavFact({
  schemeCode = '140084',
  value = 250,
  observedAt = '2026-10-01T09:55:00.000Z',
  fetchedAt = NOW,
  sourceUrl = AMFI_NAV_URL,
  freshness = 'FRESH',
} = {}) {
  return {
    kind: 'MUTUAL_FUND_NAV',
    canonicalProductId: `mf:amfi:${schemeCode}`,
    value,
    currency: 'INR',
    unit: 'NAV_PER_UNIT',
    observedAt,
    fetchedAt,
    availabilityStatus: 'AVAILABLE',
    freshness: { status: freshness, ageSeconds: 300, maxAgeSeconds: 345600 },
    source: { provider: 'AMFI', instrumentId: schemeCode, url: sourceUrl },
  };
}

function snapshots({ product, currentFact, historyFact } = {}) {
  return {
    current: {
      provider: 'AMFI',
      status: 'AVAILABLE',
      fetchedAt: NOW,
      products: [product || amfiProduct()],
      facts: [currentFact || amfiNavFact()],
    },
    historical: {
      provider: 'AMFI',
      status: 'AVAILABLE',
      fetchedAt: NOW,
      facts: [historyFact || amfiNavFact({
        value: 200,
        observedAt: '2025-10-01T09:55:00.000Z',
        sourceUrl: AMFI_HISTORY_URL,
        freshness: 'STALE',
      })],
    },
  };
}

function exactIdentity() {
  return {
    canonicalProductId: 'etf:isin:INF204KB14I2',
    amfiSchemeCode: '140084',
    isin: 'INF204KB14I2',
    exchange: 'NSE',
    ticker: 'NIFTYBEES',
    benchmark: { id: 'NIFTY_50', name: 'NIFTY 50', returnVariant: 'NIFTY 50 TRI' },
    identityEvidence: { url: 'https://nsearchives.nseindia.com/trading_security/mf/pdf/Nippon_20032026171200_NipponMutualFund.pdf' },
    listingEvidence: { url: 'https://nsearchives.nseindia.com/content/circulars/CMPT74390.pdf' },
    benchmarkEvidence: { url: 'https://mf.nipponindiaim.com/FundsAndPerformance/ProductNotes/NipponIndia-ETF-Nifty-50-BeES-Feb-2026.pdf' },
  };
}

test('the exact Nifty 50 ETF identity is source-ID based and requires official benchmark evidence', () => {
  assert.equal(supportsQualifiedEtfParentCategory('nifty_etf'), true);
  assert.equal(isQualifiedNiftyEtfIdentity(exactIdentity()), true);

  const wrongBenchmark = exactIdentity();
  wrongBenchmark.benchmark = { ...wrongBenchmark.benchmark, id: 'NIFTY_NEXT_50' };
  assert.equal(isQualifiedNiftyEtfIdentity(wrongBenchmark), false);

  const missingBenchmark = exactIdentity();
  missingBenchmark.benchmark = null;
  assert.equal(isQualifiedNiftyEtfIdentity(missingBenchmark), false);

  const wrongIsin = exactIdentity();
  wrongIsin.isin = 'INF204KB15I9';
  assert.equal(isQualifiedNiftyEtfIdentity(wrongIsin), false);
  const wrongOfficialDocument = exactIdentity();
  wrongOfficialDocument.benchmarkEvidence.url = 'https://mf.nipponindiaim.com/FundsAndPerformance/Pages/unrelated-scheme.aspx';
  assert.equal(isQualifiedNiftyEtfIdentity(wrongOfficialDocument), false);
  assert.equal(supportsQualifiedEtfParentCategory('sensex_etf'), false);
});

test('an exact scheme with fresh AMFI NAV is returned as one comparable option, not a ranking', () => {
  const { current, historical } = snapshots({ product: amfiProduct({ name: 'Display label may change' }) });
  const result = rankQualifiedNiftyEtfProducts({
    parentInstrumentId: 'nifty_etf',
    currentSnapshot: current,
    historicalSnapshot: historical,
  });

  assert.equal(result.products.length, 1);
  const [product] = result.products;
  assert.equal(product.id, 'etf:isin:INF204KB14I2');
  assert.equal(product.productType, 'ETF');
  assert.equal(product.name, 'Display label may change');
  assert.equal(product.benchmark.canonicalProductId, 'market:index:nifty-50');
  assert.equal(product.exchange, 'NSE');
  assert.equal(product.ticker, 'NIFTYBEES');
  assert.equal(product.isin, 'INF204KB14I2');
  assert.equal(product.nav.value, 250);
  assert.equal(product.nav.source.provider, 'AMFI');
  assert.equal(product.marketPrice.value, null);
  assert.equal(product.marketPrice.availabilityStatus, 'UNAVAILABLE');
  assert.equal(product.primaryFact.kind, 'MUTUAL_FUND_NAV');
  assert.equal(product.primaryFact.canonicalProductId, 'mf:amfi:140084');
  assert.equal(product.primaryFact.value, product.nav.value);
  assert.equal(product.historicalReturn.isExpectedReturn, false);
  assert.equal(product.returnBasis, 'HISTORICAL_POINT_TO_POINT_NAV_RETURN_1Y');
  assert.equal(product.expectedReturn, null);
  assert.equal(product.nominalReturn, null);
  assert.equal(product.postTaxReturn, null);
  assert.equal(product.expenseRatio, null);
  assert.equal(product.trackingError, null);
  assert.equal(product.trackingDifference, null);
  assert.equal(product.liquidityEvidence, null);
  assert.equal(product.riskEvidence, null);
  assert.equal(product.productTaxClassification, null);
  assert.equal(product.productEligibility.eligible, null);
  assert.equal(product.productEligibility.status, 'PARENT_SUITABILITY_PASSED_PRODUCT_ACCESS_FACTS_UNAVAILABLE');
  assert.equal(result.ranking.status, 'VERIFIED_COMPARABLE_OPTIONS');
  assert.equal(result.ranking.hasUniqueLeader, false);
  assert.equal(product.rank, null);
});

test('name-only and wrong-benchmark-like ETF rows cannot pass exact ID matching', () => {
  const wrongScheme = amfiProduct({
    schemeCode: '140085',
    isin: 'INF204KB15I9',
    name: 'Nifty 50 ETF',
  });
  const source = snapshots({
    product: wrongScheme,
    currentFact: amfiNavFact({ schemeCode: '140085' }),
  });
  const result = rankQualifiedNiftyEtfProducts({
    parentInstrumentId: 'nifty_etf',
    currentSnapshot: source.current,
    historicalSnapshot: source.historical,
  });
  assert.equal(result.products.length, 0);
  assert.equal(result.ranking.status, 'UNAVAILABLE');
});

test('wrong category, conflicting ISIN, stale NAV, and future-dated NAV fail closed', () => {
  const cases = [
    snapshots({ product: amfiProduct({ category: 'Open Ended Schemes(Equity Scheme - Large Cap Fund)' }) }),
    snapshots({ product: amfiProduct({ isin: 'INF204KB15I9' }) }),
    snapshots({ currentFact: amfiNavFact({ freshness: 'STALE' }) }),
    snapshots({ currentFact: amfiNavFact({ observedAt: '2026-10-01T10:02:00.000Z' }) }),
  ];
  for (const { current, historical } of cases) {
    const result = rankQualifiedNiftyEtfProducts({
      parentInstrumentId: 'nifty_etf', currentSnapshot: current, historicalSnapshot: historical,
    });
    assert.deepEqual(result.products, []);
  }
});

test('ambiguous duplicate product identities or current NAV facts fail closed', () => {
  const duplicateProducts = snapshots();
  duplicateProducts.current.products.push({ ...duplicateProducts.current.products[0] });
  const duplicateFacts = snapshots();
  duplicateFacts.current.facts.push({ ...duplicateFacts.current.facts[0] });

  for (const { current, historical } of [duplicateProducts, duplicateFacts]) {
    const result = rankQualifiedNiftyEtfProducts({
      parentInstrumentId: 'nifty_etf', currentSnapshot: current, historicalSnapshot: historical,
    });
    assert.deepEqual(result.products, []);
    assert.equal(result.ranking.status, 'UNAVAILABLE');
  }
});

test('provider failure or missing NAV never inserts catalog or market-price fallback values', () => {
  const sourceError = {
    provider: 'AMFI', status: 'SOURCE_ERROR', fetchedAt: NOW, products: [], facts: [],
  };
  const result = rankQualifiedNiftyEtfProducts({
    parentInstrumentId: 'nifty_etf', currentSnapshot: sourceError, historicalSnapshot: null,
  });
  assert.equal(result.products.length, 0);
  assert.equal(result.ranking.status, 'UNAVAILABLE');
});

test('WTI integrates exact ETF facts after parent suitability and preserves unavailable tax classification', async () => {
  const { current, historical } = snapshots();
  const timingEvents = [];
  const result = await rankWhereToInvestBackend(
    canonicalProfile(),
    { parentInstrumentId: 'nifty_etf' },
    {
      fetchAmfiProductSnapshot: async () => current,
      fetchAmfiHistoricalNavSnapshot: async () => historical,
      onStageTiming: event => timingEvents.push(event),
    },
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].canonicalProductId, 'etf:isin:INF204KB14I2');
  assert.equal(result[0].postTaxAnalysis.status, 'TAX_CLASSIFICATION_UNAVAILABLE');
  assert.deepEqual(result.metadata.ranking.reasonCodes.includes('NIFTY_50_BENCHMARK_VERIFIED'), true);
  assert.equal(result.metadata.catalog.providerCoverage.status, 'QUALIFIED_PROVIDER_PATH');
  assert.deepEqual(timingEvents.map(event => event.stage), ['exact_etf_qualification', 'tax_enrichment']);
  assert.ok(timingEvents.every(event => Number.isInteger(event.elapsedMs) && event.elapsedMs >= 0));
});
