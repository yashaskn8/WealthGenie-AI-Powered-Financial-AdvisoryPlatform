import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMarketContextFeatures } from '../services/marketContextFeatureEngine.js';
import {
  MARKET_CONTEXT_CLASSIFICATION,
  MARKET_CONTEXT_POLICY_VERSION,
  applyMarketContextHysteresis,
  classifyDeterministicMarketContext,
} from '../services/marketContextPolicy.js';
import {
  getLiveMarketContext,
  resetMarketContextProcessStateForTest,
} from '../services/marketContextService.js';
import { MARKET_BENCHMARKS } from '../services/marketData/marketBenchmarks.js';

const NOW = new Date('2026-09-08T12:00:00.000Z');
const NIFTY = 'NSE_INDEX|Nifty 50';
const VIX = 'NSE_INDEX|India VIX';

function quoteFact(instrumentId, canonicalProductId, value, { previousClose = null, freshness = 'FRESH' } = {}) {
  return {
    canonicalProductId,
    value,
    availabilityStatus: 'AVAILABLE',
    observedAt: '2026-09-08T11:59:00.000Z',
    fetchedAt: NOW.toISOString(),
    freshness: { status: freshness, ageSeconds: 60, maxAgeSeconds: 900 },
    source: { provider: 'NSE', instrumentId, url: 'https://www.nseindia.com/api/allIndices' },
    metrics: { previousClose },
  };
}

function quoteSnapshot({ nifty = 160, previousClose = 159, vix = 14, niftyFreshness = 'FRESH', vixFreshness = 'FRESH', includeVix = true } = {}) {
  return {
    status: 'AVAILABLE',
    facts: [
      quoteFact(NIFTY, MARKET_BENCHMARKS.NIFTY_50.canonicalProductId, nifty, { previousClose, freshness: niftyFreshness }),
      ...(includeVix ? [quoteFact(VIX, MARKET_BENCHMARKS.INDIA_VIX.canonicalProductId, vix, { freshness: vixFreshness })] : []),
    ],
  };
}

function historySnapshot(closes, { freshness = 'FRESH', status = 'AVAILABLE' } = {}) {
  const start = Date.parse('2026-06-01T00:00:00.000Z');
  return {
    status,
    provider: 'NSE',
    fetchedAt: NOW.toISOString(),
    observedAt: new Date(start + (closes.length - 1) * 86400000).toISOString(),
    freshness: { status: freshness, ageSeconds: 86400, maxAgeSeconds: 345600 },
    source: { provider: 'NSE', instrumentId: 'NIFTY 50', url: 'https://www.nseindia.com/api/historicalOR/indicesHistory' },
    candles: closes.map((close, index) => ({
      timestamp: new Date(start + index * 86400000).toISOString(),
      open: close,
      high: close + 1,
      low: close - 1,
      close,
    })),
  };
}

function policyFeatures(overrides = {}) {
  const values = {
    indiaVixCurrent: 15,
    return20DayPct: 2,
    drawdownFromRecentHighPct: -1,
    realizedVolatility20DayAnnualizedPct: 12,
    priceVsMovingAverage50Pct: 2,
    ...overrides,
  };
  return {
    status: 'FEATURES_AVAILABLE',
    signals: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, {
      value, unit: 'PERCENT', basis: 'TEST_VERIFIED_SIGNAL', available: true,
    }])),
    reasonCodes: [],
    observedAt: '2026-09-08T11:59:00.000Z',
    freshness: { status: 'FRESH' },
    sources: [{ provider: 'NSE' }],
  };
}

