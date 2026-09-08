import test from 'node:test';
import assert from 'node:assert/strict';
import NseMarketDataProvider, {
  NSE_ALL_INDICES_URL,
  parseNseIndexQuotes,
} from '../services/marketData/NseMarketDataProvider.js';
import NseHistoricalDataProvider, {
  buildNseHistoryWindows,
  parseNseHistoricalData,
} from '../services/marketData/NseHistoricalDataProvider.js';
import { MARKET_BENCHMARKS, DEFAULT_BENCHMARK_IDS } from '../services/marketData/marketBenchmarks.js';
import {
  evaluateNseQuoteFreshness,
  parseNseTradingHolidays,
} from '../services/marketData/nseTradingCalendar.js';
import { clearInFlightMarketRequestsForTest } from '../services/marketData/requestCache.js';
import { setRedisAvailable, setRedisClient } from '../config/redis.js';
import { computeMarketContextFeatures } from '../services/marketContextFeatureEngine.js';

const FETCHED_AT = '2026-09-08T10:01:00.000Z';
const QUOTE_PAYLOAD = Object.freeze({
  timestamp: '08-Sep-2026 15:30',
  data: [
    {
      index: 'NIFTY 50', last: 23635.1, previousClose: 23779.15,
      open: 23743.1, high: 23758.95, low: 23623.1,
    },
    {
      index: 'INDIA VIX', last: 11.1, previousClose: 11.16,
      open: 11.16, high: 11.4, low: 10.45,
    },
  ],
});

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function historyRow(isoDate, close, overrides = {}) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  const providerTimestamp = new Date(date.getTime() - 330 * 60 * 1000).toISOString();
  const displayDate = `${String(date.getUTCDate()).padStart(2, '0')}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
  return {
    EOD_INDEX_NAME: 'NIFTY 50',
    EOD_OPEN_INDEX_VAL: close - 2,
    EOD_HIGH_INDEX_VAL: close + 5,
    EOD_CLOSE_INDEX_VAL: close,
    EOD_LOW_INDEX_VAL: close - 5,
    HIT_TURN_OVER: 10000,
    HIT_TRADED_QTY: 100000,
    EOD_TIMESTAMP: displayDate,
    HI_TIMESTAMP: providerTimestamp,
    ...overrides,
  };
}

function makeHistory(count, endDate = '2026-09-07') {
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(end.getTime() - index * 86400000);
    return historyRow(date.toISOString().slice(0, 10), 24000 - index * 3);
  });
}

test('official NSE allIndices fixture maps current NIFTY, previous close, VIX, and provenance', () => {
  const snapshot = parseNseIndexQuotes(QUOTE_PAYLOAD, {
    fetchedAt: FETCHED_AT,
    now: new Date('2026-09-08T10:01:00.000Z'),
  });
  assert.equal(snapshot.provider, 'NSE');
  assert.equal(snapshot.status, 'AVAILABLE');
  assert.equal(snapshot.dataClass, 'LIVE');
  assert.equal(snapshot.providerTimestamp, '2026-09-08T10:00:00.000Z');
  assert.equal(snapshot.effectiveTradingDate, '2026-09-08');
  assert.equal(snapshot.facts[0].canonicalProductId, MARKET_BENCHMARKS.NIFTY_50.canonicalProductId);
  assert.equal(snapshot.facts[0].value, 23635.1);
  assert.equal(snapshot.facts[0].metrics.previousClose, 23779.15);
  assert.equal(snapshot.facts[1].canonicalProductId, MARKET_BENCHMARKS.INDIA_VIX.canonicalProductId);
  assert.equal(snapshot.facts[1].value, 11.1);
  assert.equal(snapshot.facts[0].source.url, NSE_ALL_INDICES_URL);
  assert.equal(snapshot.facts[0].freshness.status, 'FRESH');
});

test('NSE quote schema drift and missing required facts fail closed without numeric fallbacks', () => {
  const options = { fetchedAt: FETCHED_AT, now: new Date(FETCHED_AT) };
  assert.throws(() => parseNseIndexQuotes({ timestamp: QUOTE_PAYLOAD.timestamp }, options), /SCHEMA_MISMATCH:data/);
  assert.throws(() => parseNseIndexQuotes({ data: QUOTE_PAYLOAD.data, timestamp: 'unknown' }, options), /SCHEMA_MISMATCH:timestamp/);

  const missingNifty = parseNseIndexQuotes({ ...QUOTE_PAYLOAD, data: [QUOTE_PAYLOAD.data[1]] }, options);
  assert.equal(missingNifty.status, 'PARTIAL');
  assert.equal(missingNifty.facts[0].availabilityStatus, 'UNAVAILABLE');
  assert.equal(missingNifty.facts[0].value, null);

  const missingVix = parseNseIndexQuotes({ ...QUOTE_PAYLOAD, data: [QUOTE_PAYLOAD.data[0]] }, options);
  assert.equal(missingVix.status, 'PARTIAL');
  assert.equal(missingVix.facts[1].availabilityStatus, 'UNAVAILABLE');

  const withoutPreviousClose = structuredClone(QUOTE_PAYLOAD);
  delete withoutPreviousClose.data[0].previousClose;
  const missingClose = parseNseIndexQuotes(withoutPreviousClose, options);
  assert.equal(missingClose.status, 'PARTIAL');
  assert.equal(missingClose.facts[0].metrics.previousClose, null);
  assert.equal(missingClose.facts[0].availabilityStatus, 'UNAVAILABLE');
});

test('NSE quote freshness distinguishes open market, closed market, weekend, and exchange holiday', () => {
  const preMarket = evaluateNseQuoteFreshness({
    observedAt: '2026-09-07T10:00:00.000Z',
    fetchedAt: '2026-09-08T03:30:00.000Z',
    now: new Date('2026-09-08T03:30:00.000Z'),
  });
  assert.equal(preMarket.status, 'FRESH');

  const current = evaluateNseQuoteFreshness({
    observedAt: '2026-09-08T06:30:00.000Z',
    fetchedAt: '2026-09-08T06:31:00.000Z',
    now: new Date('2026-09-08T06:31:00.000Z'),
  });
  assert.equal(current.status, 'FRESH');

  const staleDuringMarket = evaluateNseQuoteFreshness({
    observedAt: '2026-09-08T05:30:00.000Z',
    fetchedAt: '2026-09-08T06:31:00.000Z',
    now: new Date('2026-09-08T06:31:00.000Z'),
  });
  assert.equal(staleDuringMarket.status, 'STALE');

  const afterClose = evaluateNseQuoteFreshness({
    observedAt: '2026-09-08T10:00:00.000Z',
    fetchedAt: '2026-09-08T14:30:00.000Z',
    now: new Date('2026-09-08T14:30:00.000Z'),
  });
  assert.equal(afterClose.status, 'FRESH');

  const weekend = evaluateNseQuoteFreshness({
    observedAt: '2026-09-04T10:00:00.000Z',
    fetchedAt: '2026-09-06T06:30:00.000Z',
    now: new Date('2026-09-06T06:30:00.000Z'),
  });
  assert.equal(weekend.status, 'FRESH');

  const mondayHoliday = evaluateNseQuoteFreshness({
    observedAt: '2026-09-04T10:00:00.000Z',
    fetchedAt: '2026-09-07T06:30:00.000Z',
    now: new Date('2026-09-07T06:30:00.000Z'),
    holidayDates: ['2026-09-07'],
  });
  assert.equal(mondayHoliday.status, 'FRESH');
});

test('NSE capital-market holiday schema is strict and deduplicated', () => {
  assert.deepEqual(parseNseTradingHolidays({
    CM: [
      { tradingDate: '15-Jan-2026' },
      { tradingDate: '15-Jan-2026' },
      { tradingDate: '25-Dec-2026' },
    ],
  }), ['2026-01-15', '2026-12-25']);
  assert.throws(() => parseNseTradingHolidays({}), /SCHEMA_MISMATCH:CM/);
  assert.throws(() => parseNseTradingHolidays({ CM: [{ tradingDate: 'bad' }] }), /CM\[0\]/);
});

test('NSE historical parser sorts unordered rows and removes exact duplicates', () => {
  const duplicate = historyRow('2026-09-05', 24010);
  const snapshot = parseNseHistoricalData({
    data: [historyRow('2026-09-07', 24020), duplicate, historyRow('2026-09-06', 24015), { ...duplicate }],
  }, {
    fetchedAt: '2026-09-08T04:00:00.000Z',
    fromDate: '2026-09-01',
    toDate: '2026-09-07',
    now: new Date('2026-09-08T04:00:00.000Z'),
  });
  assert.equal(snapshot.candleCount, 3);
  assert.equal(snapshot.duplicateRowCount, 1);
  assert.deepEqual(snapshot.candles.map(candle => candle.effectiveTradingDate), [
    '2026-09-05', '2026-09-06', '2026-09-07',
  ]);
  assert.equal(snapshot.freshness.status, 'FRESH');
});

test('malformed OHLC, conflicting duplicates, schema drift, and stale history are rejected', () => {
  const options = {
    fetchedAt: '2026-09-08T04:00:00.000Z',
    fromDate: '2026-09-01',
    toDate: '2026-09-07',
    now: new Date('2026-09-08T04:00:00.000Z'),
  };
  assert.throws(() => parseNseHistoricalData({}, options), /SCHEMA_MISMATCH:data/);
  assert.throws(() => parseNseHistoricalData({ data: [
    historyRow('2026-09-07', 24020, { EOD_HIGH_INDEX_VAL: 23000 }),
  ] }, options), /INVALID_ROW/);
  assert.throws(() => parseNseHistoricalData({ data: [
    historyRow('2026-09-07', 24020),
    historyRow('2026-09-07', 24021),
  ] }, options), /CONFLICTING_DUPLICATE/);

  const stale = parseNseHistoricalData({ data: [historyRow('2026-09-04', 24000)] }, options);
  assert.equal(stale.freshness.status, 'STALE');
});

test('NSE history windows are bounded and cover the requested range without overlap', () => {
  const windows = buildNseHistoryWindows('2025-08-03', '2026-09-07');
  assert.equal(windows[0].fromDate, '2025-08-03');
  assert.equal(windows.at(-1).toDate, '2026-09-07');
  assert(windows.length >= 5);
  windows.forEach(window => {
    const days = ((Date.parse(`${window.toDate}T00:00:00Z`) - Date.parse(`${window.fromDate}T00:00:00Z`)) / 86400000) + 1;
    assert(days <= 90);
  });
  for (let index = 1; index < windows.length; index += 1) {
    assert.equal(Date.parse(`${windows[index].fromDate}T00:00:00Z`) - Date.parse(`${windows[index - 1].toDate}T00:00:00Z`), 86400000);
  }
});

test('provider HTTP and parser failures return SOURCE_ERROR with no quote or candle fallback', async () => {
  const holidays = async () => ({ status: 'AVAILABLE', dates: [] });
  const failingHttp = { get: async () => { throw Object.assign(new Error('outage'), { response: { status: 503 } }); } };
  const quoteProvider = new NseMarketDataProvider({
    httpClient: failingHttp,
    holidayLoader: holidays,
    clock: () => new Date(FETCHED_AT),
  });
  const quote = await quoteProvider.getQuotes(DEFAULT_BENCHMARK_IDS, { forceRefresh: true });
  assert.equal(quote.status, 'SOURCE_ERROR');
  assert.deepEqual(quote.facts, []);
  assert.equal(quote.error.code, 'NSE_QUOTE_FETCH_FAILED');

  const historyProvider = new NseHistoricalDataProvider({
    httpClient: { get: async () => ({ data: { unexpected: [] } }) },
    holidayLoader: holidays,
    clock: () => new Date(FETCHED_AT),
  });
  const history = await historyProvider.getDailyCandles(MARKET_BENCHMARKS.NIFTY_50.canonicalProductId, {
    fromDate: '2026-06-01', toDate: '2026-09-07', forceRefresh: true,
  });
  assert.equal(history.status, 'SOURCE_ERROR');
  assert.deepEqual(history.candles, []);
});

test('NSE quote provider coalesces concurrent requests and then serves Redis cache', async () => {
  const values = new Map();
  setRedisClient({
    get: async key => values.get(key) ?? null,
    setEx: async (key, _ttl, value) => { values.set(key, value); },
  });
  setRedisAvailable(true);
  clearInFlightMarketRequestsForTest();
  let calls = 0;
  try {
    const provider = new NseMarketDataProvider({
      clock: () => new Date(FETCHED_AT),
      holidayLoader: async () => ({ status: 'AVAILABLE', dates: [] }),
      httpClient: { get: async () => { calls += 1; return { data: QUOTE_PAYLOAD }; } },
    });
    const [first, coalesced] = await Promise.all([provider.getQuotes(), provider.getQuotes()]);
    const cached = await provider.getQuotes();
    assert.equal(calls, 1);
    assert.equal(first.cache.hit, false);
    assert.equal(coalesced.cache.hit, false);
    assert.equal(cached.cache.hit, true);
  } finally {
    clearInFlightMarketRequestsForTest();
    setRedisAvailable(false);
    setRedisClient(null);
  }
});

test('history-count boundaries keep context unavailable below 50 and expose MA50/MA200 only with evidence', () => {
  const quote = parseNseIndexQuotes(QUOTE_PAYLOAD, {
    fetchedAt: FETCHED_AT,
    now: new Date(FETCHED_AT),
  });
  function featuresFor(count) {
    const history = parseNseHistoricalData({ data: makeHistory(count) }, {
      fetchedAt: FETCHED_AT,
      fromDate: '2025-01-01',
      toDate: '2026-09-07',
      now: new Date(FETCHED_AT),
    });
    return computeMarketContextFeatures({ quoteSnapshot: quote, historicalSnapshot: history });
  }
  const belowMinimum = featuresFor(49);
  assert.equal(belowMinimum.status, 'FEATURES_UNAVAILABLE');
  assert(belowMinimum.reasonCodes.includes('INSUFFICIENT_NIFTY50_HISTORY'));

  const fifty = featuresFor(50);
  assert.equal(fifty.status, 'FEATURES_AVAILABLE');
  assert.equal(fifty.signals.movingAverage50Day.available, true);
  assert.equal(fifty.signals.movingAverage200Day.available, false);

  const oneNinetyNine = featuresFor(199);
  assert.equal(oneNinetyNine.signals.movingAverage200Day.available, false);

  const twoHundred = featuresFor(200);
  assert.equal(twoHundred.signals.movingAverage200Day.available, true);
});
