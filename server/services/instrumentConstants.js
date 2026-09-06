/**
 * WealthGenie Instrument Constants — Single Source of Truth
 *
 * ALL nominal rates, volatility parameters, and metadata for every instrument
 * must be defined HERE and imported everywhere else. This eliminates the #1
 * production risk: rate drift between projection, recommendation, and MC modules.
 *
 * DO NOT duplicate these values in any other file.
 *
 * =========================================================================
 * 📘 BEGINNER NOTE: NOMINAL RATE vs. REAL RATE & VOLATILITY
 * =========================================================================
 * 1. Nominal Rate (nominalRate): The percentage return an investment is expected to 
 *    earn before accounting for inflation or taxes. For example, if a Fixed Deposit (FD)
 *    has a nominal rate of 6.5%, a ₹10,000 investment grows to ₹10,650 in a year.
 *    To get the "Real Rate" (purchasing power growth), you subtract the inflation rate 
 *    (e.g., if inflation is 5%, the real return is roughly 6.5% - 5% = 1.5%).
 * 
 * 2. Volatility (volatility): A measure of how much the price of an asset fluctuates 
 *    up and down over a year. We represent it as a decimal (e.g., 0.18 means 18% volatility).
 *    - Low volatility (e.g. FDs, PPF at 0.005 / 0.5%): Growth is a steady, straight line.
 *    - High volatility (e.g. Smallcap MFs at 0.28 / 28%): High highs and low lows; the path
 *      resembles a jagged mountain range. This is modeled stochastically in our Monte Carlo simulator.
 */

export const CESS_RATE = 0.04; // 4% Health & Education Cess — FY2025-26

import { getCache, setCache, redisAvailable } from '../config/redis.js';

// ARCHITECTURE: Write-through cache pattern.
// Source of truth: Redis key 'mc:instrument:params:live'
// Local _liveCache: synchronous read-through cache, populated by:
//   1. updateLiveParam() — writes locally AND to Redis
//   2. refreshLiveParams() — periodic sync from Redis for cross-instance consistency
// On restart, cache starts empty → reads from Redis on first refresh.
// This is a CACHE, not authoritative state. Redis is the single source of truth.
const _liveCache = {};

const REDIS_LIVE_KEY = 'instrument-params:live-overrides:1';

/**
 * Update live parameters dynamically (used by marketDataService).
 * Synchronously updates local cache, then async-writes to Redis.
 *
 * @param {string} key - Instrument key (e.g. 'FD', 'Equity_MF')
 * @param {number} [nominalRate] - Live nominal return rate (percentage, e.g. 6.5)
 * @param {number} [volatility] - Live annualised volatility (decimal, e.g. 0.18)
 */
export function updateLiveParam(key, nominalRate, volatility) {
  // Synchronous local cache update (enables immediate reads via Proxy)
  if (!_liveCache[key]) _liveCache[key] = {};
  if (nominalRate !== undefined) _liveCache[key].nominalRate = nominalRate;
  if (volatility !== undefined) _liveCache[key].volatility = volatility;

  // Async write-through to Redis (fire-and-forget for callers that don't await)
  _persistToRedis().catch(err => {
    console.warn('[InstrumentConstants] Failed to persist live params to Redis:', err.message);
  });
}

async function _persistToRedis() {
  if (!redisAvailable) return;
  await setCache(REDIS_LIVE_KEY, { ..._liveCache }, 86400);
}

/**
 * Refresh local cache from Redis. Call periodically for cross-instance consistency.
 * Safe to call at startup — if Redis is empty, local cache stays as-is.
 */
export async function refreshLiveParams() {
  if (!redisAvailable) return;
  try {
    const remote = await getCache(REDIS_LIVE_KEY);
    if (remote && typeof remote === 'object') {
      for (const [k, v] of Object.entries(remote)) {
        _liveCache[k] = { ...(_liveCache[k] || {}), ...v };
      }
    }
  } catch (err) {
    console.warn('[InstrumentConstants] Failed to refresh live params from Redis:', err.message);
  }
}

