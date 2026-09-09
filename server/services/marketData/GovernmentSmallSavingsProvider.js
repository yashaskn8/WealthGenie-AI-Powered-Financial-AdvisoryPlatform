import MarketDataProvider from './MarketDataProvider.js';
import {
  AVAILABILITY,
  FACT_KINDS,
  FRESHNESS,
  MARKET_DATA_SCHEMA_VERSION,
  PROVIDERS,
  createMarketFact,
} from './contracts.js';
import { readThroughMarketCache } from './requestCache.js';

export const INDIA_POST_SAVINGS_URL = 'https://www.indiapost.gov.in/banking-services/savings';
export const GOVERNMENT_SAVINGS_CACHE_KEY = `market:government:small-savings:${MARKET_DATA_SCHEMA_VERSION}`;
export const GOVERNMENT_SAVINGS_CACHE_TTL_SECONDS = 12 * 60 * 60;
export const GOVERNMENT_RATE_DATA_CLASS = 'QUARTERLY_OFFICIAL_RATE';

const SCHEME_IDENTITIES = Object.freeze({
  'Post Office Savings Account': { id: 'post-office-savings', name: 'Post Office Savings Account' },
  '1 Year Time Deposit': { id: 'post-office-td-1y', name: 'Post Office 1-Year Time Deposit', tenureMonths: 12 },
  '2 Year Time Deposit': { id: 'post-office-td-2y', name: 'Post Office 2-Year Time Deposit', tenureMonths: 24 },
  '3 Year Time Deposit': { id: 'post-office-td-3y', name: 'Post Office 3-Year Time Deposit', tenureMonths: 36 },
  '5 Year Time Deposit': { id: 'post-office-td-5y', name: 'Post Office 5-Year Time Deposit', tenureMonths: 60 },
  '5 Year Recurring Deposit Scheme': { id: 'post-office-rd-5y', name: 'Post Office 5-Year Recurring Deposit', tenureMonths: 60 },
  'Senior Citizen Savings Scheme': { id: 'scss', name: 'Senior Citizens Savings Scheme' },
  'Monthly Income Account': { id: 'pomis', name: 'Post Office Monthly Income Scheme' },
  'National Savings Certificate (VIII Issue)': { id: 'nsc', name: 'National Savings Certificate (VIII Issue)', tenureMonths: 60 },
  'Public Provident Fund Scheme': { id: 'ppf', name: 'Public Provident Fund' },
  'Kisan Vikas Patra': { id: 'kvp', name: 'Kisan Vikas Patra' },
  'Sukanya Samriddhi Account Scheme': { id: 'sukanya', name: 'Sukanya Samriddhi Account' },
});

