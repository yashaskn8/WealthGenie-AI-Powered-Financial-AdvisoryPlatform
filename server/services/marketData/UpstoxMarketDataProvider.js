import crypto from 'node:crypto';
import MarketDataProvider from './MarketDataProvider.js';
import {
  AVAILABILITY,
  FACT_KINDS,
  MARKET_DATA_SCHEMA_VERSION,
  PROVIDERS,
  createMarketFact,
  normalizeTimestamp,
} from './contracts.js';
import { buildUpstoxInstrumentIdentity } from './productIdentity.js';
import { readThroughMarketCache } from './requestCache.js';

export const UPSTOX_QUOTE_URL = 'https://api.upstox.com/v3/market-quote/quotes';
export const UPSTOX_QUOTE_CACHE_TTL_SECONDS = 60;
export const UPSTOX_QUOTE_FRESHNESS_SECONDS = 15 * 60;
export const MAX_UPSTOX_INSTRUMENTS_PER_REQUEST = 50;
export const DEFAULT_BENCHMARK_INSTRUMENT_KEYS = Object.freeze([
  'NSE_INDEX|Nifty 50',
  'NSE_INDEX|India VIX',
]);

function normalizeInstrumentKeys(instrumentKeys) {
  if (!Array.isArray(instrumentKeys)) throw new TypeError('instrumentKeys must be an array.');
  const unique = [...new Set(instrumentKeys.map(value => String(value || '').trim()).filter(Boolean))];
  if (unique.length === 0 || unique.length > MAX_UPSTOX_INSTRUMENTS_PER_REQUEST) {
    throw new RangeError(`instrumentKeys must contain 1-${MAX_UPSTOX_INSTRUMENTS_PER_REQUEST} unique values.`);
  }
  unique.forEach(buildUpstoxInstrumentIdentity);
  return unique;
}

function cacheKeyFor(instrumentKeys) {
  const digest = crypto.createHash('sha256').update([...instrumentKeys].sort().join('\n')).digest('hex');
  return `market:upstox:quotes:${MARKET_DATA_SCHEMA_VERSION}:${digest}`;
}

function findQuote(data, instrumentKey) {
  if (data?.[instrumentKey]) return data[instrumentKey];
  return Object.values(data || {}).find(value => value?.instrument_token === instrumentKey) || null;
}

function quoteObservedAt(quote, responseTimestamp) {
  return normalizeTimestamp(
    quote?.last_trade_time ?? quote?.lastTradeTime ?? quote?.timestamp ?? responseTimestamp,
  );
}

export default class UpstoxMarketDataProvider extends MarketDataProvider {
  constructor({
    accessToken = process.env.UPSTOX_ANALYTICS_TOKEN || process.env.UPSTOX_ACCESS_TOKEN || '',
    ...options
  } = {}) {
    super({ providerName: PROVIDERS.UPSTOX, ...options });
    this.accessToken = String(accessToken || '').trim();
  }

  isConfigured() {
    return this.accessToken.length > 0;
  }

  async getQuotes(instrumentKeys, { forceRefresh = false } = {}) {
    const normalizedKeys = normalizeInstrumentKeys(instrumentKeys);
    const fetchedAt = this.nowIso();
    if (!this.isConfigured()) {
      return {
        schemaVersion: MARKET_DATA_SCHEMA_VERSION,
        provider: PROVIDERS.UPSTOX,
        status: AVAILABILITY.PROVIDER_NOT_CONFIGURED,
        fetchedAt,
        requestedInstrumentCount: normalizedKeys.length,
        availableFactCount: 0,
        facts: [],
        error: {
          code: 'PROVIDER_NOT_CONFIGURED',
          message: 'Set UPSTOX_ANALYTICS_TOKEN or UPSTOX_ACCESS_TOKEN on the server to enable Upstox data.',
        },
        cache: { hit: false, backend: 'NONE' },
      };
    }

    return readThroughMarketCache({
      cacheKey: cacheKeyFor(normalizedKeys),
      ttlSeconds: UPSTOX_QUOTE_CACHE_TTL_SECONDS,
      forceRefresh,
      loader: async () => {
        const requestFetchedAt = this.nowIso();
        try {
          const response = await this.httpClient.get(UPSTOX_QUOTE_URL, {
            timeout: 10_000,
            params: { instrument_key: normalizedKeys.join(',') },
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${this.accessToken}`,
            },
          });
          const responseData = response.data?.data || {};
          // Only a provider payload timestamp can represent market observation time.
          // HTTP Date is transport metadata and must never make an old quote look fresh.
          const responseTimestamp = response.data?.timestamp || null;
          const facts = normalizedKeys.map(instrumentKey => {
            const quote = findQuote(responseData, instrumentKey);
            const identity = buildUpstoxInstrumentIdentity(instrumentKey);
            return createMarketFact({
              kind: FACT_KINDS.MARKET_QUOTE,
              canonicalProductId: identity.canonicalProductId,
              sourceProvider: PROVIDERS.UPSTOX,
              sourceInstrumentId: instrumentKey,
              sourceUrl: UPSTOX_QUOTE_URL,
              value: quote?.last_price,
              currency: 'INR',
              unit: 'PRICE',
              observedAt: quoteObservedAt(quote, responseTimestamp),
              fetchedAt: requestFetchedAt,
              maxAgeSeconds: UPSTOX_QUOTE_FRESHNESS_SECONDS,
              metrics: {
                open: quote?.ohlc?.open,
                high: quote?.ohlc?.high,
                low: quote?.ohlc?.low,
                close: quote?.ohlc?.close,
                previousClose: quote?.prev_close_price,
                volume: quote?.volume,
                openInterest: quote?.oi,
              },
              now: this.clock(),
            });
          });
          const availableFactCount = facts.filter(
            fact => fact.availabilityStatus === AVAILABILITY.AVAILABLE,
          ).length;
          return {
            schemaVersion: MARKET_DATA_SCHEMA_VERSION,
            provider: PROVIDERS.UPSTOX,
            status: availableFactCount === facts.length
              ? AVAILABILITY.AVAILABLE
              : availableFactCount > 0 ? AVAILABILITY.PARTIAL : AVAILABILITY.UNAVAILABLE,
            fetchedAt: requestFetchedAt,
            requestedInstrumentCount: normalizedKeys.length,
            availableFactCount,
            facts,
          };
        } catch (error) {
          return {
            schemaVersion: MARKET_DATA_SCHEMA_VERSION,
            provider: PROVIDERS.UPSTOX,
            status: AVAILABILITY.SOURCE_ERROR,
            fetchedAt: requestFetchedAt,
            requestedInstrumentCount: normalizedKeys.length,
            availableFactCount: 0,
            facts: [],
            error: { code: 'UPSTOX_FETCH_FAILED', message: error?.message || 'Upstox request failed.' },
          };
        }
      },
    });
  }
}
