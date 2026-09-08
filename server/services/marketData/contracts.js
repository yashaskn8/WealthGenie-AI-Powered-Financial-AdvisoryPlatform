export const MARKET_DATA_SCHEMA_VERSION = 'market-fact-1.0.0';

export const PROVIDERS = Object.freeze({
  AMFI: 'AMFI',
  UPSTOX: 'UPSTOX',
});

export const FACT_KINDS = Object.freeze({
  MUTUAL_FUND_NAV: 'MUTUAL_FUND_NAV',
  MARKET_QUOTE: 'MARKET_QUOTE',
});

export const AVAILABILITY = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  PARTIAL: 'PARTIAL',
  UNAVAILABLE: 'UNAVAILABLE',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  SOURCE_ERROR: 'SOURCE_ERROR',
});

export const FRESHNESS = Object.freeze({
  FRESH: 'FRESH',
  STALE: 'STALE',
  UNKNOWN: 'UNKNOWN',
});

export function nullableFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  let candidate = value;
  if (typeof candidate === 'string' && /^\d+$/.test(candidate.trim())) {
    candidate = Number(candidate);
  }
  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    candidate = candidate < 10_000_000_000 ? candidate * 1000 : candidate;
  }
  const parsed = candidate instanceof Date ? candidate : new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function evaluateFreshness({ observedAt, fetchedAt, maxAgeSeconds, now = new Date() }) {
  const observed = normalizeTimestamp(observedAt);
  const fetched = normalizeTimestamp(fetchedAt);
  const maximumAge = nullableFiniteNumber(maxAgeSeconds);
  if (!observed || !fetched || maximumAge === null || maximumAge < 0) {
    return { status: FRESHNESS.UNKNOWN, ageSeconds: null, maxAgeSeconds: maximumAge };
  }
  const referenceTime = normalizeTimestamp(now);
  if (!referenceTime) {
    return { status: FRESHNESS.UNKNOWN, ageSeconds: null, maxAgeSeconds: maximumAge };
  }
  const ageSeconds = Math.max(0, Math.floor((Date.parse(referenceTime) - Date.parse(observed)) / 1000));
  return {
    status: ageSeconds <= maximumAge ? FRESHNESS.FRESH : FRESHNESS.STALE,
    ageSeconds,
    maxAgeSeconds: maximumAge,
  };
}

export function createMarketFact({
  kind,
  canonicalProductId,
  sourceProvider,
  sourceInstrumentId,
  sourceUrl,
  value,
  currency = null,
  unit,
  observedAt,
  fetchedAt,
  maxAgeSeconds,
  metrics = {},
  now = new Date(),
}) {
  if (!Object.values(FACT_KINDS).includes(kind)) throw new TypeError(`Unsupported market fact kind: ${kind}`);
  if (!canonicalProductId || !sourceProvider || !sourceInstrumentId || !sourceUrl || !unit) {
    throw new TypeError('Market facts require stable identity, provider, source URL, and unit.');
  }
  const numericValue = nullableFiniteNumber(value);
  const normalizedObservedAt = normalizeTimestamp(observedAt);
  const normalizedFetchedAt = normalizeTimestamp(fetchedAt);
  const availabilityStatus = numericValue === null || !normalizedObservedAt || !normalizedFetchedAt
    ? AVAILABILITY.UNAVAILABLE
    : AVAILABILITY.AVAILABLE;

  return {
    schemaVersion: MARKET_DATA_SCHEMA_VERSION,
    kind,
    canonicalProductId,
    value: numericValue,
    currency,
    unit,
    observedAt: normalizedObservedAt,
    fetchedAt: normalizedFetchedAt,
    availabilityStatus,
    freshness: evaluateFreshness({
      observedAt: normalizedObservedAt,
      fetchedAt: normalizedFetchedAt,
      maxAgeSeconds,
      now,
    }),
    source: {
      provider: sourceProvider,
      instrumentId: String(sourceInstrumentId),
      url: sourceUrl,
    },
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([key, metricValue]) => [key, nullableFiniteNumber(metricValue)]),
    ),
  };
}
