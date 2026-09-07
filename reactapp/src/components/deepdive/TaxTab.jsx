/**
 * DeepDiveModal — Tax Tab
 * Extracted from DeepDiveModal.jsx for maintainability.
 */
import React from 'react';
import { X, Shield, Info, Zap, ShieldCheck, Briefcase, History as HistoryIcon } from 'lucide-react';
import JargonTooltip from '../JargonTooltip';
import api from '../../services/api';

/** Present the catalog tax policy attached to the backend-selected instrument. */
function getTaxInfo(inv) {
  const policy = inv?.taxation;
  return {
    section: policy?.section || inv?.tax_section || 'N/A',
    taxBenefit: Boolean(inv?.tax_benefit || policy?.section),
    taxFreeInterest: Boolean(policy?.taxFreeInterest ?? inv?.tax_free_interest),
    maxDeduction: policy?.section ? 'Depends on the selected tax regime and total eligible deductions' : 'N/A',
    ltcg: policy?.ltcg || 'No verified long-term treatment is available in the instrument catalog.',
    stcg: policy?.stcg || 'No verified short-term treatment is available in the instrument catalog.',
    specialNote: policy?.details || inv?.taxNotes || 'Use the explicit tax what-if below for a personalized estimate.',
  };
}

const TaxTab = ({ inv, calcAmount, calcYears, userProfile }) => {
  const taxInfo = getTaxInfo(inv);

  return (
    <div className="tab-fade-in">
      <div className="ddm-section-header">Tax Compliance Framework</div>
      <div className="ddm-pc-grid" style={{ marginBottom: 32 }}>
        <div className="tax-card-premium" style={{ borderTop: `1px solid ${taxInfo.taxBenefit ? 'rgba(34, 197, 94, 0.6)' : 'rgba(244, 63, 94, 0.6)'}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <span className="metric-label" style={{ color: '#94a3b8', fontSize: '0.85rem', letterSpacing: '1.5px', fontWeight: 700 }}><JargonTooltip term="Section 80C">SECTION 80C ELIGIBILITY</JargonTooltip></span>
            <Shield size={20} color={taxInfo.taxBenefit ? '#22c55e' : '#f43f5e'} opacity={0.6} />
          </div>
          <div style={{ margin: '16px 0', flexGrow: 1 }}>
            <span className={`tax-status-chip ${taxInfo.taxBenefit ? 'tax-status-chip--eligible' : 'tax-status-chip--not-eligible'}`} style={{ fontSize: '1.1rem', padding: '12px 20px', borderRadius: '12px', boxShadow: `0 0 24px ${taxInfo.taxBenefit ? 'rgba(34, 197, 94, 0.2)' : 'rgba(244, 63, 94, 0.2)'}` }}>
              {taxInfo.taxBenefit ? <><ShieldCheck size={20} /> QUALIFIED</> : <><X size={20} /> NOT ELIGIBLE</>}
            </span>
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 20, marginTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#64748b', fontSize: '0.9rem', fontWeight: 600 }}>Deduction limit</span>
            <strong style={{ color: '#f8fafc', fontSize: '1.1rem', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.5px' }}>{taxInfo.maxDeduction}</strong>
          </div>
        </div>
        <div className="tax-card-premium" style={{ borderTop: '1px solid rgba(56, 189, 248, 0.6)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <span className="metric-label" style={{ color: '#94a3b8', fontSize: '0.85rem', letterSpacing: '1.5px', fontWeight: 700 }}>TAXABILITY OF INTEREST</span>
            <Briefcase size={20} color="#38bdf8" opacity={0.6} />
          </div>
          <div style={{ fontSize: '2.2rem', fontWeight: 800, margin: '12px 0', color: '#f8fafc', letterSpacing: '-0.03em', flexGrow: 1, textShadow: '0 4px 24px rgba(0,0,0,0.5)' }}>
            {taxInfo.taxFreeInterest ? <span style={{ color: '#38bdf8', textShadow: '0 0 24px rgba(56,189,248,0.5)' }}><JargonTooltip term="EEE">Tax-Free (EEE)</JargonTooltip></span> : <span style={{ color: '#f8fafc' }}>Fully Taxable</span>}
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 20, marginTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#64748b', fontSize: '0.9rem', fontWeight: 600 }}>Applicable Section</span>
            <strong style={{ color: '#cbd5e1', fontSize: '1.1rem', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.5px' }}>{taxInfo.section}</strong>
          </div>
        </div>
      </div>

      <div className="ddm-section-header">Capital Gains (Market Linked)</div>
      <div className="ddm-pc-grid">
        <div className="tax-cg-card" style={{ borderTop: '1px solid rgba(245, 158, 11, 0.6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '24px' }}>
            <div style={{ padding: '16px', background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(245, 158, 11, 0.05))', borderRadius: '16px', border: '1px solid rgba(245, 158, 11, 0.3)', boxShadow: '0 12px 24px -8px rgba(245, 158, 11, 0.2)' }}>
               <HistoryIcon size={28} color="#fcd34d" />
            </div>
            <div>
              <div style={{ color: '#fbbf24', fontSize: '0.8rem', fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '6px' }}>Holding Period</div>
              <div style={{ color: '#f8fafc', fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em', textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}>
                <JargonTooltip term="LTCG">Long-Term (LTCG)</JargonTooltip>
              </div>
            </div>
          </div>
          <div style={{ padding: '24px', background: 'rgba(15, 23, 42, 0.6)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)', boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.5)' }}>
            <p style={{ color: '#e2e8f0', fontSize: '1.1rem', lineHeight: 1.8, margin: 0, fontWeight: 500 }}>{taxInfo.ltcg}</p>
          </div>
        </div>
        <div className="tax-cg-card" style={{ borderTop: '1px solid rgba(244, 63, 94, 0.6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '24px' }}>
            <div style={{ padding: '16px', background: 'linear-gradient(135deg, rgba(244, 63, 94, 0.2), rgba(244, 63, 94, 0.05))', borderRadius: '16px', border: '1px solid rgba(244, 63, 94, 0.3)', boxShadow: '0 12px 24px -8px rgba(244, 63, 94, 0.2)' }}>
               <Zap size={28} color="#fda4af" />
            </div>
            <div>
              <div style={{ color: '#fb7185', fontSize: '0.8rem', fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '6px' }}>Holding Period</div>
              <div style={{ color: '#f8fafc', fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em', textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}>
                <JargonTooltip term="STCG">Short-Term (STCG)</JargonTooltip>
              </div>
            </div>
          </div>
          <div style={{ padding: '24px', background: 'rgba(15, 23, 42, 0.6)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)', boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.5)' }}>
            <p style={{ color: '#e2e8f0', fontSize: '1.1rem', lineHeight: 1.8, margin: 0, fontWeight: 500 }}>{taxInfo.stcg}</p>
          </div>
        </div>
      </div>

      {taxInfo.specialNote && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '16px 20px', borderRadius: 14, marginTop: 20,
          background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.05), rgba(139, 92, 246, 0.04))',
          border: '1px solid rgba(56, 189, 248, 0.12)',
        }}>
          <Info size={16} style={{ flexShrink: 0, marginTop: 2, color: '#38bdf8' }} />
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#38bdf8', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Tax Intelligence</div>
            <p style={{ color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.6, margin: 0 }}>{taxInfo.specialNote}</p>
          </div>
        </div>
      )}

      {/* Interactive Post-Tax Net Yield Simulator */}
      <InteractiveTaxSimulator inv={inv} calcAmount={calcAmount} calcYears={calcYears} userProfile={userProfile} />
    </div>
  );
};

const InteractiveTaxSimulator = ({ inv, calcAmount, calcYears, userProfile }) => {
  const [annualIncome, setAnnualIncome] = React.useState('');
  const [regime, setRegime] = React.useState('');
  const [incomeSource, setIncomeSource] = React.useState('');
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const nominalReturn = Number(inv?.nominalReturn);
  const userAge = Number(userProfile?.age);
  const isReady = Number(annualIncome) >= 0 && annualIncome !== '' && regime && incomeSource
    && Number.isFinite(nominalReturn) && Number.isFinite(userAge) && Number.isFinite(calcYears) && Number.isFinite(calcAmount);

  React.useEffect(() => {
    if (!isReady) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      api.computePostTaxReturn(
        inv.type,
        nominalReturn / 100,
        Number(annualIncome),
        calcYears,
        regime,
        calcAmount,
        userAge,
        incomeSource,
        { signal: controller.signal },
      ).then(response => {
        if (!cancelled) setResult(response);
      }).catch(requestError => {
        if (!cancelled && requestError?.name !== 'AbortError') {
          setResult(null);
          setError(requestError?.message || 'Tax what-if calculation failed.');
        }
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [annualIncome, calcAmount, calcYears, incomeSource, inv.type, isReady, nominalReturn, regime, userAge]);

  return (
    <div style={{
      marginTop: '2rem',
      padding: '20px',
      background: 'rgba(15, 23, 42, 0.8)',
      border: '1px solid rgba(139, 92, 246, 0.3)',
      borderRadius: '16px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Zap size={20} color="#a855f7" />
          <h4 style={{ margin: 0, color: '#f8fafc', fontSize: '1rem', fontWeight: 800 }}>
            Interactive Post-Tax Net Yield Simulator (₹1,00,000 Invested)
          </h4>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600 }}>Tax Regime:</span>
          {['new', 'old'].map(option => (
            <button
              key={option}
              onClick={() => setRegime(option)}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                border: regime === option ? '1px solid #a855f7' : '1px solid rgba(255,255,255,0.1)',
                background: regime === option ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255,255,255,0.04)',
                color: regime === option ? '#e9d5ff' : '#94a3b8',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              {option === 'new' ? 'New' : 'Old'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        <label style={{ color: '#94a3b8', fontSize: '0.75rem', fontWeight: 600 }}>
          Annual gross income (₹)
          <input type="number" min="0" value={annualIncome} onChange={event => setAnnualIncome(event.target.value)} placeholder="Enter gross income" style={{ width: '100%', marginTop: 6, padding: '9px 10px', borderRadius: 8, color: '#f8fafc', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }} />
        </label>
        <label style={{ color: '#94a3b8', fontSize: '0.75rem', fontWeight: 600 }}>
          Income source
          <select value={incomeSource} onChange={event => setIncomeSource(event.target.value)} style={{ width: '100%', marginTop: 6, padding: '9px 10px', borderRadius: 8, color: '#f8fafc', background: '#111827', border: '1px solid rgba(255,255,255,0.1)' }}>
            <option value="">Select source</option>
            <option value="salary">Salary</option>
            <option value="pension">Pension</option>
            <option value="family_pension">Family pension</option>
            <option value="business">Business</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      {!isReady && <p style={{ color: '#94a3b8', fontSize: '0.75rem', margin: '10px 0 0' }}>Enter the separate tax facts above to run this server calculation. WealthGenie does not infer them from your Financial Profile.</p>}
      {error && <p role="alert" style={{ color: '#f87171', fontSize: '0.75rem', margin: '10px 0 0' }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 16 }}>
        <div style={{ padding: '14px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600 }}>Gross Annual Growth</span>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', marginTop: 4 }}>
            {result ? `₹${Number(result.what_if_nominal_gain).toLocaleString('en-IN')} (${(nominalReturn).toFixed(2)}%)` : loading ? 'Calculating…' : '—'}
          </div>
        </div>
        <div style={{ padding: '14px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', border: '1px solid rgba(239, 68, 68, 0.15)' }}>
          <span style={{ fontSize: '0.75rem', color: '#f87171', fontWeight: 600 }}>Estimated Tax Liability</span>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f87171', marginTop: 4 }}>
            {result ? `- ₹${Number(result.what_if_estimated_tax).toLocaleString('en-IN')} (${(Number(result.taxRate) * 100).toFixed(2)}%)` : loading ? 'Calculating…' : '—'}
          </div>
        </div>
        <div style={{ padding: '14px', background: 'rgba(34, 197, 94, 0.08)', borderRadius: '10px', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
          <span style={{ fontSize: '0.75rem', color: '#4ade80', fontWeight: 700 }}>Net In-Hand Profit</span>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#4ade80', marginTop: 4 }}>
            {result ? `₹${Number(result.what_if_net_gain).toLocaleString('en-IN')} (${Number(result.effectiveYield).toFixed(2)}% Net)` : loading ? 'Calculating…' : '—'}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaxTab;
