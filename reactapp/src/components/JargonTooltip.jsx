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
    short: 'Projected yearly earnings',
    plain: 'How much your investment is likely to grow per year, shown as a percentage. For example, 12% means ₹10,000 could become ₹11,200 in one year.',
  },
  'Return Potential': {
    short: 'Projected yearly earnings',
    plain: 'The range of growth you can expect per year. The actual return depends on market conditions, but this range is based on historical performance.',
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
    plain: 'Tax on profits when you sell an investment after holding it for a long time (usually 1+ years for equity). Currently 12.5% on gains above ₹1.25 lakh per year.',
  },
  'STCG': {
    short: 'Short-Term Capital Gains Tax',
    plain: 'Tax on profits when you sell an investment quickly (less than 1 year for equity). Currently 20% — that\'s why it\'s better to hold investments longer.',
  },
  'Section 80C': {
    short: 'Tax deduction up to ₹1.5 Lakh',
    plain: 'A tax rule that lets you reduce your taxable income by up to ₹1,50,000 per year. Investments like PPF, ELSS, and tax-saver FDs qualify. Can save you up to ₹46,800 in taxes.',
  },
  'Section 80CCD(1B)': {
    short: 'Extra ₹50,000 NPS deduction',
    plain: 'An additional tax deduction of ₹50,000 specifically for NPS investments, on top of the ₹1.5 lakh 80C limit. Can save you an extra ₹15,600 in taxes.',
  },
  'EEE': {
    short: 'Exempt-Exempt-Exempt',
    plain: 'The best possible tax treatment! Your investment amount, the growth, and the withdrawal are ALL completely tax-free. PPF and SSY enjoy this benefit.',
  },
  'Tax Benefit': {
    short: 'Reduces your tax bill',
    plain: 'This investment qualifies for a tax deduction, meaning the government reduces the amount of income tax you owe. It\'s like getting a discount on your taxes.',
  },
  'Slab Rate': {
    short: 'Your income tax bracket rate',
    plain: 'The tax percentage based on your income level. If you earn ₹10L, you\'re in the 20% slab — meaning gains from this investment will be taxed at 20%.',
  },
  'TDS': {
    short: 'Tax Deducted at Source',
    plain: 'Tax automatically deducted by the bank/institution before paying you. For example, if your FD interest is ₹50,000, the bank deducts ~₹5,000 as TDS and gives you ₹45,000.',
  },
  'Indexation': {
    short: 'Inflation adjustment for tax',
    plain: 'A method that adjusts your purchase price for inflation before calculating tax, reducing your taxable gain. Post-2023, this benefit has been removed for debt mutual funds.',
  },

  // Investment Structure
  'Lock-in Period': {
    short: 'Minimum holding time',
    plain: 'The minimum time you must keep your money invested before you can withdraw it. For example, ELSS has a 3-year lock-in — you cannot access your money before that.',
  },
  'Lock-in': {
    short: 'Minimum holding time',
    plain: 'The minimum time you must keep your money invested. During this period, you cannot withdraw. Longer lock-ins often come with better returns or tax benefits.',
  },
  'SIP': {
    short: 'Systematic Investment Plan',
    plain: 'Investing a fixed amount every month (like ₹2,000) automatically. It\'s the best way to start — you don\'t need to time the market, and it builds discipline.',
  },
  'Lump Sum': {
    short: 'One-time bulk investment',
    plain: 'Investing a large amount all at once instead of monthly. Best when you have spare cash (like a bonus) and the market hasn\'t recently peaked.',
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
    plain: 'A fund that simply buys all the stocks in an index like Nifty 50 in the same proportion. No human bias, very low fees, and historically beats most actively managed funds.',
  },
  'Debt Fund': {
    short: 'Fund that lends money to companies/govt',
    plain: 'A mutual fund that invests in bonds and loans instead of stocks. Much more stable than equity funds — your money grows slowly but steadily, like a safer FD alternative.',
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
    plain: 'A government pension scheme that invests your money in a mix of stocks and bonds until you turn 60. Gives an extra ₹50,000 tax deduction beyond the normal ₹1.5L limit.',
  },
  'SGB': {
    short: 'Sovereign Gold Bond',
    plain: 'Gold bonds issued by the government. You earn 2.5% interest plus gold price gains, and if you hold for 8 years, all gains are completely tax-free. Better than buying physical gold.',
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
    short: 'Likelihood of achieving your goal',
    plain: 'The percentage chance of meeting your target amount by the deadline, calculated using thousands of simulated market paths.',
  },
  'P10': {
    short: 'Weak Market Scenario',
    plain: 'A conservative estimate showing what your portfolio value could be in a poor market environment. There is a 90% chance your actual wealth will exceed this amount.',
  },
  'P50': {
    short: 'Typical Market Scenario',
    plain: 'The median estimate showing your projected wealth in a normal, average market environment. There is a 50% chance of exceeding or falling short of this amount.',
  },
  'P90': {
    short: 'Strong Market Scenario',
    plain: 'An optimistic estimate showing your wealth in a very strong bull market. There is only a 10% chance of exceeding this amount, so treat it as a best-case forecast.',
  },
  'Standard Deviation': {
    short: 'Historical volatility / typical variance',
    plain: 'A statistical measure of how much an investment\'s returns fluctuate from its average. Higher standard deviation means more dramatic ups and downs.',
  },
  'Standard Error': {
    short: 'Forecast range uncertainty',
    plain: 'A measure of the uncertainty in our mathematical projection. A smaller standard error means our simulations are more precise and reliable.',
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

