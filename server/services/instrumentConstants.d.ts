/**
 * Update live parameters dynamically (used by marketDataService).
 *
 * @param {string} key - Instrument key (e.g. 'FD', 'Equity_MF')
 * @param {number} [nominalRate] - Live nominal return rate (percentage, e.g. 6.5)
 * @param {number} [volatility] - Live annualised volatility (decimal, e.g. 0.18)
 */
export function updateLiveParam(key: string, nominalRate?: number, volatility?: number): void;
/**
 * Get nominal rate for an instrument key (as percentage, e.g. 12.5).
 * Returns null when the instrument is unknown.
 */
export function getNominalRate(key: unknown): number | null;
/**
 * Get volatility for an instrument key (as decimal, e.g. 0.18).
 * Returns null when the instrument is unknown.
 */
export function getVolatility(key: unknown): number | null;
/**
 * Build a RATE_LOOKUP map {key: rate} for projection engine compatibility.
 */
export function buildRateLookup(): {};
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
export function toMonthlyRate(annualRate: number, continuous?: boolean): number;
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
export const CESS_RATE: 0.04;
export const INSTRUMENT_PARAMS: {
    FD: {
        nominalRate: number;
        volatility: number;
        expenseRatio: number;
        riskLevel: string;
        lockIn: number;
        name: string;
        tags: string[];
    };
    ELSS: {
        nominalRate: number;
        volatility: number;
        expenseRatio: number;
        riskLevel: string;
        lockIn: number;
        name: string;
        tags: string[];
    };
    Equity_MF: {
        nominalRate: number;
        volatility: number;
        expenseRatio: number;
        riskLevel: string;
        lockIn: number;
        name: string;
        tags: string[];
    };
    ETF: {
        nominalRate: number;
        volatility: number;
        expenseRatio: number;
        riskLevel: string;
        lockIn: number;
        name: string;
        tags: string[];
    };
    Debt_MF: {
        nominalRate: number;
        volatility: number;
        expenseRatio: number;
        riskLevel: string;
        lockIn: number;
        name: string;
        tags: string[];
    };
    RBI_Bond: {
        nominalRate: number;
        volatility: number;
        expenseRatio: number;
        riskLevel: string;
        lockIn: number;
        name: string;
        tags: string[];
    };
    'G-Sec': {
        nominalRate: number;
        volatility: number;
        expenseRatio: number;
        riskLevel: string;
        lockIn: number;
        name: string;
        tags: string[];
    };
    PPF: {
        nominalRate: number;
        volatility: number;
        expenseRatio: number;
        riskLevel: string;
        lockIn: number;
        name: string;
        tags: string[];
    };
    NPS: {
        nominalRate: number;
        volatility: number;
        expenseRatio: number;
        riskLevel: string;
        lockIn: number;
        name: string;
        tags: string[];
    };
    Gold: {
        nominalRate: number;
        volatility: number;
        expenseRatio: number;
        riskLevel: string;
        lockIn: number;
        name: string;
        tags: string[];
    };
    SGB: {
        nominalRate: number;
        volatility: number;
        expenseRatio: number;
        riskLevel: string;
        lockIn: number;
        name: string;
        tags: string[];
    };
    Liquid_MF: {
        nominalRate: number;
        volatility: number;
        expenseRatio: number;
        riskLevel: string;
        lockIn: number;
        name: string;
        tags: string[];
    };
    Arbitrage_MF: {
        nominalRate: number;
        volatility: number;
        expenseRatio: number;
        riskLevel: string;
        lockIn: number;
        name: string;
        tags: string[];
    };
    Hybrid_MF: {
        nominalRate: number;
        volatility: number;
        expenseRatio: number;
        riskLevel: string;
        lockIn: number;
        name: string;
        tags: string[];
    };
    Index_MF: {
        nominalRate: number;
        volatility: number;
        expenseRatio: number;
        riskLevel: string;
        lockIn: number;
        name: string;
        tags: string[];
    };
    Midcap_MF: {
        nominalRate: number;
        volatility: number;
        expenseRatio: number;
        riskLevel: string;
        lockIn: number;
        name: string;
        tags: string[];
    };
    Smallcap_MF: {
        nominalRate: number;
        volatility: number;
        expenseRatio: number;
        riskLevel: string;
        lockIn: number;
        name: string;
        tags: string[];
    };
    SCSS: {
        nominalRate: number;
        volatility: number;
        expenseRatio: number;
        riskLevel: string;
        lockIn: number;
        name: string;
        tags: string[];
    };
    SSY: {
        nominalRate: number;
        volatility: number;
        expenseRatio: number;
        riskLevel: string;
        lockIn: number;
        name: string;
        tags: string[];
    };
};
/** Explicit policy benchmark used for pre-tax nominal portfolio comparisons. */
export const RISK_FREE_RATE: 0.05;
/** SEBI disclaimer */
export const DISCLAIMER: "WealthGenie provides AI-generated investment analysis for educational and informational purposes only. It does not constitute registered investment advice under SEBI (Investment Advisers) Regulations, 2013. Past returns are not indicative of future performance. Please consult a SEBI-registered investment adviser before making investment decisions. Mutual fund investments are subject to market risks.";