// ACCURACY NOTE: nominalRate for Mutual Funds/ETFs is already net of Total Expense Ratio (TER).
// expenseRatio is documented here for transparency and used in risk/Sharpe adjustments.
const staticParams = {
  // Rates reconciled with authoritative catalog investment_master.json
  // Methodology: Computed as the average expectedReturn across all catalog instruments mapping
  // to each backendType category via resolveBackendType() (Reconciliation Date: August 2026).
  // DO NOT manually edit these values without running drift-detection test suite.
  FD:           { nominalRate: 7.5,   volatility: 0.005,  expenseRatio: 0.0,    riskLevel: 'Low',        lockIn: 0,  name: 'Bank Fixed Deposit',       tags: ['Guaranteed', 'DICGC Insured'] },
  ELSS:         { nominalRate: 14.4,  volatility: 0.18,   expenseRatio: 0.015,  riskLevel: 'High',       lockIn: 3,  name: 'ELSS Mutual Fund',         tags: ['Tax Saving', '80C'] },
  Equity_MF:    { nominalRate: 14.9,  volatility: 0.18,   expenseRatio: 0.015,  riskLevel: 'High',       lockIn: 0,  name: 'Equity Mutual Fund',       tags: ['Wealth Growth'] },
  ETF:          { nominalRate: 13.7,  volatility: 0.16,   expenseRatio: 0.001,  riskLevel: 'Medium',     lockIn: 0,  name: 'Nifty 50 ETF',             tags: ['Passive', 'Low Cost'] },
  Debt_MF:      { nominalRate: 7.5,   volatility: 0.03,   expenseRatio: 0.008,  riskLevel: 'Low-Medium', lockIn: 0,  name: 'Debt Mutual Fund',         tags: ['Liquid'] },
  RBI_Bond:     { nominalRate: 7.5,   volatility: 0.002,  expenseRatio: 0.0,    riskLevel: 'Very Low',   lockIn: 7,  name: 'RBI Savings Bond',         tags: ['Sovereign'] },
  'G-Sec':      { nominalRate: 7.3,   volatility: 0.01,   expenseRatio: 0.0,    riskLevel: 'Very Low',   lockIn: 0,  name: 'Government Security',      tags: ['Sovereign', 'Gilt'] },
  PPF:          { nominalRate: 7.1,   volatility: 0.003,  expenseRatio: 0.0,    riskLevel: 'Very Low',   lockIn: 15, name: 'Public Provident Fund',    tags: ['EEE', 'Tax Free', '80C'] },
  NPS:          { nominalRate: 10.5,  volatility: 0.12,   expenseRatio: 0.0001, riskLevel: 'Medium',     lockIn: 60, name: 'National Pension System',  tags: ['Retirement', '80CCD'] },
  Gold:         { nominalRate: 10.8,  volatility: 0.15,   expenseRatio: 0.005,  riskLevel: 'Medium',     lockIn: 0,  name: 'Gold (Commodity)',          assetClass: 'Commodity', tags: ['Hedge', 'Inflation'] },
  SGB:          { nominalRate: 13.0,  volatility: 0.14,   expenseRatio: 0.0,    riskLevel: 'Low-Medium', lockIn: 8,  name: 'Sovereign Gold Bond',      tags: ['Gold', 'Tax Exempt'] },
  Liquid_MF:    { nominalRate: 7.0,   volatility: 0.005,  expenseRatio: 0.0025, riskLevel: 'Low',        lockIn: 0,  name: 'Liquid Mutual Fund',       tags: ['Emergency Fund', 'T+1'] },
  Arbitrage_MF: { nominalRate: 7.5,   volatility: 0.02,   expenseRatio: 0.0035, riskLevel: 'Low',        lockIn: 0,  name: 'Arbitrage Mutual Fund',    tags: ['Low Volatility', 'Equity Taxed'] },
  Hybrid_MF:    { nominalRate: 10.8,  volatility: 0.10,   expenseRatio: 0.012,  riskLevel: 'Medium',     lockIn: 0,  name: 'Balanced Advantage Fund',  tags: ['Hybrid', 'Dynamic'] },
  Index_MF:     { nominalRate: 14.2,  volatility: 0.16,   expenseRatio: 0.002,  riskLevel: 'Medium',     lockIn: 0,  name: 'Nifty 50 Index Fund',      tags: ['Passive', 'Low Cost'] },
  Midcap_MF:    { nominalRate: 16.7,  volatility: 0.22,   expenseRatio: 0.015,  riskLevel: 'High',       lockIn: 0,  name: 'Mid-Cap Mutual Fund',      tags: ['High Growth'] },
  Smallcap_MF:  { nominalRate: 21.0,  volatility: 0.28,   expenseRatio: 0.015,  riskLevel: 'Very High',  lockIn: 0,  name: 'Small-Cap Mutual Fund',    tags: ['Highest Risk'] },
  SCSS:         { nominalRate: 8.2,   volatility: 0.002,  expenseRatio: 0.0,    riskLevel: 'Very Low',   lockIn: 5,  name: 'Senior Citizens Savings',  tags: ['Sovereign', 'Senior'] },
  SSY:          { nominalRate: 8.2,   volatility: 0.002,  expenseRatio: 0.0,    riskLevel: 'Very Low',   lockIn: 21, name: 'Sukanya Samriddhi',        tags: ['EEE', 'Girl Child'] },
};

