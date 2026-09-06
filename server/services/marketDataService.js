/**
 * WealthGenie Live Market Data Service
 * Fetches real-time data from AMFI, Yahoo Finance, and RBI
 * to replace hardcoded instrument parameters.
 *
 * All data is cached in Redis with appropriate TTLs.
 */

import axios from 'axios';
import { getCache, setCache } from '../config/redis.js';
import { INSTRUMENT_PARAMS, updateLiveParam } from './instrumentConstants.js';

const CACHE_TTL = {
  MF_NAV: 86400,       // 24 hours — AMFI updates daily
  INDEX_DATA: 3600,    // 1 hour — Yahoo Finance
  FD_RATES: 86400,     // 24 hours
  LIVE_PARAMS: 3600,   // 1 hour
};
export const MARKET_PARAMETER_SCHEMA_VERSION = 'market-parameters-2.0.0';
export const MARKET_PARAMETER_CACHE_KEY = `mc:instrument:params:${MARKET_PARAMETER_SCHEMA_VERSION}`;

// ─── FUNCTION 1: Fetch and parse AMFI NAV data ──────────────────────
/**
 * Fetches the complete NAV dataset from AMFI India's public API.
 * Returns a map of scheme_code → { scheme_name, nav, nav_date }
 *
 * Source: https://www.amfiindia.com/spages/NAVAll.txt
 * Updates daily at ~23:00 IST
 */
export async function fetchMutualFundNAVs() {
  const cacheKey = 'mf:navs:all';
  const cached = await getCache(cacheKey);
  if (cached) return { ...cached, cached: true };

  try {
    const response = await axios.get(
      'https://www.amfiindia.com/spages/NAVAll.txt',
      { timeout: 15000 }
    );

    // Parse pipe-delimited format
    // Line format: SchemeCode;ISINDiv;ISINGrowth;SchemeName;NAV;Date
    const lines = response.data.split('\n').filter(l => l.includes(';'));
    const navMap = {};
    let count = 0;

    for (const line of lines) {
      const parts = line.split(';');
      if (parts.length >= 6 && !isNaN(parseFloat(parts[4]))) {
        navMap[parts[0].trim()] = {
          scheme_code: parts[0].trim(),
          isin: parts[1].trim(),
          scheme_name: parts[3].trim(),
          nav: parseFloat(parts[4]),
          nav_date: parts[5].trim(),
        };
        count++;
      }
    }

    const result = { navMap, count, fetched_at: new Date().toISOString() };
    await setCache(cacheKey, result, CACHE_TTL.MF_NAV);
    return { ...result, cached: false };
  } catch (err) {
    console.error('[MarketData] AMFI fetch failed:', err.message);
    return { navMap: {}, count: 0, error: err.message, cached: false };
  }
}

// ─── FUNCTION 2: Compute live index statistics ──────────────────────
/**
 * Fetches monthly price data from Yahoo Finance and computes:
 * - Annualised return (geometric)
 * - Annualised volatility (std dev of monthly returns × √12)
 *
 * @param {string} symbol - e.g. '^NSEI' for Nifty, '^BSESN' for Sensex
 */
export async function fetchIndexStatistics(symbol = '^NSEI') {
  const cacheKey = `index:stats:${symbol}`;
  const cached = await getCache(cacheKey);
  if (cached) return { ...cached, cached: true };

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
      + `?interval=1mo&range=3y`;

    const response = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WealthGenie/2.0)' },
    });

    const prices = (response.data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [])
      .map(Number)
      .filter(p => Number.isFinite(p) && p > 0);

    if (prices.length < 13) {
      // Need at least 13 data points to compute 12 monthly returns for meaningful volatility
      throw new Error(`Insufficient price data (${prices.length} points, need 13+) for volatility computation`);
    }

    // Compute monthly returns
    const monthlyReturns = [];
    for (let i = 1; i < prices.length; i++) {
      monthlyReturns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    // Annualise: geometric mean for return, sample std dev for volatility
    const meanMonthly = monthlyReturns.reduce((a, b) => a + b, 0) / monthlyReturns.length;
    // Bessel's correction: divide by (N-1) for unbiased sample variance
    const variance = monthlyReturns.reduce(
      (acc, r) => acc + Math.pow(r - meanMonthly, 2), 0
    ) / (monthlyReturns.length - 1);

    const stats = {
      symbol,
      annualised_return: parseFloat(((Math.pow(1 + meanMonthly, 12) - 1)).toFixed(4)),
      annualised_volatility: parseFloat((Math.sqrt(variance * 12)).toFixed(4)),
      data_points: prices.length,
      latest_price: prices[prices.length - 1],
      computed_at: new Date().toISOString(),
      data_source: 'Yahoo Finance',
    };

    await setCache(cacheKey, stats, CACHE_TTL.INDEX_DATA);
    return { ...stats, cached: false };
  } catch (err) {
    console.error(`[MarketData] Index ${symbol} fetch failed:`, err.message);
    return {
      symbol,
      available: false,
      annualised_return: null,
      annualised_volatility: null,
      data_points: 0,
      latest_price: null,
      computed_at: new Date().toISOString(),
      data_source: 'unavailable',
      error: err.message,
      cached: false,
    };
  }
}

