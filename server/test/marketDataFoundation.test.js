import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAmfiNavReport } from '../services/marketData/AmfiNavProvider.js';
import UpstoxMarketDataProvider from '../services/marketData/UpstoxMarketDataProvider.js';
import {
  AVAILABILITY,
  FRESHNESS,
  nullableFiniteNumber,
} from '../services/marketData/contracts.js';
import { buildAmfiProductIdentity } from '../services/marketData/productIdentity.js';
import {
  clearInFlightMarketRequestsForTest,
  coalesceMarketRequest,
} from '../services/marketData/requestCache.js';
import {
  buildObservationOperations,
  buildProductOperations,
  persistVerifiedMarketSnapshot,
} from '../services/marketData/MarketDataRepository.js';

const FIXED_NOW = new Date('2026-09-08T12:00:00.000Z');
const AMFI_REPORT = [
  'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date',
  'Open Ended Schemes (Equity Scheme - Large Cap Fund)',
  'Example Mutual Fund',
  '123;INF000A01010;;Example Large Cap Fund;Direct;Growth;12.34;07-Sep-2026',
  '124;;;Example Missing NAV Fund;Regular;Growth;;07-Sep-2026',
].join('\n');

test('AMFI current header is mapped by name and valuation date/provenance are preserved', () => {
  const snapshot = parseAmfiNavReport(AMFI_REPORT, {
    fetchedAt: FIXED_NOW.toISOString(),
    now: FIXED_NOW,
  });
  assert.equal(snapshot.provider, 'AMFI');
  assert.equal(snapshot.status, AVAILABILITY.PARTIAL);
  assert.equal(snapshot.productCount, 2);
  assert.equal(snapshot.availableFactCount, 1);
  assert.equal(snapshot.products[0].canonicalProductId, 'mf:amfi:123');
  assert.equal(snapshot.products[0].providerName, 'Example Mutual Fund');
  assert.equal(snapshot.products[0].plan, 'Direct');
  assert.equal(snapshot.products[0].option, 'Growth');
  assert.equal(snapshot.facts[0].value, 12.34);
  assert.equal(snapshot.facts[0].observedDate, '2026-09-07');
  assert.equal(snapshot.facts[0].source.url, 'https://portal.amfiindia.com/spages/NAVAll.txt');
  assert.equal(snapshot.facts[0].freshness.status, FRESHNESS.FRESH);
});

test('missing financial values remain null and unavailable instead of becoming zero', () => {
  const snapshot = parseAmfiNavReport(AMFI_REPORT, {
    fetchedAt: FIXED_NOW.toISOString(),
    now: FIXED_NOW,
  });
  assert.equal(nullableFiniteNumber(null), null);
  assert.equal(nullableFiniteNumber(''), null);
  assert.equal(nullableFiniteNumber('not-a-number'), null);
  assert.equal(nullableFiniteNumber(0), 0);
  assert.equal(snapshot.facts[1].value, null);
  assert.equal(snapshot.facts[1].availabilityStatus, AVAILABILITY.UNAVAILABLE);
});

test('AMFI product identity is stable and retains valid ISIN cross-references', () => {
  const identity = buildAmfiProductIdentity({
    schemeCode: '123',
    primaryIsin: 'inf000a01010',
    secondaryIsin: 'invalid',
  });
  assert.equal(identity.canonicalProductId, 'mf:amfi:123');
  assert.deepEqual(identity.externalIds, [
    { source: 'AMFI_SCHEME_CODE', value: '123' },
    { source: 'ISIN', value: 'INF000A01010' },
  ]);
});

test('Upstox adapter returns PROVIDER_NOT_CONFIGURED without making a request', async () => {
  let calls = 0;
  const provider = new UpstoxMarketDataProvider({
    accessToken: '',
    clock: () => FIXED_NOW,
    httpClient: { get: async () => { calls += 1; } },
  });
  const snapshot = await provider.getQuotes(['NSE_INDEX|Nifty 50']);
  assert.equal(snapshot.status, AVAILABILITY.PROVIDER_NOT_CONFIGURED);
  assert.equal(snapshot.availableFactCount, 0);
  assert.deepEqual(snapshot.facts, []);
  assert.equal(calls, 0);
});

test('Upstox adapter normalizes a verified quote and preserves a missing quote as unavailable', async () => {
  const provider = new UpstoxMarketDataProvider({
    accessToken: 'test-token-not-a-real-secret',
    clock: () => FIXED_NOW,
    httpClient: {
      get: async (_url, config) => {
        assert.equal(config.params.instrument_key, 'NSE_INDEX|Nifty 50,NSE_INDEX|India VIX');
        assert.match(config.headers.Authorization, /^Bearer /);
        return {
          data: {
            data: {
              'NSE_INDEX|Nifty 50': {
                instrument_token: 'NSE_INDEX|Nifty 50',
                last_price: 25123.45,
                last_trade_time: '2026-09-08T11:59:30.000Z',
                ohlc: { open: 25000, high: 25200, low: 24900, close: 24980 },
                volume: 1200,
              },
            },
          },
          headers: {},
        };
      },
    },
  });
  const snapshot = await provider.getQuotes(
    ['NSE_INDEX|Nifty 50', 'NSE_INDEX|India VIX'],
    { forceRefresh: true },
  );
  assert.equal(snapshot.status, AVAILABILITY.PARTIAL);
  assert.equal(snapshot.availableFactCount, 1);
  assert.equal(snapshot.facts[0].value, 25123.45);
  assert.equal(snapshot.facts[0].source.instrumentId, 'NSE_INDEX|Nifty 50');
  assert.equal(snapshot.facts[0].metrics.previousClose, 24980);
  assert.equal(snapshot.facts[1].value, null);
  assert.equal(snapshot.facts[1].availabilityStatus, AVAILABILITY.UNAVAILABLE);
});

test('request coalescing executes one loader for concurrent identical requests', async () => {
  clearInFlightMarketRequestsForTest();
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const loader = async () => {
    calls += 1;
    await gate;
    return { status: 'AVAILABLE' };
  };
  const first = coalesceMarketRequest('same-key', loader);
  const second = coalesceMarketRequest('same-key', loader);
  release();
  assert.deepEqual(await Promise.all([first, second]), [
    { status: 'AVAILABLE' },
    { status: 'AVAILABLE' },
  ]);
  assert.equal(calls, 1);
});

test('persistence operations include only verified numeric observations', async () => {
  const snapshot = parseAmfiNavReport(AMFI_REPORT, {
    fetchedAt: FIXED_NOW.toISOString(),
    now: FIXED_NOW,
  });
  assert.equal(buildProductOperations(snapshot).length, 2);
  assert.equal(buildObservationOperations(snapshot).length, 1);

  const calls = [];
  const ProductModel = { bulkWrite: async operations => calls.push(['products', operations.length]) };
  const ObservationModel = { bulkWrite: async operations => calls.push(['facts', operations.length]) };
  const result = await persistVerifiedMarketSnapshot(snapshot, { ProductModel, ObservationModel });
  assert.equal(result.status, 'PERSISTED');
  assert.deepEqual(calls, [['products', 2], ['facts', 1]]);
});
