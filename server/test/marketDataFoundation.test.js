import assert from 'node:assert/strict';
import test from 'node:test';
import AmfiNavProvider, { parseAmfiNavReport } from '../services/marketData/AmfiNavProvider.js';
import AmfiNavHistoryProvider from '../services/marketData/AmfiNavHistoryProvider.js';
import { fetchAmfiHistoricalNavSnapshot, fetchAmfiProductSnapshot } from '../services/marketDataService.js';
import UpstoxMarketDataProvider from '../services/marketData/UpstoxMarketDataProvider.js';
import UpstoxHistoricalCandleProvider, {
  parseUpstoxDailyCandles,
} from '../services/marketData/UpstoxHistoricalCandleProvider.js';
import {
  AVAILABILITY,
  FRESHNESS,
  nullableFiniteNumber,
} from '../services/marketData/contracts.js';
import { buildAmfiProductIdentity } from '../services/marketData/productIdentity.js';
import {
  clearInFlightMarketRequestsForTest,
  coalesceMarketRequest,
  readThroughMarketCache,
} from '../services/marketData/requestCache.js';
import {
  buildObservationOperations,
  buildHistoryObservationOperations,
  buildProductOperations,
  persistVerifiedMarketSnapshot,
} from '../services/marketData/MarketDataRepository.js';
import { setRedisAvailable, setRedisClient } from '../config/redis.js';

const FIXED_NOW = new Date('2026-09-08T12:00:00.000Z');
const AMFI_REPORT = [
  'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date',
  'Open Ended Schemes (Equity Scheme - Large Cap Fund)',
  'Example Mutual Fund',
  '123;INF000A01010;;Example Large Cap Fund;Direct;Growth;12.34;07-Sep-2026',
  '124;;;Example Missing NAV Fund;Regular;Growth;;07-Sep-2026',
].join('\n');

