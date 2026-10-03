import test from 'node:test';
import assert from 'node:assert/strict';
import NseMarketDataProvider from '../services/marketData/NseMarketDataProvider.js';
import { DEFAULT_BENCHMARK_IDS } from '../services/marketData/marketBenchmarks.js';
import { rankQualifiedNiftyEtfProducts } from '../services/niftyEtfProductRanking.js';

const NOW = '2026-10-01T10:00:00.000Z';
const AMFI_NAV_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt';

function exactAmfiProduct() {
  return {
    canonicalProductId: 'mf:amfi:140084',
    productType: 'MUTUAL_FUND',
    name: 'Nippon India ETF Nifty 50 BeES',
    providerName: 'Nippon India Mutual Fund',
    schemeCategory: 'Open Ended Schemes(Other Scheme - Other ETFs)',
    externalIds: [
      { source: 'AMFI_SCHEME_CODE', value: '140084' },
      { source: 'ISIN', value: 'INF204KB14I2' },
    ],
    source: { provider: 'AMFI', url: AMFI_NAV_URL },
  };
}

function currentNavFact() {
  return {
    kind: 'MUTUAL_FUND_NAV',
    canonicalProductId: 'mf:amfi:140084',
    value: 250,
    currency: 'INR',
    unit: 'NAV_PER_UNIT',
    observedAt: '2026-10-01T09:55:00.000Z',
    fetchedAt: NOW,
    availabilityStatus: 'AVAILABLE',
    freshness: { status: 'FRESH', ageSeconds: 300, maxAgeSeconds: 345600 },
    source: { provider: 'AMFI', instrumentId: '140084', url: AMFI_NAV_URL },
  };
}

test('direct NSE provider execution fails closed after bounded transport timeouts', async () => {
  let attempts = 0;
  const timeoutHttp = {
    get: async () => {
      attempts += 1;
      throw Object.assign(new Error('simulated transport timeout'), { code: 'ETIMEDOUT' });
    },
  };
  const provider = new NseMarketDataProvider({
    httpClient: timeoutHttp,
    holidayLoader: async () => ({ status: 'AVAILABLE', dates: [] }),
    clock: () => new Date('2026-10-01T10:00:00.000Z'),
  });

  const result = await provider.getQuotes(DEFAULT_BENCHMARK_IDS, { forceRefresh: true });

  assert.equal(attempts, 2);
  assert.equal(result.status, 'SOURCE_ERROR');
  assert.deepEqual(result.facts, []);
  assert.equal(result.error.code, 'NSE_QUOTE_FETCH_FAILED');
});

test('direct ETF qualification preserves verified current NAV but does not fabricate return when AMFI history is unavailable', () => {
  const currentSnapshot = {
    provider: 'AMFI',
    status: 'AVAILABLE',
    fetchedAt: NOW,
    products: [exactAmfiProduct()],
    facts: [currentNavFact()],
  };
  const historicalSnapshot = {
    provider: 'AMFI',
    status: 'SOURCE_ERROR',
    fetchedAt: NOW,
    facts: [],
    error: { code: 'AMFI_NAV_HISTORY_FETCH_FAILED' },
  };

  const result = rankQualifiedNiftyEtfProducts({
    parentInstrumentId: 'nifty_etf',
    currentSnapshot,
    historicalSnapshot,
  });

  assert.equal(result.products.length, 1);
  const [product] = result.products;
  assert.equal(product.nav.value, 250);
  assert.equal(product.historicalReturn, null);
  assert.equal(product.returnBasis, null);
  assert.equal(product.expectedReturn, null);
  assert.equal(result.comparisonUniverse.historicalSnapshotStatus, 'SOURCE_ERROR');
});