test('fresh verified NIFTY and VIX observations produce deterministic normal context', () => {
  const closes = Array.from({ length: 60 }, (_, index) => 100 + index);
  const features = computeMarketContextFeatures({
    quoteSnapshot: quoteSnapshot(),
    historicalSnapshot: historySnapshot(closes),
  });
  const context = classifyDeterministicMarketContext(features);
  assert.equal(features.status, 'FEATURES_AVAILABLE');
  assert.equal(context.status, 'MARKET_CONTEXT_AVAILABLE');
  assert.equal(context.context, 'NORMAL');
  assert.equal(context.classification, MARKET_CONTEXT_CLASSIFICATION);
  assert.equal(context.policyVersion, MARKET_CONTEXT_POLICY_VERSION);
  assert.equal(context.confidence, null);
  assert.equal(features.signals.return1DayPct.value, 0.628931);
  assert.equal(features.signals.movingAverage50Day.available, true);
  assert.equal(features.signals.movingAverage200Day.available, false);
});

test('risk-off requires verified drawdown, 20-day loss, and price below MA50 evidence', () => {
  const closes = Array.from({ length: 60 }, (_, index) => 140 - (index * 0.5));
  const features = computeMarketContextFeatures({
    quoteSnapshot: quoteSnapshot({ nifty: 85, previousClose: 88, vix: 18 }),
    historicalSnapshot: historySnapshot(closes),
  });
  const context = classifyDeterministicMarketContext(features);
  assert.equal(context.context, 'RISK_OFF');
  assert(context.reasonCodes.includes('DRAWDOWN_AT_OR_BELOW_RISK_OFF_THRESHOLD'));
  assert(context.reasonCodes.includes('RETURN_20D_AT_OR_BELOW_RISK_OFF_THRESHOLD'));
  assert(context.reasonCodes.includes('PRICE_BELOW_MA50'));
});

test('stale NIFTY, stale VIX, missing VIX, and insufficient history fail closed', () => {
  const sixtyCloses = Array.from({ length: 60 }, (_, index) => 100 + index);
  const cases = [
    [quoteSnapshot({ niftyFreshness: 'STALE' }), historySnapshot(sixtyCloses), 'NIFTY50_QUOTE_STALE'],
    [quoteSnapshot({ vixFreshness: 'STALE' }), historySnapshot(sixtyCloses), 'INDIA_VIX_STALE'],
    [quoteSnapshot({ includeVix: false }), historySnapshot(sixtyCloses), 'INDIA_VIX_UNAVAILABLE'],
    [quoteSnapshot(), historySnapshot(sixtyCloses.slice(0, 49)), 'INSUFFICIENT_NIFTY50_HISTORY'],
  ];
  cases.forEach(([quotes, history, reason]) => {
    const features = computeMarketContextFeatures({ quoteSnapshot: quotes, historicalSnapshot: history });
    const context = classifyDeterministicMarketContext(features);
    assert.equal(context.status, 'MARKET_CONTEXT_UNAVAILABLE');
    assert.equal(context.context, null);
    assert(features.reasonCodes.includes(reason), `missing ${reason}`);
  });
});

test('policy boundaries are explicit and inclusive where documented', () => {
  assert.equal(classifyDeterministicMarketContext(policyFeatures({ indiaVixCurrent: 20 })).context, 'CAUTIOUS');
  assert.equal(classifyDeterministicMarketContext(policyFeatures({ indiaVixCurrent: 25 })).context, 'HIGH_VOLATILITY');
  assert.equal(classifyDeterministicMarketContext(policyFeatures({ realizedVolatility20DayAnnualizedPct: 30 })).context, 'HIGH_VOLATILITY');
  assert.equal(classifyDeterministicMarketContext(policyFeatures({
    drawdownFromRecentHighPct: -10,
    return20DayPct: -5,
    priceVsMovingAverage50Pct: -0.01,
  })).context, 'RISK_OFF');
  assert.equal(classifyDeterministicMarketContext(policyFeatures({
    indiaVixCurrent: 19.99,
    drawdownFromRecentHighPct: -4.99,
    return20DayPct: -2.99,
    priceVsMovingAverage50Pct: 0.01,
    realizedVolatility20DayAnnualizedPct: 29.99,
  })).context, 'NORMAL');
});