const AMFI_REPORT_WITHOUT_PLAN_OPTION = [
  'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date',
  'Example Mutual Fund',
  '125;INF000A01028;;Example Legacy Format Fund;25.50;07-Sep-2026',
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

test('WTI AMFI timing reports fetch and persistence stages without provider payloads', async () => {
  const currentDescriptor = Object.getOwnPropertyDescriptor(AmfiNavProvider.prototype, 'getSnapshot');
  const historyDescriptor = Object.getOwnPropertyDescriptor(AmfiNavHistoryProvider.prototype, 'getSnapshot');
  const sourceError = { provider: 'AMFI', status: AVAILABILITY.SOURCE_ERROR, products: [], facts: [] };
  const events = [];
  try {
    AmfiNavProvider.prototype.getSnapshot = async () => ({ ...sourceError, fetchedAt: FIXED_NOW.toISOString() });
    AmfiNavHistoryProvider.prototype.getSnapshot = async () => ({ ...sourceError, fetchedAt: FIXED_NOW.toISOString() });
    const current = await fetchAmfiProductSnapshot({ onStageTiming: event => events.push(event) });
    const historical = await fetchAmfiHistoricalNavSnapshot({ targetDate: '2025-09-07', onStageTiming: event => events.push(event) });
    const callbackFailure = await fetchAmfiProductSnapshot({ persist: false, onStageTiming: () => { throw new Error('diagnostics must be non-authoritative'); } });
    const readOnly = await fetchAmfiProductSnapshot({ persist: false, onStageTiming: event => events.push(event) });

    assert.equal(current.persistence.status, 'NOT_PERSISTED');
    assert.equal(historical.persistence.status, 'NOT_PERSISTED');
    assert.equal(callbackFailure.status, AVAILABILITY.SOURCE_ERROR);
    assert.deepEqual(readOnly.persistence, { status: 'NOT_REQUESTED', code: 'PERSISTENCE_NOT_REQUESTED' });
    assert.deepEqual(events.map(event => event.stage), [
      'amfi_current_fetch', 'amfi_current_persistence',
      'amfi_historical_fetch', 'amfi_historical_persistence',
      'amfi_current_fetch', 'amfi_current_persistence',
    ]);
    assert.deepEqual(events.map(event => event.status), [
      AVAILABILITY.SOURCE_ERROR, 'NOT_PERSISTED',
      AVAILABILITY.SOURCE_ERROR, 'NOT_PERSISTED',
      AVAILABILITY.SOURCE_ERROR, 'NOT_REQUESTED',
    ]);
    assert.equal(events.at(-1).code, 'PERSISTENCE_NOT_REQUESTED');
    for (const event of events) {
      assert.equal(event.provider, 'AMFI');
      assert.ok(Number.isInteger(event.elapsedMs) && event.elapsedMs >= 0);
      assert.equal(Object.hasOwn(event, 'payload'), false);
    }
  } finally {
    if (currentDescriptor) Object.defineProperty(AmfiNavProvider.prototype, 'getSnapshot', currentDescriptor);
    if (historyDescriptor) Object.defineProperty(AmfiNavHistoryProvider.prototype, 'getSnapshot', historyDescriptor);
  }
});

test('AMFI reports without separate Plan and Option columns leave classifications unestablished', () => {
  const snapshot = parseAmfiNavReport(AMFI_REPORT_WITHOUT_PLAN_OPTION, {
    fetchedAt: FIXED_NOW.toISOString(),
    now: FIXED_NOW,
  });
  assert.equal(snapshot.products[0].plan, null);
  assert.equal(snapshot.products[0].option, null);
  assert.equal(snapshot.facts[0].value, 25.5);
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
                prev_close_price: 24875.5,
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
  assert.equal(snapshot.facts[0].canonicalProductId, 'market:index:nifty-50');
  assert.equal(snapshot.facts[0].source.instrumentId, 'NSE_INDEX|Nifty 50');
  assert.equal(snapshot.facts[0].metrics.close, 24980);
  assert.equal(snapshot.facts[0].metrics.previousClose, 24875.5);
  assert.notEqual(snapshot.facts[0].metrics.previousClose, snapshot.facts[0].metrics.close);
  assert.equal(snapshot.facts[1].value, null);
  assert.equal(snapshot.facts[1].availabilityStatus, AVAILABILITY.UNAVAILABLE);
});

test('Upstox V3 historical candles are normalized, sorted, and source timestamped', () => {
  const snapshot = parseUpstoxDailyCandles({
    data: {
      candles: [
        ['2026-09-07T00:00:00+05:30', 25000, 25200, 24900, 25100, 1000, 0],
        ['2026-09-06T00:00:00+05:30', 24800, 25100, 24700, 25000, 900, 0],
        ['invalid', 0, 0, 0, 0, 0, 0],
      ],
    },
  }, {
    instrumentKey: 'NSE_INDEX|Nifty 50',
    fetchedAt: FIXED_NOW.toISOString(),
    now: FIXED_NOW,
    sourceUrl: 'https://api.upstox.com/v3/historical-candle/NSE_INDEX%7CNifty%2050/days/1/2026-09-07/2025-08-03',
  });
  assert.equal(snapshot.status, AVAILABILITY.AVAILABLE);
  assert.equal(snapshot.candleCount, 2);
  assert.equal(snapshot.candles[0].close, 25000);
  assert.equal(snapshot.candles[1].close, 25100);
  assert.equal(snapshot.observedAt, '2026-09-06T18:30:00.000Z');
  assert.equal(snapshot.freshness.status, FRESHNESS.FRESH);
  assert.match(snapshot.source.url, /^https:\/\/api\.upstox\.com\/v3\/historical-candle/);
});

test('Upstox history returns PROVIDER_NOT_CONFIGURED without a request or fallback candles', async () => {
  let calls = 0;
  const provider = new UpstoxHistoricalCandleProvider({
    accessToken: '',
    clock: () => FIXED_NOW,
    httpClient: { get: async () => { calls += 1; } },
  });
  const snapshot = await provider.getDailyCandles('NSE_INDEX|Nifty 50', {
    fromDate: '2025-08-03',
    toDate: '2026-09-07',
  });
  assert.equal(snapshot.status, AVAILABILITY.PROVIDER_NOT_CONFIGURED);
  assert.deepEqual(snapshot.candles, []);
  assert.equal(snapshot.error.code, 'PROVIDER_NOT_CONFIGURED');
  assert.equal(calls, 0);
});

test('Upstox history uses the shared Redis read-through cache instead of refetching', async () => {
  const values = new Map();
  setRedisClient({
    get: async key => values.get(key) ?? null,
    setEx: async (key, _ttl, value) => { values.set(key, value); },
  });
  setRedisAvailable(true);
  let calls = 0;
  try {
    const provider = new UpstoxHistoricalCandleProvider({
      accessToken: 'test-token-not-a-real-secret',
      clock: () => FIXED_NOW,
      httpClient: {
        get: async () => {
          calls += 1;
          return { data: { data: { candles: [
            ['2026-09-07T00:00:00+05:30', 25000, 25200, 24900, 25100, 1000, 0],
          ] } } };
        },
      },
    });
    const request = { fromDate: '2025-08-03', toDate: '2026-09-07' };
    const first = await provider.getDailyCandles('NSE_INDEX|Nifty 50', request);
    const second = await provider.getDailyCandles('NSE_INDEX|Nifty 50', request);
    assert.equal(first.cache.hit, false);
    assert.equal(second.cache.hit, true);
    assert.equal(second.cache.backend, 'REDIS');
    assert.equal(calls, 1);
  } finally {
    setRedisAvailable(false);
    setRedisClient(null);
  }
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

test('Redis-unavailable AMFI read-through remains usable and coalesces concurrent provider loads', async () => {
  setRedisAvailable(false);
  setRedisClient(null);
  clearInFlightMarketRequestsForTest();
  let calls = 0;
  let signalLoader;
  const loaderStarted = new Promise(resolve => { signalLoader = resolve; });
  let releaseLoader;
  const gate = new Promise(resolve => { releaseLoader = resolve; });
  const snapshot = parseAmfiNavReport(AMFI_REPORT, {
    fetchedAt: FIXED_NOW.toISOString(),
    now: FIXED_NOW,
  });
  const read = () => readThroughMarketCache({
    cacheKey: 'test:amfi:redis-unavailable',
    ttlSeconds: 60,
    loader: async () => {
      calls += 1;
      signalLoader();
      await gate;
      return snapshot;
    },
  });

  try {
    const first = read();
    await loaderStarted;
    const second = read();
    releaseLoader();
    const results = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.equal(results[0].status, AVAILABILITY.PARTIAL);
    assert.equal(results[1].status, AVAILABILITY.PARTIAL);
    assert.deepEqual(results[0].facts, results[1].facts);
    assert.equal(results[0].fetchedAt, FIXED_NOW.toISOString());
  } finally {
    setRedisAvailable(false);
    setRedisClient(null);
    clearInFlightMarketRequestsForTest();
  }
});

test('Redis cache hits preserve AMFI source, observation, fetched-time, and freshness provenance', async () => {
  const snapshot = parseAmfiNavReport(AMFI_REPORT, {
    fetchedAt: FIXED_NOW.toISOString(),
    now: FIXED_NOW,
  });
  snapshot.cacheMetadata = { cachedAt: '2026-09-08T12:01:00.000Z' };
  let loaderCalls = 0;
  let writes = 0;
  setRedisClient({
    get: async () => JSON.stringify(snapshot),
    setEx: async () => { writes += 1; },
  });
  setRedisAvailable(true);

  try {
    const result = await readThroughMarketCache({
      cacheKey: 'test:amfi:provenance-hit',
      ttlSeconds: 60,
      loader: async () => { loaderCalls += 1; return null; },
    });
    assert.equal(loaderCalls, 0);
    assert.equal(writes, 0);
    assert.equal(result.cache.hit, true);
    assert.equal(result.fetchedAt, snapshot.fetchedAt);
    assert.deepEqual(result.products, snapshot.products);
    assert.deepEqual(result.facts, snapshot.facts);
    assert.deepEqual(result.cacheMetadata, snapshot.cacheMetadata);
  } finally {
    setRedisAvailable(false);
    setRedisClient(null);
  }
});

test('AMFI cache hits recompute freshness at read time without rewriting source provenance', async () => {
  const cachedAt = new Date('2026-09-08T12:00:00.000Z');
  const consumedAt = new Date('2026-09-12T12:00:01.000Z');
  const cachedSnapshot = parseAmfiNavReport(AMFI_REPORT, {
    fetchedAt: cachedAt.toISOString(),
    now: cachedAt,
  });
  const originalFact = cachedSnapshot.facts[0];
  let sourceCalls = 0;
  setRedisClient({
    get: async () => JSON.stringify(cachedSnapshot),
    setEx: async () => assert.fail('A Redis cache hit must not rewrite the cache.'),
  });
  setRedisAvailable(true);

  try {
    const provider = new AmfiNavProvider({
      clock: () => consumedAt,
      httpClient: { get: async () => { sourceCalls += 1; throw new Error('unexpected source request'); } },
    });
    const result = await provider.getSnapshot();
    const fact = result.facts[0];

    assert.equal(result.cache.hit, true);
    assert.equal(sourceCalls, 0);
    assert.equal(fact.freshness.status, FRESHNESS.STALE);
    assert.ok(fact.freshness.ageSeconds > fact.freshness.maxAgeSeconds);
    assert.equal(fact.observedAt, originalFact.observedAt);
    assert.equal(fact.fetchedAt, originalFact.fetchedAt);
    assert.deepEqual(fact.source, originalFact.source);
    assert.equal(fact.value, originalFact.value);
  } finally {
    setRedisAvailable(false);
    setRedisClient(null);
  }
});

test('AMFI SOURCE_ERROR results are neither cached nor reused as valid data', async () => {
  let loaderCalls = 0;
  let cacheWrites = 0;
  setRedisClient({
    get: async () => null,
    setEx: async () => { cacheWrites += 1; },
  });
  setRedisAvailable(true);

  try {
    const load = () => readThroughMarketCache({
      cacheKey: 'test:amfi:source-error',
      ttlSeconds: 60,
      loader: async () => {
        loaderCalls += 1;
        return {
          provider: 'AMFI',
          status: AVAILABILITY.SOURCE_ERROR,
          products: [],
          facts: [],
        };
      },
    });
    const first = await load();
    const second = await load();
    assert.equal(first.status, AVAILABILITY.SOURCE_ERROR);
    assert.equal(second.status, AVAILABILITY.SOURCE_ERROR);
    assert.equal(loaderCalls, 2);
    assert.equal(cacheWrites, 0);
  } finally {
    setRedisAvailable(false);
    setRedisClient(null);
  }
});

test('concurrent persistence of one AMFI snapshot performs one complete product/observation pass', async () => {
  const snapshot = parseAmfiNavReport(AMFI_REPORT, {
    fetchedAt: FIXED_NOW.toISOString(),
    now: FIXED_NOW,
  });
  let productPasses = 0;
  let observationPasses = 0;
  let signalBulkWrite;
  const bulkWriteStarted = new Promise(resolve => { signalBulkWrite = resolve; });
  let releaseBulkWrite;
  const gate = new Promise(resolve => { releaseBulkWrite = resolve; });
  const ProductModel = {
    bulkWrite: async operations => {
      productPasses += 1;
      assert.equal(operations.length, snapshot.products.length);
      signalBulkWrite();
      await gate;
    },
  };
  const ObservationModel = {
    bulkWrite: async operations => {
      observationPasses += 1;
      assert.equal(operations.length, snapshot.facts.filter(fact => fact.availabilityStatus === AVAILABILITY.AVAILABLE).length);
    },
  };

  const first = persistVerifiedMarketSnapshot(snapshot, { ProductModel, ObservationModel });
  await bulkWriteStarted;
  const second = persistVerifiedMarketSnapshot(snapshot, { ProductModel, ObservationModel });
  releaseBulkWrite();
  const results = await Promise.all([first, second]);

  assert.equal(productPasses, 1);
  assert.equal(observationPasses, 1);
  assert.equal(results[0].status, 'PERSISTED');
  assert.equal(results[1].status, 'PERSISTED');
  assert.equal(results[1].coalesced, true);
});

test('snapshot persistence coalescing is isolated by injected model pair', async () => {
  const snapshot = parseAmfiNavReport(AMFI_REPORT, {
    fetchedAt: FIXED_NOW.toISOString(),
    now: FIXED_NOW,
  });
  let productWritesStarted = 0;
  let signalBothProductWrites;
  const bothProductWritesStarted = new Promise(resolve => { signalBothProductWrites = resolve; });
  let releaseProductWrites;
  const productWriteGate = new Promise(resolve => { releaseProductWrites = resolve; });
  const observationWrites = [0, 0];
  const makeModels = index => ({
    ProductModel: {
      bulkWrite: async () => {
        productWritesStarted += 1;
        if (productWritesStarted === 2) signalBothProductWrites();
        await productWriteGate;
      },
    },
    ObservationModel: {
      bulkWrite: async () => { observationWrites[index] += 1; },
    },
  });

  const first = persistVerifiedMarketSnapshot(snapshot, makeModels(0));
  const second = persistVerifiedMarketSnapshot(snapshot, makeModels(1));
  await bothProductWritesStarted;
  releaseProductWrites();
  const results = await Promise.all([first, second]);

  assert.equal(productWritesStarted, 2);
  assert.deepEqual(observationWrites, [1, 1]);
  assert.equal(results[0].status, 'PERSISTED');
  assert.equal(results[1].status, 'PERSISTED');
  assert.equal(results.some(result => result.coalesced), false);
});

test('concurrent Redis-off AMFI consumers share one fetch and one full durable persistence pass', async () => {
  setRedisAvailable(false);
  setRedisClient(null);
  clearInFlightMarketRequestsForTest();
  const snapshot = parseAmfiNavReport(AMFI_REPORT, {
    fetchedAt: FIXED_NOW.toISOString(),
    now: FIXED_NOW,
  });
  let providerCalls = 0;
  let signalProvider;
  const providerStarted = new Promise(resolve => { signalProvider = resolve; });
  let releaseProvider;
  const providerGate = new Promise(resolve => { releaseProvider = resolve; });
  const fetch = () => readThroughMarketCache({
    cacheKey: 'test:amfi:concurrent-durable-snapshot',
    ttlSeconds: 60,
    loader: async () => {
      providerCalls += 1;
      signalProvider();
      await providerGate;
      return snapshot;
    },
  });
  let productWrites = 0;
  let observationWrites = 0;
  let signalWrite;
  const writeStarted = new Promise(resolve => { signalWrite = resolve; });
  let releaseWrite;
  const writeGate = new Promise(resolve => { releaseWrite = resolve; });
  const ProductModel = {
    bulkWrite: async () => {
      productWrites += 1;
      signalWrite();
      await writeGate;
    },
  };
  const ObservationModel = {
    bulkWrite: async () => { observationWrites += 1; },
  };

  try {
    const firstRead = fetch();
    await providerStarted;
    const secondRead = fetch();
    releaseProvider();
    const snapshotsForConsumers = await Promise.all([firstRead, secondRead]);
    assert.equal(providerCalls, 1);
    assert.strictEqual(snapshotsForConsumers[0], snapshotsForConsumers[1]);

    const firstPersist = persistVerifiedMarketSnapshot(snapshotsForConsumers[0], { ProductModel, ObservationModel });
    await writeStarted;
    const secondPersist = persistVerifiedMarketSnapshot(snapshotsForConsumers[1], { ProductModel, ObservationModel });
    releaseWrite();
    const outcomes = await Promise.all([firstPersist, secondPersist]);
    assert.equal(productWrites, 1);
    assert.equal(observationWrites, 1);
    assert.equal(outcomes[0].status, 'PERSISTED');
    assert.equal(outcomes[1].status, 'PERSISTED');
    assert.equal(outcomes[1].coalesced, true);
  } finally {
    setRedisAvailable(false);
    setRedisClient(null);
    clearInFlightMarketRequestsForTest();
  }
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

test('durable history observations preserve candle semantics without treating cache age as observation age', () => {
  const snapshot = {
    schemaVersion: 'market-fact-1.0.0',
    status: AVAILABILITY.AVAILABLE,
    instrumentKey: 'market:index:nifty-50',
    dataClass: 'DAILY',
    fetchedAt: FIXED_NOW.toISOString(),
    freshness: { status: FRESHNESS.FRESH, ageSeconds: 60, maxAgeSeconds: 345600 },
    source: { provider: 'NSE', instrumentId: 'NIFTY 50', url: 'https://www.nseindia.com/api/historicalOR/indicesHistory' },
    candles: [{
      timestamp: '2026-09-07T10:00:00.000Z',
      effectiveTradingDate: '2026-09-07',
      open: 100,
      high: 110,
      low: 90,
      close: 105,
    }],
  };
  const [operation] = buildHistoryObservationOperations(snapshot);
  assert.equal(operation.updateOne.filter.kind, 'MARKET_HISTORY_CANDLE');
  assert.equal(operation.updateOne.update.$set.value, 105);
  assert.equal(operation.updateOne.update.$set.observedAt.toISOString(), '2026-09-07T10:00:00.000Z');
  assert.equal(operation.updateOne.update.$set.lastFetchedAt.toISOString(), FIXED_NOW.toISOString());
  assert.equal(operation.updateOne.update.$set.metrics.high, 110);
});
