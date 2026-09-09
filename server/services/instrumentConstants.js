/**
 * WealthGenie Projection Model Assumptions — Single Source of Truth
 *
 * These values are frozen policy assumptions used only for model-based projections,
 * recommendation scoring and simulation. They are not observed market facts,
 * provider forecasts, official product rates, or promises of future performance.
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

export const CESS_RATE = 0.04;
export const PROJECTION_ASSUMPTION_VERSION = 'wealthgenie-projection-assumptions-1.0.0';
export const PROJECTION_ASSUMPTION_SOURCE = 'WEALTHGENIE_MODEL_POLICY';
export const PROJECTION_ASSUMPTION_DATA_CLASS = 'MODEL_ASSUMPTION';

// ACCURACY NOTE: nominalRate for Mutual Funds/ETFs is already net of Total Expense Ratio (TER).
// expenseRatio is documented here for transparency and used in risk/Sharpe adjustments.
const rawModelAssumptions = {
  // Versioned scenario inputs. Any future recalibration requires a new assumption
  // version and regression evidence; provider observations must never mutate them.
  FD:           { nominalRate: 7.5,   volatility: 0.005,  expenseRatio: 0.0,    riskLevel: 'Low',        lockIn: 0,  name: 'Bank Fixed Deposit',       tags: ['Model Assumption', 'Verify Bank Terms'] },
  ELSS:         { nominalRate: 14.4,  volatility: 0.18,   expenseRatio: 0.015,  riskLevel: 'High',       lockIn: 3,  name: 'ELSS Mutual Fund',         tags: ['Tax Saving', '80C'] },
  Equity_MF:    { nominalRate: 15.0,  volatility: 0.18,   expenseRatio: 0.015,  riskLevel: 'High',       lockIn: 0,  name: 'Equity Mutual Fund',       tags: ['Wealth Growth'] },
  ETF:          { nominalRate: 14.5,  volatility: 0.16,   expenseRatio: 0.001,  riskLevel: 'Medium',     lockIn: 0,  name: 'Nifty 50 ETF',             tags: ['Passive', 'Low Cost'] },
  Debt_MF:      { nominalRate: 7.7,   volatility: 0.03,   expenseRatio: 0.008,  riskLevel: 'Low-Medium', lockIn: 0,  name: 'Debt Mutual Fund',         tags: ['Liquid'] },
  RBI_Bond:     { nominalRate: 7.5,   volatility: 0.002,  expenseRatio: 0.0,    riskLevel: 'Very Low',   lockIn: 7,  name: 'RBI Savings Bond',         tags: ['Sovereign'] },
  'G-Sec':      { nominalRate: 7.3,   volatility: 0.01,   expenseRatio: 0.0,    riskLevel: 'Very Low',   lockIn: 0,  name: 'Government Security',      tags: ['Sovereign', 'Gilt'] },
  PPF:          { nominalRate: 7.1,   volatility: 0.003,  expenseRatio: 0.0,    riskLevel: 'Very Low',   lockIn: 15, name: 'Public Provident Fund',    tags: ['EEE', 'Tax Free', '80C'] },
  NPS:          { nominalRate: 10.1,  volatility: 0.12,   expenseRatio: 0.0001, riskLevel: 'Medium',     lockIn: 60, name: 'National Pension System',  tags: ['Retirement', '80CCD'] },
  Gold:         { nominalRate: 11.3,  volatility: 0.15,   expenseRatio: 0.005,  riskLevel: 'Medium',     lockIn: 0,  name: 'Gold (Commodity)',          assetClass: 'Commodity', tags: ['Hedge', 'Inflation'] },
  SGB:          { nominalRate: 13.0,  volatility: 0.14,   expenseRatio: 0.0,    riskLevel: 'Low-Medium', lockIn: 8,  name: 'Sovereign Gold Bond',      tags: ['Gold', 'Tax Exempt'] },
  Liquid_MF:    { nominalRate: 6.8,   volatility: 0.005,  expenseRatio: 0.0025, riskLevel: 'Low',        lockIn: 0,  name: 'Liquid Mutual Fund',       tags: ['Emergency Fund', 'T+1'] },
  Arbitrage_MF: { nominalRate: 7.5,   volatility: 0.02,   expenseRatio: 0.0035, riskLevel: 'Low',        lockIn: 0,  name: 'Arbitrage Mutual Fund',    tags: ['Low Volatility', 'Equity Taxed'] },
  Hybrid_MF:    { nominalRate: 11.8,  volatility: 0.10,   expenseRatio: 0.012,  riskLevel: 'Medium',     lockIn: 0,  name: 'Balanced Advantage Fund',  tags: ['Hybrid', 'Dynamic'] },
  Index_MF:     { nominalRate: 14.2,  volatility: 0.16,   expenseRatio: 0.002,  riskLevel: 'Medium',     lockIn: 0,  name: 'Nifty 50 Index Fund',      tags: ['Passive', 'Low Cost'] },
  Midcap_MF:    { nominalRate: 17.5,  volatility: 0.22,   expenseRatio: 0.015,  riskLevel: 'High',       lockIn: 0,  name: 'Mid-Cap Mutual Fund',      tags: ['High Growth'] },
  Smallcap_MF:  { nominalRate: 21.0,  volatility: 0.28,   expenseRatio: 0.015,  riskLevel: 'Very High',  lockIn: 0,  name: 'Small-Cap Mutual Fund',    tags: ['Highest Risk'] },
  SCSS:         { nominalRate: 8.2,   volatility: 0.002,  expenseRatio: 0.0,    riskLevel: 'Very Low',   lockIn: 5,  name: 'Senior Citizens Savings',  tags: ['Sovereign', 'Senior'] },
  SSY:          { nominalRate: 8.2,   volatility: 0.002,  expenseRatio: 0.0,    riskLevel: 'Very Low',   lockIn: 21, name: 'Sukanya Samriddhi',        tags: ['EEE', 'Girl Child'] },
};

export const INSTRUMENT_PARAMS = Object.freeze(Object.fromEntries(
  Object.entries(rawModelAssumptions).map(([key, value]) => [key, Object.freeze({
    ...value,
    dataClass: PROJECTION_ASSUMPTION_DATA_CLASS,
    assumptionVersion: PROJECTION_ASSUMPTION_VERSION,
    source: PROJECTION_ASSUMPTION_SOURCE,
    observedMarketFact: false,
    providerForecast: false,
  })]),
));

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

/** Versioned policy benchmark used only by model scoring; not an observed risk-free product rate. */
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
