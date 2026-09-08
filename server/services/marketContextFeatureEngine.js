import { AVAILABILITY, FRESHNESS } from './marketData/contracts.js';
import { NIFTY_50_INSTRUMENT_KEY } from './marketData/UpstoxHistoricalCandleProvider.js';
import { DEFAULT_BENCHMARK_INSTRUMENT_KEYS } from './marketData/UpstoxMarketDataProvider.js';

export const INDIA_VIX_INSTRUMENT_KEY = DEFAULT_BENCHMARK_INSTRUMENT_KEYS[1];
export const MARKET_CONTEXT_MINIMUM_HISTORY_SESSIONS = 50;
export const MARKET_CONTEXT_RECENT_HIGH_SESSIONS = 252;

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits));
}

function signal(value, unit, basis) {
  return {
    value: Number.isFinite(value) ? value : null,
    unit,
    basis,
    available: Number.isFinite(value),
  };
}

function emptySignals() {
  return {
    nifty50Current: signal(null, 'INDEX_POINTS', 'UPSTOX_FULL_MARKET_QUOTE_V3'),
    nifty50PreviousClose: signal(null, 'INDEX_POINTS', 'UPSTOX_PREV_CLOSE_PRICE_V3'),
    indiaVixCurrent: signal(null, 'INDEX_POINTS', 'UPSTOX_FULL_MARKET_QUOTE_V3'),
    return1DayPct: signal(null, 'PERCENT', 'CURRENT_VS_PREVIOUS_TRADING_SESSION_CLOSE'),
    return5DayPct: signal(null, 'PERCENT', 'CURRENT_VS_CLOSE_5_TRADING_SESSIONS_AGO'),
    return20DayPct: signal(null, 'PERCENT', 'CURRENT_VS_CLOSE_20_TRADING_SESSIONS_AGO'),
    drawdownFromRecentHighPct: signal(null, 'PERCENT', 'CURRENT_VS_MAX_DAILY_HIGH_UP_TO_252_SESSIONS'),
    realizedVolatility20DayAnnualizedPct: signal(null, 'PERCENT', 'STDDEV_20_DAILY_LOG_RETURNS_SQRT_252'),
    movingAverage50Day: signal(null, 'INDEX_POINTS', 'MEAN_OF_50_COMPLETED_DAILY_CLOSES'),
    movingAverage200Day: signal(null, 'INDEX_POINTS', 'MEAN_OF_200_COMPLETED_DAILY_CLOSES'),
    priceVsMovingAverage50Pct: signal(null, 'PERCENT', 'CURRENT_VS_50_DAY_MOVING_AVERAGE'),
    priceVsMovingAverage200Pct: signal(null, 'PERCENT', 'CURRENT_VS_200_DAY_MOVING_AVERAGE'),
  };
}

