/**
 * Provider-neutral market-data facade.
 *
 * Phase 1 deliberately separates verified observations from simulation/model
 * assumptions. A failed or unconfigured provider never receives a numeric
 * fallback and is never reported as successful live data.
 */

import { INSTRUMENT_PARAMS } from './instrumentConstants.js';
import AmfiNavProvider from './marketData/AmfiNavProvider.js';
import AmfiNavHistoryProvider from './marketData/AmfiNavHistoryProvider.js';
import UpstoxMarketDataProvider, {
  DEFAULT_BENCHMARK_INSTRUMENT_KEYS,
} from './marketData/UpstoxMarketDataProvider.js';
import UpstoxHistoricalCandleProvider, {
  NIFTY_50_INSTRUMENT_KEY,
} from './marketData/UpstoxHistoricalCandleProvider.js';
import NseMarketDataProvider from './marketData/NseMarketDataProvider.js';
import NseHistoricalDataProvider from './marketData/NseHistoricalDataProvider.js';
import {
  DEFAULT_BENCHMARK_IDS,
  MARKET_BENCHMARKS,
} from './marketData/marketBenchmarks.js';
import {
  AVAILABILITY,
  MARKET_DATA_SCHEMA_VERSION,
} from './marketData/contracts.js';
import { persistVerifiedMarketSnapshot } from './marketData/MarketDataRepository.js';

const amfiProvider = new AmfiNavProvider();
const amfiHistoryProvider = new AmfiNavHistoryProvider();
const upstoxProvider = new UpstoxMarketDataProvider();
const upstoxHistoryProvider = new UpstoxHistoricalCandleProvider();
const nseProvider = new NseMarketDataProvider();
const nseHistoryProvider = new NseHistoricalDataProvider();

export const SUPPORTED_PRIMARY_MARKET_PROVIDERS = Object.freeze(['NSE', 'UPSTOX']);

export function resolvePrimaryMarketProvider(env = process.env) {
  const configured = String(env.MARKET_DATA_PRIMARY_PROVIDER || 'NSE').trim().toUpperCase();
  if (!SUPPORTED_PRIMARY_MARKET_PROVIDERS.includes(configured)) {
    throw new Error(`MARKET_DATA_PRIMARY_PROVIDER must be one of: ${SUPPORTED_PRIMARY_MARKET_PROVIDERS.join(', ')}.`);
  }
  return configured;
}

export const PRIMARY_MARKET_PROVIDER = resolvePrimaryMarketProvider();

export const MARKET_PARAMETER_SCHEMA_VERSION = 'simulation-assumptions-3.0.0';
export const MARKET_PARAMETER_CACHE_KEY = `mc:instrument:params:${MARKET_PARAMETER_SCHEMA_VERSION}`;

const LEGACY_SYMBOL_TO_BENCHMARK_ID = Object.freeze({
  '^NSEI': MARKET_BENCHMARKS.NIFTY_50.canonicalProductId,
  '^INDIAVIX': MARKET_BENCHMARKS.INDIA_VIX.canonicalProductId,
});

async function persistFreshSnapshot(snapshot) {
  if (snapshot?.cache?.hit || ![AVAILABILITY.AVAILABLE, AVAILABILITY.PARTIAL].includes(snapshot?.status)) {
    return { status: 'NOT_PERSISTED', productWrites: 0, observationWrites: 0 };
  }
  try {
    return await persistVerifiedMarketSnapshot(snapshot);
  } catch (error) {
    return {
      status: 'PERSISTENCE_ERROR',
      productWrites: 0,
      observationWrites: 0,
      error: { code: 'MARKET_PERSISTENCE_FAILED', message: error?.message || 'Persistence failed.' },
    };
  }
}

export async function fetchAmfiProductSnapshot({ forceRefresh = false, persist = true } = {}) {
  const snapshot = await amfiProvider.getSnapshot({ forceRefresh });
  const persistence = persist ? await persistFreshSnapshot(snapshot) : { status: 'NOT_REQUESTED' };
  return { ...snapshot, persistence };
}

export async function fetchAmfiHistoricalNavSnapshot({
  targetDate,
  forceRefresh = false,
  persist = true,
} = {}) {
  const target = targetDate ? new Date(targetDate) : new Date();
  if (Number.isNaN(target.getTime())) throw new TypeError('targetDate must be a valid date.');
  if (!targetDate) target.setUTCFullYear(target.getUTCFullYear() - 1);
  const snapshot = await amfiHistoryProvider.getSnapshot({
    targetDate: target.toISOString().slice(0, 10),
    forceRefresh,
  });
  const persistence = persist ? await persistFreshSnapshot(snapshot) : { status: 'NOT_REQUESTED' };
  return { ...snapshot, persistence };
}