test('hysteresis ignores duplicate observations and requires distinct worsening/recovery confirmations', () => {
  const initialCandidate = classifyDeterministicMarketContext(policyFeatures());
  const initial = applyMarketContextHysteresis(initialCandidate, null, new Date('2026-09-08T12:00:00Z'));
  assert.equal(initial.result.context, 'NORMAL');

  const cautiousOne = classifyDeterministicMarketContext({
    ...policyFeatures({ indiaVixCurrent: 20 }),
    observedAt: '2026-09-08T12:01:00.000Z',
  });
  const held = applyMarketContextHysteresis(cautiousOne, initial.state, new Date('2026-09-08T12:01:00Z'));
  assert.equal(held.result.context, 'NORMAL');
  assert.equal(held.result.hysteresis.confirmationsObserved, 1);

  const duplicate = applyMarketContextHysteresis(cautiousOne, held.state, new Date('2026-09-08T12:02:00Z'));
  assert.equal(duplicate.result.context, 'NORMAL');
  assert.equal(duplicate.result.hysteresis.status, 'DUPLICATE_OBSERVATION_IGNORED');
  assert.equal(duplicate.result.hysteresis.confirmationsObserved, 1);

  const cautiousTwo = { ...cautiousOne, observedAt: '2026-09-08T12:03:00.000Z' };
  const worsened = applyMarketContextHysteresis(cautiousTwo, duplicate.state, new Date('2026-09-08T12:03:00Z'));
  assert.equal(worsened.result.context, 'CAUTIOUS');

  let recoveryState = worsened.state;
  for (let confirmation = 1; confirmation <= 3; confirmation += 1) {
    const recovery = classifyDeterministicMarketContext({
      ...policyFeatures(),
      observedAt: `2026-09-08T12:0${3 + confirmation}:00.000Z`,
    });
    const transition = applyMarketContextHysteresis(recovery, recoveryState, new Date(`2026-09-08T12:0${3 + confirmation}:00Z`));
    recoveryState = transition.state;
    assert.equal(transition.result.context, confirmation < 3 ? 'CAUTIOUS' : 'NORMAL');
  }
});

test('unconfigured provider and provider failures never create a normal fallback or advance state', async () => {
  resetMarketContextProcessStateForTest();
  const providerNotConfigured = async () => ({
    status: 'PROVIDER_NOT_CONFIGURED',
    facts: [],
    candles: [],
    freshness: { status: 'UNKNOWN' },
    error: { code: 'PROVIDER_NOT_CONFIGURED' },
  });
  const unavailable = await getLiveMarketContext({ now: NOW }, {
    fetchBenchmarkQuotes: providerNotConfigured,
    fetchNiftyHistoricalCandles: providerNotConfigured,
    getCache: async () => null,
    setCache: async () => { throw new Error('must not write unavailable state'); },
  });
  assert.equal(unavailable.status, 'MARKET_CONTEXT_UNAVAILABLE');
  assert.equal(unavailable.context, null);
  assert(unavailable.reasonCodes.includes('PROVIDER_NOT_CONFIGURED'));
  assert.equal(unavailable.statePersistence, 'NOT_WRITTEN_UNAVAILABLE_OBSERVATION');

  const failed = await getLiveMarketContext({ now: NOW }, {
    fetchBenchmarkQuotes: async () => { throw new Error('quote outage'); },
    fetchNiftyHistoricalCandles: async () => { throw new Error('history outage'); },
    getCache: async () => null,
    setCache: async () => { throw new Error('must not write failed state'); },
  });
  assert.equal(failed.status, 'MARKET_CONTEXT_UNAVAILABLE');
  assert.equal(failed.context, null);
  assert(failed.reasonCodes.includes('MARKET_QUOTE_SOURCE_ERROR'));
  assert(failed.reasonCodes.includes('MARKET_HISTORY_SOURCE_ERROR'));
  assert.equal(failed.statePersistence, 'NOT_WRITTEN_UNAVAILABLE_OBSERVATION');
});
