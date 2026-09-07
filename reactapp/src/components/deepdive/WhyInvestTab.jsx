/**
 * DeepDiveModal — Why Invest Tab (Cost of Doing Nothing)
 * Extracted from DeepDiveModal.jsx for maintainability.
 */
import React from 'react';
import { TrendingDown, TrendingUp, ArrowRight } from 'lucide-react';
import { formatINR } from '../../utils/indianNumberFormat';

const WhyInvestTab = ({
  inv,
  calcReturn,
  calcYears,
  inflationRate,
  setInflationRate,
  benchmarkRate,
  setBenchmarkRate,
  projection,
  projectionError,
  projectionLoading,
  setActiveTab,
}) => {
  const savingsMaturity = projection?.benchmarkMaturity ?? null;
  const savingsReal = projection?.benchmarkReal ?? null;
  const investMaturity = projection?.investmentMaturity ?? null;
  const investReal = projection?.investmentReal ?? null;
  const opportunityCost = projection?.opportunityCost ?? null;
  const purchasingPowerLost = projection?.purchasingPowerLost ?? null;
  const inflationHalfLifeYears = projection?.inflationHalfLifeYears;
  const erosionData = (projection?.yearlyBreakdown || []).slice(0, 10).map(row => ({
    year: row.year,
    savingsReal: row.benchmarkReal,
    investReal: row.investmentReal,
    principalAtYear: row.invested,
  }));

  return (
    <div className="tab-fade-in">
      <div className="ddm-section-header">Investment and Savings Benchmark Comparison</div>

      {/* Hero Warning Banner */}
      <div className="why-invest-hero">
        <div className="why-invest-hero-icon"><TrendingDown size={24} /></div>
        <div>
          <div className="why-invest-hero-title">Compare purchasing power under explicit assumptions</div>
          <div className="why-invest-hero-subtitle">
            At {inflationRate}% inflation, money's purchasing power halves in about {inflationHalfLifeYears ?? '—'} years.
            At the selected {benchmarkRate}% benchmark, the backend-calculated real annual rate is {projection?.benchmarkRealAnnualRate ?? '—'}%.
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, marginBottom: 20 }}>
        <div className="calc-field">
          <div className="calc-label-row"><label className="metric-label">Savings Benchmark Rate</label><span className="calc-value-display">{benchmarkRate}%</span></div>
          <input type="range" min="0" max="15" step="0.1" value={benchmarkRate} onChange={e => setBenchmarkRate(Number(e.target.value))} style={{ '--slider-pct': `${benchmarkRate / 15 * 100}%` }} />
        </div>
        <div className="calc-field">
          <div className="calc-label-row"><label className="metric-label">Inflation Assumption</label><span className="calc-value-display">{inflationRate}%</span></div>
          <input type="range" min="0" max="15" step="0.5" value={inflationRate} onChange={e => setInflationRate(Number(e.target.value))} style={{ '--slider-pct': `${inflationRate / 15 * 100}%` }} />
        </div>
      </div>

      {(projectionLoading || projectionError) && (
        <div role={projectionError ? 'alert' : 'status'} style={{ color: projectionError ? '#fda4af' : '#7dd3fc', fontSize: '0.72rem', marginBottom: 16 }}>
          {projectionError ? `Comparison unavailable: ${projectionError}` : 'Updating server comparison…'}
        </div>
      )}

      {/* Side-by-side comparison cards */}
      <div className="why-invest-compare-grid">
        <div className="why-invest-card why-invest-card--bad">
          <div className="why-invest-card-header">
            <div className="why-invest-card-icon why-invest-card-icon--bad">
              <TrendingDown size={18} />
            </div>
            <div>
              <div className="why-invest-card-title">Savings Benchmark</div>
              <div className="why-invest-card-rate">{benchmarkRate}% p.a.</div>
            </div>
          </div>
          <div className="why-invest-card-body">
            <div className="why-invest-metric">
              <span className="why-invest-metric-label">After {calcYears} years (nominal)</span>
              <span className="why-invest-metric-value">{formatINR(savingsMaturity)}</span>
            </div>
            <div className="why-invest-metric">
              <span className="why-invest-metric-label">Real value (today's ₹)</span>
              <span className="why-invest-metric-value why-invest-metric-value--loss">{formatINR(savingsReal)}</span>
            </div>
            <div className="why-invest-verdict why-invest-verdict--loss">
              <TrendingDown size={14} />
              <span>{purchasingPowerLost === null ? 'Comparison unavailable' : <>{purchasingPowerLost >= 0 ? 'Lower by' : 'Higher by'} <strong>{formatINR(Math.abs(purchasingPowerLost))}</strong> in purchasing power</>}</span>
            </div>
          </div>
        </div>

        <div className="why-invest-card why-invest-card--good">
          <div className="why-invest-card-header">
            <div className="why-invest-card-icon why-invest-card-icon--good">
              <TrendingUp size={18} />
            </div>
            <div>
              <div className="why-invest-card-title">{inv.name}</div>
              <div className="why-invest-card-rate">{calcReturn}% p.a.</div>
            </div>
          </div>
          <div className="why-invest-card-body">
            <div className="why-invest-metric">
              <span className="why-invest-metric-label">After {calcYears} years (nominal)</span>
              <span className="why-invest-metric-value">{formatINR(investMaturity)}</span>
            </div>
            <div className="why-invest-metric">
              <span className="why-invest-metric-label">Real value (today's ₹)</span>
              <span className="why-invest-metric-value why-invest-metric-value--gain">{formatINR(investReal)}</span>
            </div>
            <div className="why-invest-verdict why-invest-verdict--gain">
              <TrendingUp size={14} />
              <span>{opportunityCost === null ? 'Comparison unavailable' : <>{opportunityCost >= 0 ? 'Investment case leads' : 'Benchmark leads'} by <strong>{formatINR(Math.abs(opportunityCost))}</strong> in real value</>}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Opportunity Cost Highlight */}
      <div className="why-invest-opportunity">
        <div className="why-invest-opportunity-label">Real-Value Difference</div>
        <div className="why-invest-opportunity-value">{formatINR(opportunityCost)}</div>
        <div className="why-invest-opportunity-sub">
          Server-calculated difference between the two explicit return assumptions over {calcYears} years
        </div>
      </div>

      {/* Year-by-Year Erosion Table */}
      <div className="ddm-section-header" style={{ marginTop: 28 }}>Year-by-Year Comparison</div>
      <div className="why-invest-table-wrap">
        <table className="why-invest-table">
          <thead>
            <tr>
              <th>Year</th>
              <th>Principal</th>
              <th className="why-invest-th--bad">Savings (Real ₹)</th>
              <th className="why-invest-th--good">{inv.name.length > 12 ? inv.name.substring(0,12) + '..' : inv.name} (Real ₹)</th>
              <th>Difference</th>
            </tr>
          </thead>
          <tbody>
            {erosionData.map(d => (
              <tr key={d.year}>
                <td>{d.year}</td>
                <td>{formatINR(d.principalAtYear)}</td>
                <td className="why-invest-td--bad">{formatINR(d.savingsReal)}</td>
                <td className="why-invest-td--good">{formatINR(d.investReal)}</td>
                <td style={{ color: d.investReal > d.savingsReal ? '#22c55e' : '#f43f5e', fontWeight: 700 }}>
                  {d.investReal > d.savingsReal ? '+' : ''}{formatINR(d.investReal - d.savingsReal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bottom CTA */}
      <div className="why-invest-cta">
        <div className="why-invest-cta-text">
          <strong>Review the assumptions before deciding.</strong> This comparison is not a recommendation or guarantee.
        </div>
        <button
          className="why-invest-cta-btn"
          onClick={() => setActiveTab('Calculator')}
        >
          Open Calculator <ArrowRight size={14} />
        </button>
      </div>

      <p style={{ color: 'var(--ddm-text-muted)', fontSize: '0.65rem', marginTop: 16, textAlign: 'center', fontStyle: 'italic', lineHeight: 1.5 }}>
        * All "Real Value" figures use your explicit {inflationRate}% inflation assumption.
        The {benchmarkRate}% savings benchmark is adjustable. Returns are estimates, not guaranteed.
      </p>
    </div>
  );
};

export default WhyInvestTab;
