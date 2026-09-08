/**
 * Provider-neutral market-data facade.
 *
 * Phase 1 deliberately separates verified observations from simulation/model
 * assumptions. A failed or unconfigured provider never receives a numeric
 * fallback and is never reported as successful live data.
 */

import { INSTRUMENT_PARAMS } from './instrumentConstants.js';
import AmfiNavProvider from './marketData/AmfiNavProvider.js';
import UpstoxMarketDataProvider, {
  DEFAULT_BENCHMARK_INSTRUMENT_KEYS,
} from './marketData/UpstoxMarketDataProvider.js';
import {
  AVAILABILITY,
  MARKET_DATA_SCHEMA_VERSION,
} from './marketData/contracts.js';
import { persistVerifiedMarketSnapshot } from './marketData/MarketDataRepository.js';

const amfiProvider = new AmfiNavProvider();
const upstoxProvider = new UpstoxMarketDataProvider();

export const MARKET_PARAMETER_SCHEMA_VERSION = 'simulation-assumptions-3.0.0';
export const MARKET_PARAMETER_CACHE_KEY = `mc:instrument:params:${MARKET_PARAMETER_SCHEMA_VERSION}`;

const LEGACY_SYMBOL_TO_UPSTOX_KEY = Object.freeze({
  '^NSEI': 'NSE_INDEX|Nifty 50',
  '^INDIAVIX': 'NSE_INDEX|India VIX',
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
  const snapshot = await upstoxProvider.getQuotes(DEFAULT_BENCHMARK_INSTRUMENT_KEYS, { forceRefresh });
  const persistence = persist ? await persistFreshSnapshot(snapshot) : { status: 'NOT_REQUESTED' };
  return { ...snapshot, persistence };
}

/**
 * Compatibility boundary for old index callers. Phase 1 exposes the verified
 * quote when available, but does not invent annualised return or volatility
 * from a single quote. Historical feature computation belongs to Phase 3.
 */
export async function fetchIndexStatistics(symbol = '^NSEI', options = {}) {
  const instrumentKey = LEGACY_SYMBOL_TO_UPSTOX_KEY[symbol];
  if (!instrumentKey) {
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
  const snapshot = await upstoxProvider.getQuotes([instrumentKey], options);
  const fact = snapshot.facts?.[0] || null;
  return {
    symbol,
    instrument_key: instrumentKey,
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
  const [amfi, upstox] = await Promise.all([
    fetchAmfiProductSnapshot(options),
    fetchBenchmarkQuotes(options),
  ]);
  const statuses = [amfi.status, upstox.status];
  const availableSources = statuses.filter(status => [AVAILABILITY.AVAILABLE, AVAILABILITY.PARTIAL].includes(status)).length;
  const status = availableSources === statuses.length
    ? AVAILABILITY.AVAILABLE
    : availableSources > 0 ? AVAILABILITY.PARTIAL : AVAILABILITY.UNAVAILABLE;
  const timestamps = [amfi.fetchedAt, upstox.fetchedAt].filter(Boolean).sort();
  return {
    schemaVersion: MARKET_DATA_SCHEMA_VERSION,
    status,
    lastRefresh: timestamps.at(-1) ?? null,
    sources: {
      amfi: sourceSummary(amfi),
      upstox: sourceSummary(upstox),
    },
    benchmarks: upstox.facts || [],
  };
}
