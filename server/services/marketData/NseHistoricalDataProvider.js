import crypto from 'node:crypto';
import MarketDataProvider from './MarketDataProvider.js';
import {
  AVAILABILITY,
  FRESHNESS,
  MARKET_DATA_SCHEMA_VERSION,
  PROVIDERS,
  normalizeTimestamp,
  nullableFiniteNumber,
} from './contracts.js';
import { MARKET_BENCHMARKS, benchmarkByCanonicalId } from './marketBenchmarks.js';
import { isoDateInIndia } from './indiaMarketTime.js';
import { getNseJson, safeNseHttpError } from './nseHttp.js';
import {
  NSE_DAILY_HISTORY_MAX_AGE_SECONDS,
  evaluateNseDailyHistoryFreshness,
  fetchNseTradingHolidays,
  parseNseDate,
} from './nseTradingCalendar.js';
import { readThroughMarketCache } from './requestCache.js';

export const NSE_HISTORICAL_INDEX_URL = 'https://www.nseindia.com/api/historicalOR/indicesHistory';
export const NSE_HISTORY_CACHE_TTL_SECONDS = 6 * 60 * 60;
export const NSE_HISTORY_DATA_CLASS = 'DAILY';
export const NSE_HISTORY_MAX_WINDOW_DAYS = 90;

