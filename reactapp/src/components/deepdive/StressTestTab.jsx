/**
 * DeepDiveModal — Stress Test Tab (Crash & Macro Shock Simulator)
 * Extracted and optimized for high-fidelity financial modeling & premium UI.
 */
import React from 'react';
import { 
  AlertCircle, 
  Info, 
  Flame, 
  ShieldCheck, 
  TrendingDown, 
  TrendingUp, 
  Percent, 
  Zap, 
  Compass, 
  AlertTriangle 
} from 'lucide-react';
import { formatINR } from '../../utils/indianNumberFormat';

const StressTestTab = ({ inv, stressTestAmount, setStressTestAmount }) => {
  const getScenarios = (instrument) => {
    const id = (instrument.id || '').toLowerCase();
    const cat = (instrument.category || instrument.cat || '').toLowerCase();
    const name = (instrument.name || '').toLowerCase();
    
    // 1. Guaranteed Principal / Sovereign / Bank Deposits (No market loss, only inflation/liquidity drag)
    const isGuaranteed = cat.includes('government') || 
                         cat.includes('sovereign') || 
                         cat.includes('deposit') || 
                         ['ppf', 'scss', 'sukanya', 'nsc', 'kvp', 'pomis', 'mssc', 'apy', 'fd'].includes(id) ||
                         name.includes('provident fund') || 
                         name.includes('fixed deposit') || 
                         name.includes('recurring deposit');

    // 2. Liquid / Low-Duration Debt (very low market risk)
    const isLiquidDebt = id.includes('liquid') || 
                         id.includes('arbitrage') || 
                         name.includes('liquid') || 
                         name.includes('overnight');

    // 3. Medium/Long-Duration Debt / Corporate Bonds / Debt MFs (interest rate & credit risk)
    const isLongDebt = (cat.includes('debt') || cat.includes('bond') || name.includes('bond') || id.includes('debt_mf') || id.includes('gilt')) && !isLiquidDebt && !isGuaranteed;

    // 4. Gold (Commodity cycles)
    const isGold = cat.includes('gold') || id.includes('gold') || id === 'sgb' || name.includes('gold') || name.includes('sgb');

    // 5. REITs & InvITs
    const isReit = cat.includes('reit') || cat.includes('invit') || name.includes('reit') || name.includes('invit');

    // 6. Equity (Split by Mid/Small cap vs Large cap/Passive)
    const isMidSmallEquity = id.includes('midcap') || 
                             id.includes('smallcap') || 
                             id.includes('microcap') || 
                             id.includes('sectoral') || 
                             id.includes('thematic') || 
                             name.includes('mid cap') || 
                             name.includes('small cap') || 
                             id === 'direct_equity';

    const _isLargeEquity = (cat.includes('equity') || cat.includes('etf') || id.includes('nifty') || id.includes('index') || name.includes('index') || name.includes('etf') || name.includes('hybrid') || name.includes('elss')) && !isMidSmallEquity;

    if (isGuaranteed) {
      return {
        type: 'guaranteed',
        title: 'Principal-Guaranteed Sovereign Asset',
        icon: <ShieldCheck size={20} color="#10b981" />,
        badgeColor: '#10b981',
        desc: 'This asset carries an absolute Government of India sovereign guarantee or is covered by RBI\'s DICGC insurance up to ₹5 Lakhs. Default/market drawdown risk is mathematically zero.',
        scenarios: [
          {
            name: '2013 Inflation Spike (Real Return Drag)',
            period: 'Jan 2013 – Nov 2013',
            drop: 0,
            realDrag: -4.1, // -4.1% real yield
            recovery: 'Systemic stabilization',
            recoveryMultiplier: 1.0,
            cause: 'CPI retail inflation spiked to 11.2% due to supply shocks. With a fixed nominal yield, the purchasing power of your investment eroded by 4.1% in real terms.',
            type: 'inflation',
            badge: 'Purchasing Power Shock'
          },
          {
            name: 'Premature Liquidity Break Penalty',
            period: 'Emergency Withdrawal Event',
            drop: 1.0, // 1% penalty
            isPenalty: true,
            recovery: 'Instant cash settlement',
            recoveryMultiplier: 0.99, // -1% penalty applied
            cause: 'Breaking a fixed deposit or post office scheme early to address immediate cash needs triggers a standard 1.0% premature penalty, forfeiting accrued interest.',
            type: 'liquidity',
            badge: 'Exit Penalty'
          }
        ]
      };
    }

    if (isLiquidDebt) {
      return {
        type: 'liquid_debt',
        title: 'Liquid & Overnight Money Markets',
        icon: <Compass size={20} color="#14b8a6" />,
        badgeColor: '#14b8a6',
        desc: 'Very high safety with T+1 settlement. Invests in sovereign bills and short-term debt papers. Exposed only to minor money-market volatility.',
        scenarios: [
          {
            name: '2020 COVID Liquidity Freeze',
            period: 'Mar 2020 – Apr 2020',
            drop: -0.4,
            recovery: '7 Days',
            recoveryMultiplier: 1.002,
            cause: 'Massive institutional redemptions caused money-market yields to spike briefly, creating a temporary minor drop in NAV that recovered in days.',
            type: 'market',
            badge: 'Liquidity Squeeze'
          },
          {
            name: 'Credit Default Stress Test',
            period: 'Simulated Single-Issuer Default',
            drop: -2.5,
            recovery: '4 Months',
            recoveryMultiplier: 1.015,
            cause: 'A commercial paper issuer undergoes downgrade/default, forcing the fund to write down 2.5% of its portfolio. Recovered via interest accruals from remaining assets.',
            type: 'credit',
            badge: 'Credit Default'
          }
        ]
      };
    }

    if (isLongDebt) {
      return {
        type: 'long_debt',
        title: 'Medium/Long Duration Fixed Income',
        icon: <Percent size={20} color="#06b6d4" />,
        badgeColor: '#06b6d4',
        desc: 'Sensitive to interest rate hikes (duration risk) and corporate rating actions. Undergoes price corrections when yields spike.',
        scenarios: [
          {
            name: '2013 Fed Taper Tantrum',
            period: 'May 2013 – Sep 2013',
            drop: -5.5,
            recovery: '6 Months',
            recoveryMultiplier: 1.04,
            cause: 'Sudden sell-off in sovereign debt after US Fed tapering announcements. Indian 10-year yield spiked from 7.1% to 9.2%, depressing bond prices.',
            type: 'rate',
            badge: 'Duration Shock'
          },
          {
            name: 'Corporate NBFC Credit Crisis',
            period: 'Sep 2018 – Oct 2019',
            drop: -9.5,
            recovery: '14 Months',
            recoveryMultiplier: 1.05,
            cause: 'Defaults by massive shadow-banks (IL&FS/DHFL) caused a credit squeeze. Bond mutual funds had to write off toxic exposures entirely.',
            type: 'credit',
            badge: 'Credit Event'
          }
        ]
      };
    }

    if (isGold) {
      return {
        type: 'gold',
        title: 'Safe Haven Commodity (Gold / SGB)',
        icon: <Zap size={20} color="#eab308" />,
        badgeColor: '#eab308',
        desc: 'Acts as a systemic hedge against inflation and equity crashes. However, it can undergo multi-year sideways cycles or dollar-driven corrections.',
        scenarios: [
          {
            name: '2013 Gold Bear Market',
            period: 'Apr 2013 – Dec 2015',
            drop: -26.0,
            recovery: '60 Months',
            recoveryMultiplier: 1.08,
            cause: 'Fed QE tapering announcements, strong US Dollar, and import tariff hikes by India to 10% dampened domestic retail gold demand.',
            type: 'commodity',
            badge: 'Cycle Correction'
          },
          {
            name: '2020 Post-COVID Rotational Outflow',
            period: 'Aug 2020 – Mar 2021',
            drop: -15.4,
            recovery: '18 Months',
            recoveryMultiplier: 1.03,
            cause: 'Safe-haven demand collapsed as vaccines rolled out. Capital rotated out of gold and back into high-yield equities, triggering profit-booking.',
            type: 'market',
            badge: 'Risk-On Rotation'
          }
        ]
      };
    }

    if (isReit) {
      return {
        type: 'reit',
        title: 'Real Estate Investment Trust (REIT)',
        icon: <Compass size={20} color="#ec4899" />,
        badgeColor: '#ec4899',
        desc: 'Provides stable rent-backed dividend distributions, but suffers capital price volatility due to commercial vacancy rates and debt financing costs.',
        scenarios: [
          {
            name: '2020 Commercial Vacancy Shock',
            period: 'Mar 2020 – Nov 2020',
            drop: -18.2,
            recovery: '15 Months',
            recoveryMultiplier: 1.06,
            cause: 'Global pandemic lockdowns forced work-from-home policies. Commercial leasing ground to a halt, causing market panic about vacancy rates.',
            type: 'vacancy',
            badge: 'Occupancy Shock'
          },
          {
            name: '2022 Yield Competitiveness Correction',
            period: 'Apr 2022 – Dec 2022',
            drop: -10.5,
            recovery: '12 Months',
            recoveryMultiplier: 1.02,
            cause: 'Rising global interest rates pushed Indian sovereign yields above 7.5%. This compressed the yield premium of REITs, causing investor sell-offs.',
            type: 'rate',
            badge: 'Spread Compression'
          }
        ]
      };
    }

    if (isMidSmallEquity) {
      return {
        type: 'midsmall_equity',
        title: 'High-Beta Mid & Small-Cap Equity',
        icon: <AlertTriangle size={20} color="#ef4444" />,
        badgeColor: '#ef4444',
        desc: 'Superior growth asset over long cycles, but undergoes extreme corrections and high volatility during panic selloffs due to lower market liquidity.',
        scenarios: [
          {
            name: '2008 Global Credit Crash',
            period: 'Jan 2008 – Mar 2009',
            drop: -72.0,
            recovery: '66 Months (5.5 Years)',
            recoveryMultiplier: 1.25,
            cause: 'Global financial crisis dried up credit. Small/mid-caps heavily reliant on bank funding saw operating margins collapse, resulting in panic capitulation.',
            type: 'market',
            badge: 'Liquidity Crash'
          },
          {
            name: '2018 Mid-Cap Valuation Correction',
            period: 'Jan 2018 – Feb 2020',
            drop: -42.5,
            recovery: '32 Months',
            recoveryMultiplier: 1.15,
            cause: 'Implementation of LTCG tax on equity, SEBI reclassification forcing mutual funds to sell small-caps, and severe valuation bubble bursting.',
            type: 'regulatory',
            badge: 'Valuation De-rating'
          },
          {
            name: '2020 COVID-19 Panic Sell-Off',
            period: 'Feb 2020 – Mar 2020',
            drop: -46.8,
            recovery: '10 Months',
            recoveryMultiplier: 1.35,
            cause: 'Lockdown fears caused unprecedented capital preservation selloffs. The illiquid nature of smaller stocks accelerated the drop before a massive recovery.',
            type: 'market',
            badge: 'Systemic Panic'
          }
        ]
      };
    }

    // Default: Large-Cap Equity / Passive Index
    return {
      type: 'large_equity',
      title: 'Large-Cap Blue-Chip / Diversified Equity',
      icon: <TrendingUp size={20} color="#38bdf8" />,
      badgeColor: '#38bdf8',
      desc: 'Invests in India\'s largest market leaders. Exposed to macroeconomic fluctuations, global inflation cycles, and institutional capital flows.',
      scenarios: [
        {
          name: '2008 Global Financial Crisis',
          period: 'Jan 2008 – Mar 2009',
          drop: -59.5,
          recovery: '36 Months (3 Years)',
          recoveryMultiplier: 1.20,
          cause: 'Bankruptcy of Lehman Brothers and global liquidity deleveraging. FIIs dumped Indian equities, dragging Nifty 50 down from 6,287 to 2,524.',
          type: 'market',
          badge: 'Global Meltdown'
        },
        {
          name: '2020 COVID-19 Pandemic Crash',
          period: 'Feb 2020 – Mar 2020',
          drop: -38.2,
          recovery: '9 Months',
          recoveryMultiplier: 1.18,
          cause: 'Nationwide lockdowns raised fears of systemic corporate insolvency. Equity markets crashed in lockstep globally before massive RBI/government stimulus.',
          type: 'market',
          badge: 'Pandemic Panic'
        },
        {
          name: '2022 Fed Rate Hiking Cycle',
          period: 'Oct 2021 – Jun 2022',
          drop: -16.8,
          recovery: '7 Months',
          recoveryMultiplier: 1.08,
          cause: 'US Fed raised interest rates aggressively to combat inflation, combined with the Russia-Ukraine war. FIIs pulled out ₹1.4 Lakh Crore from India.',
          type: 'macro',
          badge: 'Monetary Tightening'
        }
      ]
    };
  };

  const assetProfile = getScenarios(inv);
  const testAmount = stressTestAmount;

  return (
    <div className="tab-fade-in" style={{ padding: '8px 0' }}>
      <div className="ddm-section-header" style={{ marginBottom: 12 }}>Crash Stress Test</div>

      {/* Asset classification card */}
      <div className="stress-asset-header" style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '16px 20px',
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: '16px',
        marginBottom: 20
      }}>
        <div style={{
          width: '38px',
          height: '38px',
          borderRadius: '10px',
          background: 'rgba(255, 255, 255, 0.04)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {assetProfile.icon}
        </div>
        <div>
          <div style={{ fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--ddm-text-muted)', letterSpacing: '1px' }}>Asset Category</div>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: '#f8fafc', marginTop: 1 }}>{assetProfile.title}</div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: '0.72rem', color: '#94a3b8', maxWidth: '50%', textAlign: 'right', lineHeight: '1.4' }}>
          {assetProfile.desc}
        </div>
      </div>

      <div className="stress-hero">
        <div className="stress-hero-icon"><Flame size={24} /></div>
        <div>
          <div className="stress-hero-title">What happens when markets crash?</div>
          <div className="stress-hero-subtitle">
            Every asset undergoes volatility cycles. The simulator below lets you model historical stress events using your planned investment principal. Remember: <strong style={{ color: '#fbbf24' }}>patient investors survive corrections</strong>.
          </div>
        </div>
      </div>

      <div className="stress-amount-input-container">
        <label className="stress-amount-label">Enter your investment principal to test</label>
        <div className="stress-amount-input-wrapper">
          <span className="stress-amount-prefix">₹</span>
          <input
            type="number"
            className="stress-amount-input"
            value={stressTestAmount}
            onChange={(e) => {
              const val = Math.max(1000, Math.min(10000000, Number(e.target.value) || 0));
              setStressTestAmount(val);
            }}
            min={1000}
            max={10000000}
            step={5000}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <span className="stress-amount-hint">Min ₹1,000 · Max ₹1 Crore</span>
          <span style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 700 }}>Adjust values to see live projection shift</span>
        </div>
      </div>

      <div className="stress-scenarios">
        {assetProfile.scenarios.map((crash, i) => {
          let bottomValue, lostAmount;
          let labelText = "Max Drawdown";
          let labelColor = "#f43f5e";
          let isLoss = true;
          
          if (crash.isPenalty) {
            lostAmount = testAmount * (Math.abs(crash.drop) / 100);
            bottomValue = testAmount - lostAmount;
            labelText = "Exit Penalty";
            labelColor = "#fb923c";
          } else if (crash.realDrag) {
            lostAmount = testAmount * (Math.abs(crash.realDrag) / 100);
            bottomValue = testAmount - lostAmount;
            labelText = "Purchasing Power Loss";
            labelColor = "#fb923c";
            isLoss = false;
          } else {
            lostAmount = testAmount * (Math.abs(crash.drop) / 100);
            bottomValue = testAmount - lostAmount;
          }

          const recoveryValue = Math.round(testAmount * crash.recoveryMultiplier);
          const recoveryGain = recoveryValue - testAmount;

          return (
            <div key={i} className="stress-card" style={{ padding: '0 0 16px' }}>
              <div className="stress-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className="stress-card-emoji">
                    {isLoss ? <TrendingDown size={18} /> : <AlertCircle size={18} color="#fb923c" />}
                  </div>
                  <div>
                    <div className="stress-card-name">{crash.name}</div>
                    <div className="stress-card-period">{crash.period}</div>
                  </div>
                </div>
                <div style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  fontSize: '0.62rem',
                  fontWeight: '850',
                  textTransform: 'uppercase',
                  color: labelColor,
                  letterSpacing: '0.5px'
                }}>
                  {crash.badge}
                </div>
              </div>

              <div className="stress-card-body">
                <div className="stress-card-cause" style={{ marginBottom: 20 }}>{crash.cause}</div>

                <div className="stress-drop-visual" style={{ marginBottom: 20 }}>
                  <div className="stress-drop-bar" style={{ background: 'rgba(255, 255, 255, 0.03)', height: '8px' }}>
                    <div
                      className="stress-drop-bar-fill"
                      style={{ 
                        width: `${Math.max(3, Math.min(Math.abs(crash.realDrag || crash.drop), 100))}%`,
                        background: crash.realDrag || crash.isPenalty 
                          ? 'linear-gradient(90deg, #f59e0b, #fb923c)'
                          : 'linear-gradient(90deg, #f43f5e, #ef4444)',
                        boxShadow: crash.realDrag || crash.isPenalty
                          ? '0 0 8px rgba(245, 158, 11, 0.4)'
                          : '0 0 8px rgba(244, 63, 94, 0.4)'
                      }}
                    />
                  </div>
                  <div className="stress-drop-stats" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div className="stress-stat">
                      <span className="stress-stat-label">{labelText}</span>
                      <span className="stress-stat-value" style={{ color: labelColor }}>
                        {crash.realDrag ? `${crash.realDrag}%` : `-${crash.drop}%`}
                      </span>
                    </div>
                    <div className="stress-stat" style={{ textAlign: 'right' }}>
                      <span className="stress-stat-label">Recovery Period</span>
                      <span className="stress-stat-value stress-stat-value--recovery">{crash.recovery}</span>
                    </div>
                  </div>
                </div>

                <div className="stress-scenario-box">
                  <div className="stress-scenario-title" style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
                    Principal Value Impact Simulation
                  </div>
                  <div className="stress-scenario-flow">
                    <div className="stress-flow-item">
                      <span className="stress-flow-label">1. Starting Capital</span>
                      <span className="stress-flow-value" style={{ color: '#fff' }}>{formatINR(testAmount)}</span>
                    </div>
                    <span className="stress-flow-arrow">→</span>
                    <div className="stress-flow-item stress-flow-item--drop">
                      <span className="stress-flow-label">2. Crash Bottom</span>
                      <span className="stress-flow-value">
                        {formatINR(bottomValue)}
                      </span>
                    </div>
                    <span className="stress-flow-arrow">→</span>
                    <div className="stress-flow-item stress-flow-item--recover">
                      <span className="stress-flow-label">3. Post-Recovery</span>
                      <span className="stress-flow-value">{formatINR(recoveryValue)}</span>
                      {recoveryGain !== 0 && (
                        <span style={{ fontSize: '0.62rem', color: recoveryGain > 0 ? '#10b981' : '#ef4444', fontWeight: 900, marginTop: 1 }}>
                          {recoveryGain > 0 ? 'Net Gain: +' : 'Net Loss: '}{formatINR(recoveryGain)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="stress-insight">
        <div className="stress-insight-icon"><Info size={24} /></div>
        <div>
          <div className="stress-insight-title">The #1 Rule During Downturns</div>
          <div className="stress-insight-text">
            {assetProfile.type === 'guaranteed'
              ? 'Your capital remains 100% secure in terms of nominal rupees. The true risk is opportunity cost and inflation erosion. In rate hike cycles, locking long-term FDs too early could mean missing out on higher rates.'
              : assetProfile.type === 'liquid_debt'
                ? 'Liquid instruments have extremely small drawdowns that recover in days. In credit default scenarios, SEBI regulation limits concentration risk so no single corporate default can derail your entire principal.'
                : assetProfile.type === 'long_debt'
                  ? 'Bond prices have an inverse relationship with interest rates. When RBI hikes rates, bond values drop. However, if you hold the fund for its duration, these price fluctuations merge back into maturity interest yields.'
                  : assetProfile.type === 'gold'
                    ? 'Gold is a safe-haven anchor during global crises. While gold corrections can sometimes last years, it offers unmatched systemic protection when equities are crashing.'
                    : assetProfile.type === 'reit'
                      ? 'REIT volatility is highly correlation-linked to physical leasing. The underlying assets are commercial properties — during vacuum periods, tenant distributions might decrease, but real property valuations buffer long-term returns.'
                      : 'Investors who stayed invested through Nifty crashes (like 2008 and 2020) saw complete recoveries and massive growth. Panic-selling during a crash converts temporary market paper-losses into permanent cash losses.'
            }
          </div>
        </div>
      </div>

      <p style={{ color: 'var(--ddm-text-muted)', fontSize: '0.65rem', marginTop: 16, textAlign: 'center', fontStyle: 'italic', lineHeight: 1.5 }}>
        * Historical drawdowns sourced from NSE (Nifty 50), BSE (Sensex), CRISIL Fixed Income Indexes, and MCX Gold data.
        Recovery period indicates historical duration to reclaim previous peak value. Past performance is not predictive of future returns.
      </p>
    </div>
  );
};

export default StressTestTab;
