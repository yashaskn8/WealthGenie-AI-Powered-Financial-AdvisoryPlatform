/** Keep absent financial facts absent. JavaScript's Number(null) === 0 must not leak into UI. */
export function nullableMarketNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatNullablePercent(value, { decimals = 1, suffix = '%' } = {}) {
  const parsed = nullableMarketNumber(value);
  return parsed === null ? null : `${parsed.toFixed(decimals)}${suffix}`;
}

export const MARKET_DISPLAY_STATES = Object.freeze({
  LOADING: 'LOADING',
  CURRENT: 'CURRENT',
  MARKET_CLOSED: 'MARKET_CLOSED',
  LAST_AVAILABLE: 'LAST_AVAILABLE',
  STALE: 'STALE',
  PARTIAL_DATA: 'PARTIAL_DATA',
  UNAVAILABLE: 'UNAVAILABLE',
});

const MARKET_DISPLAY_COPY = Object.freeze({
  LOADING: {
    label: 'Loading market data',
    detail: 'Checking the latest verified market evidence.',
  },
  CURRENT: {
    label: 'Current verified data',
    detail: 'Verified market evidence is available for the current session.',
  },
  MARKET_CLOSED: {
    label: 'Market closed',
    detail: 'Showing the last available verified session data.',
  },
  LAST_AVAILABLE: {
    label: 'Last available data',
    detail: 'The latest verified observation is shown; current session status is unavailable.',
  },
  STALE: {
    label: 'Stale market data',
    detail: 'The verified observation is older than its freshness window.',
  },
  PARTIAL_DATA: {
    label: 'Partial market data',
    detail: 'Some verified market facts are available; the rest are unavailable.',
  },
  UNAVAILABLE: {
    label: 'Market data unavailable',
    detail: 'Verified market context is temporarily unavailable.',
  },
});

export function getMarketDisplayState(marketContext, { loading = false } = {}) {
  const key = loading
    ? MARKET_DISPLAY_STATES.LOADING
    : marketContext?.marketSnapshot?.status
      || (marketContext?.status === 'MARKET_CONTEXT_AVAILABLE'
        ? MARKET_DISPLAY_STATES.LAST_AVAILABLE
        : MARKET_DISPLAY_STATES.UNAVAILABLE);
  const safeKey = MARKET_DISPLAY_COPY[key] ? key : MARKET_DISPLAY_STATES.UNAVAILABLE;
  return { key: safeKey, ...MARKET_DISPLAY_COPY[safeKey] };
}

export function formatMarketTimestamp(value) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

export function getMarketEvidenceSource(marketContext) {
  const snapshot = marketContext?.marketSnapshot;
  const provider = snapshot?.providerStatus?.quotes?.provider
    || snapshot?.provenance?.sources?.find(source => source?.provider)?.provider
    || marketContext?.sources?.find(source => source?.provider)?.provider;
  return provider || null;
}