function requireIsoDate(value, fieldName) {
  const text = String(value || '').trim();
  const date = new Date(`${text}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(date.getTime())
      || date.toISOString().slice(0, 10) !== text) {
    throw new TypeError(`${fieldName} must use YYYY-MM-DD format.`);
  }
  return text;
}

function shiftDate(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatNseQueryDate(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return `${day}-${month}-${year}`;
}

export function buildNseHistoryWindows(fromDate, toDate, maxDays = NSE_HISTORY_MAX_WINDOW_DAYS) {
  const from = requireIsoDate(fromDate, 'fromDate');
  const to = requireIsoDate(toDate, 'toDate');
  if (from > to) throw new RangeError('fromDate must not be after toDate.');
  if (!Number.isInteger(maxDays) || maxDays < 1 || maxDays > 365) throw new RangeError('maxDays must be 1-365.');
  const windows = [];
  let start = from;
  while (start <= to) {
    const candidateEnd = shiftDate(start, maxDays - 1);
    const end = candidateEnd < to ? candidateEnd : to;
    windows.push({ fromDate: start, toDate: end });
    start = shiftDate(end, 1);
  }
  return windows;
}

function positiveNumber(value) {
  const number = nullableFiniteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function normalizedHistoryRow(row, index) {
  if (row?.EOD_INDEX_NAME !== MARKET_BENCHMARKS.NIFTY_50.nseIndexName) {
    throw new Error(`NSE_HISTORY_SCHEMA_MISMATCH:data[${index}].EOD_INDEX_NAME`);
  }
  const effectiveTradingDate = parseNseDate(row.EOD_TIMESTAMP);
  const timestamp = normalizeTimestamp(row.HI_TIMESTAMP);
  const open = positiveNumber(row.EOD_OPEN_INDEX_VAL);
  const high = positiveNumber(row.EOD_HIGH_INDEX_VAL);
  const low = positiveNumber(row.EOD_LOW_INDEX_VAL);
  const close = positiveNumber(row.EOD_CLOSE_INDEX_VAL);
  if (!effectiveTradingDate || !timestamp || isoDateInIndia(timestamp) !== effectiveTradingDate
      || open === null || high === null || low === null || close === null
      || high < low || high < open || high < close || low > open || low > close) {
    throw new Error(`NSE_HISTORY_INVALID_ROW:data[${index}]`);
  }
  return {
    timestamp,
    effectiveTradingDate,
    open,
    high,
    low,
    close,
    volume: nullableFiniteNumber(row.HIT_TRADED_QTY),
    openInterest: null,
  };
}

export function parseNseHistoricalData(payload, {
  fetchedAt,
  fromDate,
  toDate,
  now = new Date(),
  holidayDates = [],
  sourceUrl = NSE_HISTORICAL_INDEX_URL,
} = {}) {
  const normalizedFromDate = requireIsoDate(fromDate, 'fromDate');
  const normalizedToDate = requireIsoDate(toDate, 'toDate');
  const normalizedFetchedAt = normalizeTimestamp(fetchedAt);
  if (!normalizedFetchedAt) throw new TypeError('fetchedAt must be a valid timestamp.');
  if (!payload || !Array.isArray(payload.data)) throw new Error('NSE_HISTORY_SCHEMA_MISMATCH:data');
  const byDate = new Map();
  let duplicateRowCount = 0;
  for (const [index, row] of payload.data.entries()) {
    const candle = normalizedHistoryRow(row, index);
    if (candle.effectiveTradingDate < normalizedFromDate || candle.effectiveTradingDate > normalizedToDate) {
      throw new Error(`NSE_HISTORY_OUT_OF_RANGE:data[${index}]`);
    }
    const existing = byDate.get(candle.effectiveTradingDate);
    if (existing) {
      const comparable = key => existing[key] === candle[key];
      if (!['open', 'high', 'low', 'close', 'timestamp'].every(comparable)) {
        throw new Error(`NSE_HISTORY_CONFLICTING_DUPLICATE:${candle.effectiveTradingDate}`);
      }
      duplicateRowCount += 1;
      continue;
    }
    byDate.set(candle.effectiveTradingDate, candle);
  }
  const candles = [...byDate.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (candles.length === 0) throw new Error('NSE_HISTORY_NO_VALID_CANDLES');
  const latest = candles.at(-1);
  return {
    schemaVersion: MARKET_DATA_SCHEMA_VERSION,
    provider: PROVIDERS.NSE,
    status: AVAILABILITY.AVAILABLE,
    qualification: 'OFFICIAL_NSE_WEBSITE_ENDPOINT_UNDOCUMENTED_SCHEMA_VALIDATED',
    dataClass: NSE_HISTORY_DATA_CLASS,
    instrumentKey: MARKET_BENCHMARKS.NIFTY_50.canonicalProductId,
    interval: '1 day',
    fetchedAt: normalizedFetchedAt,
    observedAt: latest.timestamp,
    providerTimestamp: latest.timestamp,
    effectiveTradingDate: latest.effectiveTradingDate,
    freshness: evaluateNseDailyHistoryFreshness({
      effectiveTradingDate: latest.effectiveTradingDate,
      requestedToDate: normalizedToDate,
      observedAt: latest.timestamp,
      fetchedAt: normalizedFetchedAt,
      now,
      holidayDates,
    }),
    candleCount: candles.length,
    duplicateRowCount,
    candles,
    source: {
      provider: PROVIDERS.NSE,
      instrumentId: MARKET_BENCHMARKS.NIFTY_50.nseIndexName,
      url: sourceUrl,
    },
  };
}

function cacheKeyFor(fromDate, toDate) {
  const digest = crypto.createHash('sha256').update(`${fromDate}\n${toDate}`).digest('hex');
  return `market:nse:daily-index-history:${MARKET_DATA_SCHEMA_VERSION}:${digest}`;
}

export default class NseHistoricalDataProvider extends MarketDataProvider {
  constructor({ holidayLoader, ...options } = {}) {
    super({ providerName: PROVIDERS.NSE, ...options });
    this.holidayLoader = holidayLoader || ((loaderOptions = {}) => fetchNseTradingHolidays({
      httpClient: this.httpClient,
      clock: this.clock,
      ...loaderOptions,
    }));
  }

  async getDailyCandles(canonicalProductId, { fromDate, toDate, forceRefresh = false } = {}) {
    const benchmark = benchmarkByCanonicalId(canonicalProductId);
    if (benchmark?.canonicalProductId !== MARKET_BENCHMARKS.NIFTY_50.canonicalProductId) {
      throw new TypeError('NSE history currently supports only the canonical NIFTY 50 benchmark.');
    }
    const normalizedFromDate = requireIsoDate(fromDate, 'fromDate');
    const normalizedToDate = requireIsoDate(toDate, 'toDate');
    if (normalizedFromDate > normalizedToDate) throw new RangeError('fromDate must not be after toDate.');
    return readThroughMarketCache({
      cacheKey: cacheKeyFor(normalizedFromDate, normalizedToDate),
      ttlSeconds: NSE_HISTORY_CACHE_TTL_SECONDS,
      forceRefresh,
      loader: async () => {
        const fetchedAt = this.nowIso();
        try {
          const windows = buildNseHistoryWindows(normalizedFromDate, normalizedToDate);
          const [responses, holidaySnapshot] = await Promise.all([
            Promise.all(windows.map(window => getNseJson(this.httpClient, NSE_HISTORICAL_INDEX_URL, {
              params: {
                indexType: MARKET_BENCHMARKS.NIFTY_50.nseIndexName,
                from: formatNseQueryDate(window.fromDate),
                to: formatNseQueryDate(window.toDate),
              },
              referer: 'https://www.nseindia.com/reports-indices-historical-index-data',
              timeout: 15_000,
            }))),
            this.holidayLoader({ forceRefresh: false }),
          ]);
          if (holidaySnapshot?.status !== AVAILABILITY.AVAILABLE) {
            throw new Error('NSE_TRADING_CALENDAR_UNAVAILABLE');
          }
          const rows = [];
          responses.forEach((response, index) => {
            if (!response?.data || !Array.isArray(response.data.data)) {
              throw new Error(`NSE_HISTORY_SCHEMA_MISMATCH:window[${index}].data`);
            }
            rows.push(...response.data.data);
          });
          return parseNseHistoricalData({ data: rows }, {
            fetchedAt,
            fromDate: normalizedFromDate,
            toDate: normalizedToDate,
            now: this.clock(),
            holidayDates: holidaySnapshot.dates,
          });
        } catch (error) {
          return {
            schemaVersion: MARKET_DATA_SCHEMA_VERSION,
            provider: PROVIDERS.NSE,
            status: AVAILABILITY.SOURCE_ERROR,
            qualification: 'OFFICIAL_NSE_WEBSITE_ENDPOINT_UNDOCUMENTED_SCHEMA_VALIDATED',
            dataClass: NSE_HISTORY_DATA_CLASS,
            instrumentKey: canonicalProductId,
            fetchedAt,
            observedAt: null,
            providerTimestamp: null,
            effectiveTradingDate: null,
            freshness: {
              status: FRESHNESS.UNKNOWN,
              ageSeconds: null,
              maxAgeSeconds: NSE_DAILY_HISTORY_MAX_AGE_SECONDS,
            },
            candleCount: 0,
            candles: [],
            source: {
              provider: PROVIDERS.NSE,
              instrumentId: MARKET_BENCHMARKS.NIFTY_50.nseIndexName,
              url: NSE_HISTORICAL_INDEX_URL,
            },
            error: {
              code: 'NSE_HISTORY_FETCH_FAILED',
              message: safeNseHttpError(error, 'NSE historical index request failed'),
            },
          };
        }
      },
    });
  }
}