/**
 * Compatibility DTO for existing callers. NAV remains a NAV observation only;
 * it is not converted into an expected return, price, or post-tax value.
 */
export async function fetchMutualFundNAVs(options = {}) {
  const snapshot = await fetchAmfiProductSnapshot(options);
  const factsByProduct = new Map((snapshot.facts || []).map(fact => [fact.canonicalProductId, fact]));
  const navMap = {};
  for (const product of snapshot.products || []) {
    const fact = factsByProduct.get(product.canonicalProductId);
    const schemeCode = product.externalIds?.find(item => item.source === 'AMFI_SCHEME_CODE')?.value;
    if (!schemeCode) continue;
    navMap[schemeCode] = {
      scheme_code: schemeCode,
      isin: product.externalIds?.find(item => item.source === 'ISIN')?.value || null,
      scheme_name: product.name,
      plan: product.plan,
      option: product.option,
      nav: fact?.value ?? null,
      nav_date: fact?.observedDate ?? null,
      observed_at: fact?.observedAt ?? null,
      availability_status: fact?.availabilityStatus ?? AVAILABILITY.UNAVAILABLE,
      freshness: fact?.freshness ?? null,
      data_source: 'AMFI',
    };
  }
  return {
    schema_version: MARKET_DATA_SCHEMA_VERSION,
    provider: snapshot.provider,
    status: snapshot.status,
    navMap,
    count: snapshot.productCount ?? 0,
    available_count: snapshot.availableFactCount ?? 0,
    fetched_at: snapshot.fetchedAt,
    cached: snapshot.cache?.hit === true,
    cache: snapshot.cache,
    persistence: snapshot.persistence,
    error: snapshot.error,
  };
}

export async function fetchBenchmarkQuotes({ forceRefresh = false, persist = true } = {}) {
  const snapshot = PRIMARY_MARKET_PROVIDER === 'UPSTOX'
    ? await upstoxProvider.getQuotes(DEFAULT_BENCHMARK_INSTRUMENT_KEYS, { forceRefresh })
    : await nseProvider.getQuotes(DEFAULT_BENCHMARK_IDS, { forceRefresh });
  const persistence = persist ? await persistFreshSnapshot(snapshot) : { status: 'NOT_REQUESTED' };
  return { ...snapshot, persistence };
}

export function buildNiftyHistoryWindow(now = new Date()) {
  const reference = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(reference.getTime())) throw new TypeError('now must be a valid date.');
  reference.setUTCHours(0, 0, 0, 0);
  const to = new Date(reference.getTime());
  to.setUTCDate(to.getUTCDate() - 1);
  const from = new Date(to.getTime());
  from.setUTCDate(from.getUTCDate() - 400);
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate: to.toISOString().slice(0, 10),
  };
}

/**
 * One bounded daily-history request supplies more than 200 expected trading
 * sessions without streaming or retrieving an entire market universe.
 */
export async function fetchNiftyHistoricalCandles({
  forceRefresh = false,
  now = new Date(),
} = {}) {
  const window = buildNiftyHistoryWindow(now);
  const provider = PRIMARY_MARKET_PROVIDER === 'UPSTOX' ? upstoxHistoryProvider : nseHistoryProvider;
  const instrumentId = PRIMARY_MARKET_PROVIDER === 'UPSTOX'
    ? NIFTY_50_INSTRUMENT_KEY
    : MARKET_BENCHMARKS.NIFTY_50.canonicalProductId;
  return provider.getDailyCandles(instrumentId, {
    ...window,
    forceRefresh,
  });
}

/**
 * Compatibility boundary for old index callers. Phase 1 exposes the verified
 * quote when available, but does not invent annualised return or volatility
 * from a single quote. Historical feature computation belongs to Phase 3.
 */
export async function fetchIndexStatistics(symbol = '^NSEI', options = {}) {
  const benchmarkId = LEGACY_SYMBOL_TO_BENCHMARK_ID[symbol];
  if (!benchmarkId) {
    return {
      symbol,
      status: AVAILABILITY.UNAVAILABLE,
      available: false,
      latest_price: null,
      annualised_return: null,
      annualised_volatility: null,
      data_points: 0,
      observed_at: null,
      data_source: null,
      error: { code: 'UNSUPPORTED_INDEX_SYMBOL', message: 'No qualified provider identity exists.' },
    };
  }
  const snapshot = await fetchBenchmarkQuotes(options);
  const fact = snapshot.facts?.find(item => item.canonicalProductId === benchmarkId) || null;
  return {
    symbol,
    instrument_key: fact?.source?.instrumentId ?? null,
    canonical_product_id: benchmarkId,
    status: snapshot.status,
    available: fact?.availabilityStatus === AVAILABILITY.AVAILABLE,
    latest_price: fact?.value ?? null,
    annualised_return: null,
    annualised_volatility: null,
    data_points: fact ? 1 : 0,
    observed_at: fact?.observedAt ?? null,
    fetched_at: snapshot.fetchedAt,
    freshness: fact?.freshness ?? null,
    data_source: snapshot.provider,
    source_url: fact?.source?.url ?? null,
    error: snapshot.error,
    cached: snapshot.cache?.hit === true,
  };
}