export const INSTRUMENT_PARAMS = new Proxy(staticParams, {
  get(target, prop) {
    if (prop === '__isProxy') return true;
    if (prop in target) {
      const base = target[prop];
      // Merge live cache on top of static defaults (write-through cache pattern)
      const live = _liveCache[prop];
      if (live) {
        return Object.freeze({ ...base, ...live });
      }
      return Object.freeze(base);
    }
    return undefined;
  },
  set(target, prop, value) {
    throw new TypeError('INSTRUMENT_PARAMS is immutable. Use updateLiveParam to update live market data.');
  },
  ownKeys(target) {
    return Reflect.ownKeys(target);
  },
  getOwnPropertyDescriptor(target, prop) {
    const desc = Reflect.getOwnPropertyDescriptor(target, prop);
    if (desc) {
      desc.value = this.get(target, prop);
    }
    return desc;
  }
});

/**
 * Get nominal rate for an instrument key (as percentage, e.g. 12.5).
 * Unknown instruments fail closed; callers must establish a catalog mapping.
 */
export function getNominalRate(key) {
  return INSTRUMENT_PARAMS[key]?.nominalRate ?? null;
}

/**
 * Get volatility for an instrument key (as decimal, e.g. 0.18).
 * Unknown instruments fail closed; callers must establish a catalog mapping.
 */
export function getVolatility(key) {
  return INSTRUMENT_PARAMS[key]?.volatility ?? null;
}

/**
 * Build a RATE_LOOKUP map {key: rate} for projection engine compatibility.
 */
export function buildRateLookup() {
  const lookup = {};
  for (const [key, params] of Object.entries(INSTRUMENT_PARAMS)) {
    lookup[key] = params.nominalRate;
  }
  return lookup;
}

/** Risk-free rate benchmark (FD post-tax approximation) */
export const RISK_FREE_RATE = 0.05;

/** SEBI disclaimer */
export const DISCLAIMER = 'WealthGenie provides AI-generated investment analysis for educational and informational purposes only. It does not constitute registered investment advice under SEBI (Investment Advisers) Regulations, 2013. Past returns are not indicative of future performance. Please consult a SEBI-registered investment adviser before making investment decisions. Mutual fund investments are subject to market risks.';

/**
 * Convert annual return rate (decimal) to monthly rate.
 *
 * BEGINNER NOTE: SIMPLE vs CONTINUOUS COMPOUNDING
 * 1. Simple Compounding (continuous = false): We divide the annual rate by 12 (e.g. 12% annual / 12 = 1% monthly).
 *    This assumes interest is only added at the end of each period.
 * 2. Continuous Compounding (continuous = true): Uses the exponential formula `exp(annualRate / 12) - 1`.
 *    This assumes interest is constantly compounding at every infinitesimal split second, which is standard
 *    in log-normal stock models (like Geometric Brownian Motion used in our Monte Carlo simulator).
 *
 * @param {number} annualRate - Annual rate as a decimal (e.g. 0.12)
 * @param {boolean} [continuous=false] - If true, use exp(rate/12)-1, else rate/12
 * @returns {number} Monthly rate
 */
export function toMonthlyRate(annualRate, continuous = false) {
  if (!Number.isFinite(annualRate)) throw new TypeError('annualRate must be finite');
  return continuous ? Math.exp(annualRate / 12) - 1 : annualRate / 12;
}