// ─── FUNCTION 3: Build live INSTRUMENT_PARAMS for Monte Carlo ───────
/**
 * Constructs Monte Carlo parameters from live index data.
 * Uses the frozen nominal catalog explicitly when verified live index data is unavailable.
 * @returns {Object} instrument → { mean, stdDev }
 */
export async function getLiveInstrumentParams() {
  const cached = await getCache(MARKET_PARAMETER_CACHE_KEY);
  if (cached?.schema_version === MARKET_PARAMETER_SCHEMA_VERSION && cached.params) {
    for (const [key, val] of Object.entries(cached.params)) {
      if (INSTRUMENT_PARAMS[key] && val.mean !== undefined) {
        const nominalRate = parseFloat((val.mean * 100).toFixed(2));
        updateLiveParam(key, nominalRate, val.stdDev);
      }
    }
    return { ...cached, cached: true };
  }

  const niftyStats = await fetchIndexStatistics('^NSEI');
  const params = Object.fromEntries(Object.entries(INSTRUMENT_PARAMS).map(([key, value]) => [key, {
    mean: value.nominalRate / 100,
    stdDev: value.volatility,
    source: 'frozen-catalog',
  }]));

  const liveReturn = Number(niftyStats.annualised_return);
  const liveVolatility = Number(niftyStats.annualised_volatility);
  const liveUsable = niftyStats.available !== false
    && Number(niftyStats.data_points) >= 13
    && Number.isFinite(liveReturn) && liveReturn > -1 && liveReturn <= 1
    && Number.isFinite(liveVolatility) && liveVolatility >= 0 && liveVolatility <= 0.60;

  if (liveUsable) {
    const equityMean = liveReturn * 0.8;
    const candidates = {
      ELSS:       { mean: equityMean * 0.95, stdDev: liveVolatility },
      Equity_MF:  { mean: equityMean * 0.95, stdDev: liveVolatility },
      ETF:        { mean: equityMean * 0.98, stdDev: liveVolatility * 0.95 },
      NPS:        { mean: equityMean * 0.85, stdDev: liveVolatility * 0.7 },
      Hybrid_MF:  { mean: equityMean * 0.92, stdDev: liveVolatility * 0.55 },
      Index_MF:   { mean: equityMean * 0.98, stdDev: liveVolatility * 0.95 },
      Midcap_MF:  { mean: equityMean * 1.35, stdDev: liveVolatility * 1.22 },
      Smallcap_MF:{ mean: equityMean * 1.50, stdDev: liveVolatility * 1.55 },
    };
    for (const [key, candidate] of Object.entries(candidates)) {
      if (candidate.mean > -1 && candidate.mean <= 1 && candidate.stdDev >= 0 && candidate.stdDev <= 0.60) {
        params[key] = { ...candidate, source: 'verified-index-derived' };
      }
    }
  }

  // Apply the live rates dynamically via updateLiveParam
  for (const [key, val] of Object.entries(params)) {
    if (INSTRUMENT_PARAMS[key]) {
      const nominalRate = parseFloat((val.mean * 100).toFixed(2));
      updateLiveParam(key, nominalRate, val.stdDev);
    }
  }

  const result = {
    schema_version: MARKET_PARAMETER_SCHEMA_VERSION,
    params,
    computed_at: new Date().toISOString(),
    live_index_used: liveUsable,
    live_index_reason: liveUsable ? 'verified_3_year_monthly_series' : 'unavailable_or_outside_supported_bounds',
    nifty_stats: niftyStats,
  };
  await setCache(MARKET_PARAMETER_CACHE_KEY, result, CACHE_TTL.LIVE_PARAMS);
  return { ...result, cached: false };
}

// ─── FUNCTION 4: Check FD rate staleness in MongoDB ─────────────────
/**
 * Flags FD records in the instruments collection that haven't been
 * updated in over 30 days. Used by the admin/health endpoint.
 *
 * @param {Model} Instrument - Mongoose model
 */
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
  } catch (_) {
    return { stale_count: 0, needs_refresh: false, warning: null };
  }
}

// ─── FUNCTION 5: Full market data summary ───────────────────────────
/**
 * Returns a comprehensive market data snapshot for the /api/market/rates endpoint.
 */
export async function getMarketDataSummary() {
  const [nifty, sensex, navData] = await Promise.allSettled([
    fetchIndexStatistics('^NSEI'),
    fetchIndexStatistics('^BSESN'),
    fetchMutualFundNAVs(),
  ]);

  return {
    nifty: nifty.status === 'fulfilled' ? nifty.value : { error: 'unavailable' },
    sensex: sensex.status === 'fulfilled' ? sensex.value : { error: 'unavailable' },
    amfi_nav_count: navData.status === 'fulfilled' ? navData.value.count : 0,
    last_refresh: new Date().toISOString(),
    status: 'ok',
  };
}