/**
 * Existing Monte Carlo callers still require explicit model assumptions until
 * Phase 5. These are now labelled as assumptions and are never described as
 * live/verified observations or altered by an external quote.
 */
export async function getLiveInstrumentParams() {
  const params = Object.fromEntries(Object.entries(INSTRUMENT_PARAMS).map(([key, value]) => [key, {
    mean: value.nominalRate / 100,
    stdDev: value.volatility,
    source: 'FROZEN_MODEL_ASSUMPTION',
    dataClass: 'MODEL_ASSUMPTION_NOT_MARKET_FACT',
  }]));
  return {
    schema_version: MARKET_PARAMETER_SCHEMA_VERSION,
    status: 'MODEL_ASSUMPTIONS_ONLY',
    params,
    computed_at: null,
    live_index_used: false,
    live_index_reason: 'PHASE_1_DOES_NOT_ESTIMATE_EXPECTED_RETURNS_FROM_QUOTES',
    cached: false,
  };
}

export async function getMutualFundNavsBySchemeCodes(schemeCodes, options = {}) {
  const normalizedCodes = [...new Set((schemeCodes || []).map(value => String(value).trim()).filter(Boolean))];
  const snapshot = await fetchAmfiProductSnapshot(options);
  const wantedIds = new Set(normalizedCodes.map(code => `mf:amfi:${code}`));
  return {
    schemaVersion: MARKET_DATA_SCHEMA_VERSION,
    provider: snapshot.provider,
    status: snapshot.status,
    fetchedAt: snapshot.fetchedAt,
    products: (snapshot.products || []).filter(product => wantedIds.has(product.canonicalProductId)),
    facts: (snapshot.facts || []).filter(fact => wantedIds.has(fact.canonicalProductId)),
    cache: snapshot.cache,
    error: snapshot.error,
  };
}

export async function checkFDRateStaleness(Instrument) {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const staleCount = await Instrument.countDocuments({
      type: 'FD',
      $or: [
        { updatedAt: { $lt: thirtyDaysAgo } },
        { updatedAt: { $exists: false }, createdAt: { $lt: thirtyDaysAgo } },
        { updatedAt: { $exists: false }, createdAt: { $exists: false } },
      ],
    });
    return {
      stale_count: staleCount,
      needs_refresh: staleCount > 0,
      warning: staleCount > 0
        ? `${staleCount} FD rate records are older than 30 days. Update via admin panel.`
        : null,
    };
  } catch {
    return { stale_count: 0, needs_refresh: false, warning: null };
  }
}

function sourceSummary(snapshot) {
  const freshness = (snapshot.facts || []).reduce((counts, fact) => {
    const status = fact?.freshness?.status || 'UNKNOWN';
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, { FRESH: 0, STALE: 0, UNKNOWN: 0 });
  return {
    provider: snapshot.provider,
    status: snapshot.status,
    fetchedAt: snapshot.fetchedAt ?? null,
    availableFactCount: snapshot.availableFactCount ?? 0,
    productCount: snapshot.productCount ?? null,
    cache: snapshot.cache ?? null,
    freshness,
    error: snapshot.error ?? null,
  };
}

export async function getMarketDataSummary(options = {}) {
  const [amfi, market] = await Promise.all([
    fetchAmfiProductSnapshot(options),
    fetchBenchmarkQuotes(options),
  ]);
  const statuses = [amfi.status, market.status];
  const availableSources = statuses.filter(status => [AVAILABILITY.AVAILABLE, AVAILABILITY.PARTIAL].includes(status)).length;
  const status = availableSources === statuses.length
    ? AVAILABILITY.AVAILABLE
    : availableSources > 0 ? AVAILABILITY.PARTIAL : AVAILABILITY.UNAVAILABLE;
  const timestamps = [amfi.fetchedAt, market.fetchedAt].filter(Boolean).sort();
  const marketSourceKey = String(market.provider || PRIMARY_MARKET_PROVIDER).toLowerCase();
  return {
    schemaVersion: MARKET_DATA_SCHEMA_VERSION,
    status,
    lastRefresh: timestamps.at(-1) ?? null,
    sources: {
      amfi: sourceSummary(amfi),
      [marketSourceKey]: sourceSummary(market),
    },
    primaryMarketProvider: PRIMARY_MARKET_PROVIDER,
    benchmarks: market.facts || [],
  };
}