function average(values) {
  if (!values.length || values.some(value => !Number.isFinite(value))) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStandardDeviation(values) {
  if (values.length < 2 || values.some(value => !Number.isFinite(value))) return null;
  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function returnPct(current, base) {
  return current > 0 && base > 0 ? round(((current / base) - 1) * 100) : null;
}

function findQuote(snapshot, instrumentKey) {
  return (snapshot?.facts || []).find(fact => fact?.source?.instrumentId === instrumentKey) || null;
}

function quoteProblem(fact, label) {
  if (!fact || fact.availabilityStatus !== AVAILABILITY.AVAILABLE || finitePositive(fact.value) === null) {
    return `${label}_UNAVAILABLE`;
  }
  if (fact.freshness?.status !== FRESHNESS.FRESH) return `${label}_STALE`;
  return null;
}

function sourceDescriptor(source, observedAt, fetchedAt, freshness) {
  return {
    provider: source?.provider ?? null,
    instrumentId: source?.instrumentId ?? null,
    url: source?.url ?? null,
    observedAt: observedAt ?? null,
    fetchedAt: fetchedAt ?? null,
    freshness: freshness ?? null,
  };
}

function unavailableResult({ quoteSnapshot, historicalSnapshot, signals, reasonCodes, sources }) {
  return {
    status: 'FEATURES_UNAVAILABLE',
    signals,
    reasonCodes: [...new Set(reasonCodes)],
    observedAt: null,
    freshness: {
      status: FRESHNESS.UNKNOWN,
      nifty50Quote: findQuote(quoteSnapshot, NIFTY_50_INSTRUMENT_KEY)?.freshness ?? null,
      indiaVixQuote: findQuote(quoteSnapshot, INDIA_VIX_INSTRUMENT_KEY)?.freshness ?? null,
      nifty50History: historicalSnapshot?.freshness ?? null,
    },
    sources,
  };
}

/**
 * Converts verified normalized Upstox quote/history payloads into deterministic
 * signals. It has no fallback values and performs no market classification.
 */
export function computeMarketContextFeatures({ quoteSnapshot, historicalSnapshot }) {
  const signals = emptySignals();
  const niftyFact = findQuote(quoteSnapshot, NIFTY_50_INSTRUMENT_KEY);
  const vixFact = findQuote(quoteSnapshot, INDIA_VIX_INSTRUMENT_KEY);
  const sources = [
    sourceDescriptor(niftyFact?.source, niftyFact?.observedAt, niftyFact?.fetchedAt, niftyFact?.freshness),
    sourceDescriptor(vixFact?.source, vixFact?.observedAt, vixFact?.fetchedAt, vixFact?.freshness),
    sourceDescriptor(
      historicalSnapshot?.source,
      historicalSnapshot?.observedAt,
      historicalSnapshot?.fetchedAt,
      historicalSnapshot?.freshness,
    ),
  ].filter(source => source.provider || source.instrumentId || source.url);

  const reasonCodes = [];
  if (quoteSnapshot?.status === AVAILABILITY.PROVIDER_NOT_CONFIGURED
      || historicalSnapshot?.status === AVAILABILITY.PROVIDER_NOT_CONFIGURED) {
    reasonCodes.push('PROVIDER_NOT_CONFIGURED');
  }
  if (quoteSnapshot?.status === AVAILABILITY.SOURCE_ERROR) reasonCodes.push('UPSTOX_QUOTE_SOURCE_ERROR');
  if (historicalSnapshot?.status === AVAILABILITY.SOURCE_ERROR) reasonCodes.push('UPSTOX_HISTORY_SOURCE_ERROR');
  const niftyProblem = quoteProblem(niftyFact, 'NIFTY50_QUOTE');
  const vixProblem = quoteProblem(vixFact, 'INDIA_VIX');
  if (niftyProblem) reasonCodes.push(niftyProblem);
  if (vixProblem) reasonCodes.push(vixProblem);

  const niftyCurrent = finitePositive(niftyFact?.value);
  const previousClose = finitePositive(niftyFact?.metrics?.previousClose);
  const vixCurrent = finitePositive(vixFact?.value);
  signals.nifty50Current = signal(niftyCurrent, 'INDEX_POINTS', 'UPSTOX_FULL_MARKET_QUOTE_V3');
  signals.nifty50PreviousClose = signal(previousClose, 'INDEX_POINTS', 'UPSTOX_PREV_CLOSE_PRICE_V3');
  signals.indiaVixCurrent = signal(vixCurrent, 'INDEX_POINTS', 'UPSTOX_FULL_MARKET_QUOTE_V3');
  if (previousClose === null) reasonCodes.push('NIFTY50_PREVIOUS_CLOSE_UNAVAILABLE');

  if (historicalSnapshot?.status !== AVAILABILITY.AVAILABLE) {
    if (!reasonCodes.includes('PROVIDER_NOT_CONFIGURED') && !reasonCodes.includes('UPSTOX_HISTORY_SOURCE_ERROR')) {
      reasonCodes.push('NIFTY50_HISTORY_UNAVAILABLE');
    }
  } else if (historicalSnapshot?.freshness?.status !== FRESHNESS.FRESH) {
    reasonCodes.push('NIFTY50_HISTORY_STALE');
  }

  const candles = Array.isArray(historicalSnapshot?.candles) ? historicalSnapshot.candles : [];
  const validCandles = candles.filter(candle => (
    finitePositive(candle?.close) !== null && finitePositive(candle?.high) !== null
  ));
  if (validCandles.length < MARKET_CONTEXT_MINIMUM_HISTORY_SESSIONS) {
    reasonCodes.push('INSUFFICIENT_NIFTY50_HISTORY');
  }

  if (reasonCodes.length > 0) {
    return unavailableResult({ quoteSnapshot, historicalSnapshot, signals, reasonCodes, sources });
  }

  const closes = validCandles.map(candle => Number(candle.close));
  const recentCandles = validCandles.slice(-MARKET_CONTEXT_RECENT_HIGH_SESSIONS);
  const recentHigh = Math.max(niftyCurrent, ...recentCandles.map(candle => Number(candle.high)));
  const recentCloses = closes.slice(-21);
  const dailyLogReturns = recentCloses.slice(1).map((close, index) => (
    Math.log(close / recentCloses[index])
  ));
  const ma50 = average(closes.slice(-50));
  const ma200 = closes.length >= 200 ? average(closes.slice(-200)) : null;
  const realizedVolatility = sampleStandardDeviation(dailyLogReturns);

  signals.return1DayPct = signal(returnPct(niftyCurrent, previousClose), 'PERCENT', 'CURRENT_VS_PREVIOUS_TRADING_SESSION_CLOSE');
  signals.return5DayPct = signal(returnPct(niftyCurrent, closes.at(-5)), 'PERCENT', 'CURRENT_VS_CLOSE_5_TRADING_SESSIONS_AGO');
  signals.return20DayPct = signal(returnPct(niftyCurrent, closes.at(-20)), 'PERCENT', 'CURRENT_VS_CLOSE_20_TRADING_SESSIONS_AGO');
  signals.drawdownFromRecentHighPct = signal(returnPct(niftyCurrent, recentHigh), 'PERCENT', 'CURRENT_VS_MAX_DAILY_HIGH_UP_TO_252_SESSIONS');
  signals.realizedVolatility20DayAnnualizedPct = signal(
    realizedVolatility === null ? null : round(realizedVolatility * Math.sqrt(252) * 100),
    'PERCENT',
    'STDDEV_20_DAILY_LOG_RETURNS_SQRT_252',
  );
  signals.movingAverage50Day = signal(round(ma50), 'INDEX_POINTS', 'MEAN_OF_50_COMPLETED_DAILY_CLOSES');
  signals.movingAverage200Day = signal(ma200 === null ? null : round(ma200), 'INDEX_POINTS', 'MEAN_OF_200_COMPLETED_DAILY_CLOSES');
  signals.priceVsMovingAverage50Pct = signal(returnPct(niftyCurrent, ma50), 'PERCENT', 'CURRENT_VS_50_DAY_MOVING_AVERAGE');
  signals.priceVsMovingAverage200Pct = signal(
    ma200 === null ? null : returnPct(niftyCurrent, ma200),
    'PERCENT',
    'CURRENT_VS_200_DAY_MOVING_AVERAGE',
  );

  const quoteObserved = [niftyFact.observedAt, vixFact.observedAt].map(Date.parse).filter(Number.isFinite);
  return {
    status: 'FEATURES_AVAILABLE',
    signals,
    reasonCodes: ma200 === null ? ['MA200_UNAVAILABLE_INSUFFICIENT_HISTORY'] : [],
    observedAt: quoteObserved.length === 2 ? new Date(Math.min(...quoteObserved)).toISOString() : null,
    freshness: {
      status: FRESHNESS.FRESH,
      nifty50Quote: niftyFact.freshness,
      indiaVixQuote: vixFact.freshness,
      nifty50History: historicalSnapshot.freshness,
    },
    sources,
  };
}
