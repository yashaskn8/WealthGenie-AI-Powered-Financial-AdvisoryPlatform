/* eslint-disable react-refresh/only-export-components */
/**
 * WealthGenie — Jargon Buster Dictionary & Tooltip Component
 * ─────────────────────────────────────────────────────────────
 * Plain-English definitions for every financial term used in the UI.
 * Designed for middle-class beginners with zero investing knowledge.
 */
import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { HelpCircle } from 'lucide-react';
import './JargonTooltip.css';

// ─── JARGON DICTIONARY ──────────────────────────────────────────
export const JARGON = {
  // Returns & Performance
  'CAGR': {
    short: 'Compound Annual Growth Rate',
    plain: 'The average yearly growth rate of your investment over multiple years, accounting for compounding. Think of it as the "speed" at which your money grows each year.',
  },
  'Expected Return': {
    short: 'Model return assumption',
    plain: 'A versioned input used for model-based projections. It is not a live rate, provider forecast, historical return, or guaranteed outcome.',
  },
  'Return Potential': {
    short: 'Model-assumption range',
    plain: 'A range of versioned projection inputs. It is not an observed market fact, provider forecast, or promise of future performance.',
  },
  'Alpha': {
    short: 'Extra return above the benchmark',
    plain: 'The extra return a fund earns compared to its benchmark index. If Nifty 50 grew 12% and your fund grew 15%, the alpha is 3%.',
  },
  'NAV': {
    short: 'Net Asset Value — price per unit',
    plain: 'The price of one unit of a mutual fund. It goes up when the fund performs well. Similar to a stock\'s share price.',
  },
  'AUM': {
    short: 'Assets Under Management',
    plain: 'The total money managed by a mutual fund. Larger AUM (like ₹50,000 Cr) generally means the fund is popular and well-trusted.',
  },
  'Expense Ratio': {
    short: 'Annual management fee',
    plain: 'The yearly fee the fund charges for managing your money. An expense ratio of 0.5% means they charge ₹50 for every ₹10,000 invested per year. Lower is better.',
  },
  'Benchmark': {
    short: 'Comparison standard',
    plain: 'A standard index (like Nifty 50) used to measure whether a fund is performing well. If your fund beats its benchmark, it\'s doing a good job.',
  },

  // Risk & Volatility
  'Risk Profile': {
    short: 'How much the value can fluctuate',
    plain: 'Indicates how much your investment value might go up or down. "Low Risk" means stable but slower growth. "High Risk" means bigger ups and downs, but potentially higher returns over long periods.',
  },
  'Volatility': {
    short: 'Price ups and downs',
    plain: 'How much the investment\'s value jumps around. High volatility means it can drop 20% one month and rise 25% the next. Over 7+ years, the ups usually outweigh the downs.',
  },
  'Drawdown': {
    short: 'Temporary drop from the peak',
    plain: 'The biggest temporary fall in value from its highest point. A 30% drawdown means your ₹10,000 temporarily became ₹7,000 before recovering.',
  },
  'Market Sensitivity': {
    short: 'How much market changes affect it',
    plain: 'How closely your investment follows overall stock market movements. Government bonds have almost zero sensitivity, while stocks have high sensitivity.',
  },

  // Tax Terms
  'LTCG': {
    short: 'Long-Term Capital Gains Tax',
    plain: 'Tax treatment that may apply to gains after the legally defined holding period. The applicable classification, threshold, rate, fiscal year, and product facts must be established by the server tax policy.',
  },
  'STCG': {
    short: 'Short-Term Capital Gains Tax',
    plain: 'Tax treatment that may apply before the legally defined long-term holding period. The applicable classification and rate depend on the explicit product facts and fiscal-year policy.',
  },
  'Section 80C': {
    short: 'Income-tax deduction category',
    plain: 'A deduction category whose eligibility and limit depend on the selected fiscal-year policy, tax regime, qualifying product, and the user\'s supplied circumstances.',
  },
  'Section 80CCD(1B)': {
    short: 'NPS deduction category',
    plain: 'A deduction category for qualifying NPS contributions. The current limit and actual tax effect must come from the selected server fiscal-year policy and explicit user inputs.',
  },
  'EEE': {
    short: 'Exempt-Exempt-Exempt',
    plain: 'A tax classification describing treatment at contribution, growth, and withdrawal stages. WealthGenie shows it only when product classification and current fiscal-year rules are established.',
  },
  'Tax Benefit': {
    short: 'May affect taxable income',
    plain: 'A deduction or exemption is not an investment return or guaranteed saving. Its effect requires explicit income, regime, fiscal year, eligibility, and product classification.',
  },
  'Slab Rate': {
    short: 'Your income tax bracket rate',
    plain: 'A rate determined from explicit taxable income, income source, regime, deductions, and fiscal-year rules. It is calculated only by the backend tax engine.',
  },
  'TDS': {
    short: 'Tax Deducted at Source',
    plain: 'Tax that a payer may deduct before payment under applicable rules. It is not necessarily the final tax liability; current thresholds and treatment come from the selected fiscal-year policy.',
  },
  'Indexation': {
    short: 'Inflation adjustment for tax',
    plain: 'A tax calculation mechanism that may adjust acquisition cost for inflation. Availability depends on current law and a verified product classification.',
  },

  // Investment Structure
  'Lock-in Period': {
    short: 'Minimum holding time',
    plain: 'The minimum time you must keep your money invested before you can withdraw it. For example, ELSS has a 3-year lock-in — you cannot access your money before that.',
  },
  'Lock-in': {
    short: 'Minimum holding time',
    plain: 'The minimum holding restriction for a specific product. A longer lock-in does not by itself establish a better return or tax outcome.',
  },
  'SIP': {
    short: 'Systematic Investment Plan',
    plain: 'A recurring investment instruction. Suitability, amount, product selection, costs, and market risk still need to be evaluated for the investor.',
  },
  'Lump Sum': {
    short: 'One-time bulk investment',
    plain: 'A one-time investment rather than recurring contributions. Whether it is suitable depends on liquidity needs, risk capacity, horizon, and the selected product.',
  },
  'Liquidity': {
    short: 'How quickly you can access your money',
    plain: 'How easily you can convert your investment back to cash. A savings account has high liquidity (instant), while PPF has low liquidity (15-year lock-in).',
  },
  'Maturity': {
    short: 'When the investment completes its term',
    plain: 'The date when your investment reaches its full term and you get your money back. For PPF, maturity is after 15 years.',
  },
  'Sovereign Guarantee': {
    short: 'Government-backed safety',
    plain: 'A sovereign guarantee is a Government of India obligation for the specific covered instrument. It does not remove inflation, liquidity, reinvestment, or market-price risk.',
  },

  // Fund Types
  'ELSS': {
    short: 'Equity Linked Savings Scheme',
    plain: 'A type of mutual fund that invests in stocks AND gives you a tax deduction under Section 80C. It has the shortest lock-in (3 years) among all tax-saving options.',
  },
  'ETF': {
    short: 'Exchange-Traded Fund',
    plain: 'A mutual fund that you can buy and sell on the stock exchange in real-time (like a stock), instead of waiting for end-of-day NAV. Requires a demat account.',
  },
  'Index Fund': {
    short: 'Fund that copies the market index',
    plain: 'A fund intended to track a stated index. Exact holdings, tracking difference, expense ratio, benchmark, and historical results require verified product facts.',
  },
  'Debt Fund': {
    short: 'Fund that lends money to companies/govt',
    plain: 'A mutual fund investing primarily in debt instruments. Credit, duration, liquidity, interest-rate, and capital-loss risks depend on the exact portfolio and product.',
  },
  'Balanced Advantage Fund': {
    short: 'Auto-balancing equity + debt fund',
    plain: 'A smart fund that automatically increases stock allocation when markets are cheap and shifts to bonds when markets are expensive. Good for beginners who want "set and forget" investing.',
  },

  // Government Schemes
  'PPF': {
    short: 'Public Provident Fund',
    plain: 'A long-term government savings scheme whose administered interest rate and tax treatment are governed by current rules. It has a 15-year term and restricted liquidity.',
  },
  'NPS': {
    short: 'National Pension System',
    plain: 'A retirement system with investment, access, and tax rules that depend on the current official policy and the user\'s circumstances. No tax saving is assumed here.',
  },
  'SGB': {
    short: 'Sovereign Gold Bond',
    plain: 'A government-issued gold-linked bond. Coupon, maturity, liquidity, issue availability, and tax treatment must be verified for the exact tranche and fiscal year.',
  },
  'SCSS': {
    short: 'Senior Citizens Savings Scheme',
    plain: 'A government-backed savings scheme for eligible senior citizens with quarterly interest payments. The administered rate and eligibility rules can change.',
  },

  // Miscellaneous
  'Demat Account': {
    short: 'Digital account to hold investments',
    plain: 'An electronic account (like a digital locker) where your stocks, ETFs, and bonds are stored. Required for trading on the stock exchange. You can open one through Zerodha, Groww, etc.',
  },
  'Portfolio': {
    short: 'Your collection of investments',
    plain: 'All your investments combined. If you have ₹50,000 in PPF, ₹30,000 in an index fund, and ₹20,000 in FD — that\'s your portfolio.',
  },
  'Diversification': {
    short: 'Don\'t put all eggs in one basket',
    plain: 'Spreading your money across different types of investments (stocks, bonds, gold, FDs) so that if one drops, the others protect your total wealth.',
  },
  'Rebalancing': {
    short: 'Adjusting your investment mix',
    plain: 'Periodically adjusting your portfolio to maintain your target allocation. If stocks grew a lot and now make up 80% instead of 60%, you sell some stocks and buy more bonds.',
  },
  'Compounding': {
    short: 'Earning returns on your returns',
    plain: 'When your earnings themselves start generating earnings. ₹1,00,000 at 10% becomes ₹1,10,000 in year 1, then ₹1,21,000 in year 2 (not just ₹1,20,000). This snowball effect is why starting early matters so much.',
  },
  'Inflation': {
    short: 'Rising prices over time',
    plain: 'The rate at which things get more expensive every year (about 6% in India). If your investment doesn\'t beat inflation, you\'re actually losing purchasing power even though the number looks bigger.',
  },
  'DICGC': {
    short: 'Deposit Insurance Corporation',
    plain: 'A government body (under RBI) that insures your bank deposits up to ₹5 lakhs. Even if your bank goes bankrupt, DICGC will pay you back up to ₹5,00,000.',
  },
  'SEBI': {
    short: 'Securities Exchange Board of India',
    plain: 'The government regulator that monitors the stock market and mutual funds. SEBI ensures that fund companies don\'t cheat investors and follow strict rules.',
  },
  'Drift Tolerance': {
    short: 'Allowable track drift percentage',
    plain: 'How far an investment is allowed to drift from its target mix before we recommend a fix. E.g., a 2% drift tolerance means if a 20% target becomes 22% or 18%, we recommend rebalancing.',
  },
  'Rebalance Ratio': {
    short: 'Adjustment speed/strength',
    plain: 'Controls whether to fully rebalance (100%) or do a partial rebalance. Partial rebalancing (e.g. 50%) reduces transaction costs and taxes while still reducing portfolio risk.',
  },
  'Portfolio Ledger': {
    short: 'Record of your investments',
    plain: 'A ledger tracking the actual quantities and values of assets you own. In our system, you can use Sandbox/Demo mode or input your Live Ledger holdings.',
  },
  'Asset Class': {
    short: 'Category of investments',
    plain: 'Groups of investments that act similarly, such as Equity (shares in companies), Debt (bonds and fixed deposits), and Gold/Commodities.',
  },
  'Asset Allocation': {
    short: 'Your investment mix',
    plain: 'How you divide your total money among different categories (like stocks, bonds, and gold) to balance risk and growth potential.',
  },
  'Success Probability': {
    short: 'Share of simulated paths reaching the goal',
    plain: 'A model result calculated from simulated paths and versioned assumptions. It is not an observed probability, guarantee, or provider forecast.',
  },
  'P10': {
    short: 'Simulated 10th percentile',
    plain: 'Ten percent of modeled terminal values are at or below this amount under the supplied simulation assumptions. It is not a worst-case prediction.',
  },
  'P50': {
    short: 'Simulated median',
    plain: 'Half of modeled terminal values are at or below this amount under the supplied simulation assumptions. It is not a forecast of the most likely outcome.',
  },
  'P90': {
    short: 'Simulated 90th percentile',
    plain: 'Ninety percent of modeled terminal values are at or below this amount under the supplied simulation assumptions. It is not a best-case forecast.',
  },
  'Standard Deviation': {
    short: 'Historical volatility / typical variance',
    plain: 'A statistical measure of how much an investment\'s returns fluctuate from its average. Higher standard deviation means more dramatic ups and downs.',
  },
  'Standard Error': {
    short: 'Simulation-estimate uncertainty',
    plain: 'A measure of sampling uncertainty in a model estimate. It does not establish that the assumptions or future outcomes are correct.',
  },
  'Monte Carlo': {
    short: 'Market simulator',
    plain: 'A statistical technique that runs 1,000+ simulations of different market ups and downs to show the range of possible future values for your investments.',
  },
};