function parseIndianDate(value) {
  const match = String(value || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : iso;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function extractOfficialScriptUrls(html, pageUrl = INDIA_POST_SAVINGS_URL) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('INDIA_POST_EMPTY_PAGE');
  const origin = new URL(pageUrl).origin;
  const urls = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
    .map(match => new URL(decodeHtml(match[1]), origin))
    .filter(url => url.origin === origin && url.pathname.startsWith('/_next/static/chunks/'))
    .map(url => url.toString());
  return [...new Set(urls)].slice(0, 20);
}

export function parseIndiaPostSavingsBundle(bundleText, {
  fetchedAt = new Date().toISOString(),
  now = new Date(),
  sourceUrl = INDIA_POST_SAVINGS_URL,
} = {}) {
  if (typeof bundleText !== 'string' || !bundleText.trim()) throw new Error('INDIA_POST_EMPTY_BUNDLE');
  const interval = bundleText.match(/Post Office Small Savings Schemes \(w\.e\.f\s+(\d{2}\.\d{2}\.\d{4})\s+to\s+(\d{2}\.\d{2}\.\d{4})\)/i);
  if (!interval) throw new Error('INDIA_POST_SCHEMA_MISMATCH:effective_interval');
  const effectiveFrom = parseIndianDate(interval[1]);
  const effectiveTo = parseIndianDate(interval[2]);
  if (!effectiveFrom || !effectiveTo || effectiveFrom > effectiveTo) {
    throw new Error('INDIA_POST_SCHEMA_MISMATCH:effective_interval');
  }

  const tableMatch = bundleText.match(/JSON\.parse\('(\[\{"slNo"[\s\S]*?\}\])'\)/);
  if (!tableMatch) throw new Error('INDIA_POST_SCHEMA_MISMATCH:rate_table');
  let rows;
  try {
    rows = JSON.parse(tableMatch[1]);
  } catch {
    throw new Error('INDIA_POST_SCHEMA_MISMATCH:rate_table_json');
  }
  if (!Array.isArray(rows)) throw new Error('INDIA_POST_SCHEMA_MISMATCH:rate_rows');

  const fetchedDate = new Date(fetchedAt);
  const intervalEnd = new Date(`${effectiveTo}T23:59:59.999Z`);
  const intervalStart = new Date(`${effectiveFrom}T00:00:00.000Z`);
  const nowDate = now instanceof Date ? now : new Date(now);
  const freshnessStatus = nowDate >= intervalStart && nowDate <= intervalEnd
    ? FRESHNESS.FRESH
    : FRESHNESS.STALE;
  const products = [];
  const facts = [];

  for (const row of rows) {
    const identity = SCHEME_IDENTITIES[String(row?.instrument || '').trim()];
    if (!identity) continue;
    const rateMatch = String(row?.interestRate || '').match(/(\d+(?:\.\d+)?)\s*%/);
    const value = rateMatch ? Number(rateMatch[1]) : null;
    const canonicalProductId = `government:india-post:${identity.id}`;
    const fact = createMarketFact({
      kind: FACT_KINDS.SCHEME_INTEREST_RATE,
      canonicalProductId,
      sourceProvider: PROVIDERS.GOVERNMENT_OF_INDIA,
      sourceInstrumentId: identity.id,
      sourceUrl,
      value,
      unit: 'PERCENT_PER_ANNUM',
      observedAt: `${effectiveFrom}T00:00:00.000Z`,
      providerTimestamp: `${effectiveFrom}T00:00:00.000Z`,
      fetchedAt: fetchedDate.toISOString(),
      effectiveFrom,
      effectiveTo,
      dataClass: GOVERNMENT_RATE_DATA_CLASS,
      maxAgeSeconds: 0,
      now: nowDate,
    });
    fact.freshness = {
      status: freshnessStatus,
      ageSeconds: Math.max(0, Math.floor((nowDate - intervalStart) / 1000)),
      maxAgeSeconds: Math.floor((intervalEnd - intervalStart) / 1000),
    };
    fact.rateBasis = 'OFFICIAL_NOMINAL_RATE_PER_ANNUM';
    fact.compoundingBasis = typeof row.compoundingFrequency === 'string'
      ? row.compoundingFrequency.trim() || null
      : null;
    products.push({
      schemaVersion: MARKET_DATA_SCHEMA_VERSION,
      canonicalProductId,
      productType: 'GOVERNMENT_SCHEME',
      name: identity.name,
      providerName: 'Department of Posts, Government of India',
      externalIds: [{ source: 'INDIA_POST_SCHEME_ID', value: identity.id }],
      source: { provider: PROVIDERS.GOVERNMENT_OF_INDIA, url: sourceUrl },
      sourceUpdatedAt: `${effectiveFrom}T00:00:00.000Z`,
      tenureMonths: identity.tenureMonths ?? null,
    });
    facts.push(fact);
  }

  const expectedSchemeCount = Object.keys(SCHEME_IDENTITIES).length;
  if (products.length !== expectedSchemeCount) {
    throw new Error('INDIA_POST_SCHEMA_MISMATCH:incomplete_rate_table');
  }
  const availableFactCount = facts.filter(fact => fact.availabilityStatus === AVAILABILITY.AVAILABLE).length;
  return {
    schemaVersion: MARKET_DATA_SCHEMA_VERSION,
    provider: PROVIDERS.GOVERNMENT_OF_INDIA,
    status: availableFactCount === facts.length ? AVAILABILITY.AVAILABLE : AVAILABILITY.PARTIAL,
    qualification: 'OFFICIAL_INDIA_POST_PUBLIC_RATE_TABLE_SCHEMA_VALIDATED',
    dataClass: GOVERNMENT_RATE_DATA_CLASS,
    effectiveFrom,
    effectiveTo,
    fetchedAt: fetchedDate.toISOString(),
    productCount: products.length,
    availableFactCount,
    products,
    facts,
  };
}

export default class GovernmentSmallSavingsProvider extends MarketDataProvider {
  constructor(options = {}) {
    super({ providerName: PROVIDERS.GOVERNMENT_OF_INDIA, ...options });
  }

  async getSnapshot({ forceRefresh = false } = {}) {
    return readThroughMarketCache({
      cacheKey: GOVERNMENT_SAVINGS_CACHE_KEY,
      ttlSeconds: GOVERNMENT_SAVINGS_CACHE_TTL_SECONDS,
      forceRefresh,
      loader: async () => {
        const fetchedAt = this.nowIso();
        try {
          const page = await this.httpClient.get(INDIA_POST_SAVINGS_URL, {
            timeout: 20_000,
            responseType: 'text',
            headers: { Accept: 'text/html' },
          });
          const scriptUrls = extractOfficialScriptUrls(page.data);
          if (scriptUrls.length === 0) throw new Error('INDIA_POST_SCHEMA_MISMATCH:scripts');
          for (const scriptUrl of scriptUrls) {
            const script = await this.httpClient.get(scriptUrl, {
              timeout: 20_000,
              responseType: 'text',
              headers: { Accept: 'application/javascript' },
            });
            if (!String(script.data).includes('Post Office Small Savings Schemes')) continue;
            return parseIndiaPostSavingsBundle(script.data, {
              fetchedAt,
              now: this.clock(),
              sourceUrl: INDIA_POST_SAVINGS_URL,
            });
          }
          throw new Error('INDIA_POST_SCHEMA_MISMATCH:rate_bundle_not_found');
        } catch (error) {
          return {
            schemaVersion: MARKET_DATA_SCHEMA_VERSION,
            provider: PROVIDERS.GOVERNMENT_OF_INDIA,
            status: AVAILABILITY.SOURCE_ERROR,
            dataClass: GOVERNMENT_RATE_DATA_CLASS,
            fetchedAt,
            productCount: 0,
            availableFactCount: 0,
            products: [],
            facts: [],
            error: { code: 'GOVERNMENT_SAVINGS_FETCH_FAILED', message: error?.message || 'Official India Post request failed.' },
          };
        }
      },
    });
  }
}