// ─── TOOLTIP COMPONENT ──────────────────────────────────────────
const JargonTooltip = ({ term, children }) => {
  const [show, setShow] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, placement: 'below' });
  const triggerRef = useRef(null);
  const timeoutRef = useRef(null);
  const entry = JARGON[term];

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const tooltipWidth = 300;
    const tooltipHeight = 180;
    const gap = 8;

    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    if (left < 8) left = 8;
    if (left + tooltipWidth > window.innerWidth - 8) left = window.innerWidth - tooltipWidth - 8;

    // Prefer below, but if near bottom of screen, show above
    const spaceBelow = window.innerHeight - rect.bottom;
    let placement = 'below';
    let top = rect.bottom + gap;

    if (spaceBelow < tooltipHeight + 20) {
      placement = 'above';
      top = rect.top - gap;
    }

    setPosition({ top, left, placement });
  };

  const handleEnter = () => {
    clearTimeout(timeoutRef.current);
    updatePosition();
    setShow(true);
  };

  const handleLeave = () => {
    timeoutRef.current = setTimeout(() => setShow(false), 150);
  };

  useEffect(() => {
    return () => clearTimeout(timeoutRef.current);
  }, []);

  if (!entry) return children || term;

  return (
    <>
      <span
        ref={triggerRef}
        className="jargon-trigger"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onClick={(e) => { e.stopPropagation(); setShow(s => !s); updatePosition(); }}
        role="button"
        tabIndex={0}
        aria-label={`Learn what "${term}" means`}
      >
        {children || term}
        <HelpCircle size={10} className="jargon-help-icon" />
      </span>
      {show && ReactDOM.createPortal(
        <div
          className={`jargon-tooltip jargon-tooltip--${position.placement}`}
          style={{ top: position.top, left: position.left }}
          onMouseEnter={() => { clearTimeout(timeoutRef.current); }}
          onMouseLeave={handleLeave}
        >
          <div className="jargon-tooltip-arrow" />
          <div className="jargon-tooltip-title">{term}</div>
          <div className="jargon-tooltip-short">{entry.short}</div>
          <div className="jargon-tooltip-plain">{entry.plain}</div>
        </div>,
        document.body
      )}
    </>
  );
};

export default JargonTooltip;

