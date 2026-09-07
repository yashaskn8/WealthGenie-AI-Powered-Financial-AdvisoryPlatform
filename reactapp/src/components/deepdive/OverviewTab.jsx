/**
 * DeepDiveModal — Overview Tab
 * ────────────────────────────
 * Renders: Asset Intelligence, Strategic Advantages/Risk Considerations (from master DB),
 * Category-Specific Asset Parameters, Safety & Regulation, Alternatives ("People also consider"),
 * Performance Indexing chart, and Data Provenance footer.
 */
import React from 'react';
import { Shield, Zap, Target, Activity, TrendingUp, AlertCircle, Lock, BarChart3, ShieldCheck, Landmark, ArrowRight, Clock, Info, Layers } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { TRUST_BADGES, investmentDatabase } from '../../investmentDatabase';
import JargonTooltip from '../JargonTooltip';

const OverviewTab = ({ inv, comparisonData, onSelectInvestment }) => {
  // ─── Category-Specific Parameters ───
  const categoryParams = (() => {
    const cat = (inv.category || '').toLowerCase();
    const id = (inv.id || '');
    const horizon = inv.idealHorizon || inv.dynamicData?.idealHorizon || { min: 3, max: 10 };
    const expRatio = inv.expenseRatio ?? inv.dynamicData?.expenseRatio;
    const liqType = inv.dynamicData?.liquidity?.type || 'T+2';

    if (cat.includes('etf')) {
      return [
        { label: 'Expense Ratio', value: expRatio != null ? `${(expRatio * 100).toFixed(2)}%` : '—' },
        { label: 'Risk Category', value: inv.riskLabel || inv.risk_level || 'Medium' },
        { label: 'Ideal Horizon', value: `${horizon.min}–${horizon.max} years` },
        { label: 'Settlement', value: liqType },
        { label: 'Exchange', value: 'NSE & BSE' },
        { label: 'Demat Required', value: 'Yes' },
      ];
    }
    if (cat.includes('mutual') || cat.includes('hybrid')) {
      return [
        { label: 'Expense Ratio', value: expRatio != null ? `${(expRatio * 100).toFixed(2)}%` : '—' },
        { label: 'Risk Category', value: inv.riskLabel || inv.risk_level || 'Medium' },
        { label: 'Ideal Horizon', value: `${horizon.min}–${horizon.max} years` },
        { label: 'Settlement', value: liqType },
        { label: 'SIP Available', value: 'Yes' },
        { label: 'Demat Required', value: 'No (Direct MF allowed)' },
      ];
    }
    if (cat.includes('bond') || cat.includes('debenture')) {
      return [
        { label: 'Coupon / Interest', value: inv.rate ? `${inv.rate}% p.a.` : `${inv.expectedReturn}% p.a.` },
        { label: 'Credit Quality', value: inv.trustBadge?.body || inv.staticData?.trustBadge?.body || 'Rated' },
        { label: 'Ideal Horizon', value: `${horizon.min}–${horizon.max} years` },
        { label: 'Settlement', value: liqType },
        { label: 'Demat Required', value: 'Yes' },
      ];
    }
    if (cat.includes('government') || inv.assetClass === 'Sovereign') {
      return [
        { label: 'Interest Rate', value: `${inv.expectedReturn || inv.rate || '—'}% p.a.` },
        { label: 'Lock-in Period', value: inv.lock_in_years > 0 ? `${inv.lock_in_years} years` : 'None' },
        { label: 'Sovereign Guarantee', value: 'Yes — Govt. of India' },
        { label: 'Tax Section', value: inv.taxation?.section || inv.staticData?.taxation?.section || '—' },
        { label: 'Max Investment', value: inv.maxAnnualInvestment ? `₹${(inv.maxAnnualInvestment / 100000).toFixed(1)}L / year` : 'No cap' },
      ];
    }
    if (cat.includes('reit') || cat.includes('invit')) {
      return [
        { label: 'Dividend Yield', value: `${inv.expectedReturn || inv.rate || '—'}% p.a.` },
        { label: 'Risk Category', value: inv.riskLabel || inv.risk_level || 'Medium' },
        { label: 'Distribution', value: '90%+ net cash flow (SEBI mandated)' },
        { label: 'Settlement', value: liqType },
        { label: 'Exchange', value: 'NSE & BSE' },
        { label: 'Demat Required', value: 'Yes' },
      ];
    }
    if (cat.includes('gold') || id.includes('gold') || id === 'sgb') {
      return [
        { label: 'Asset Type', value: 'Gold / Precious Metal' },
        { label: 'Interest', value: id === 'sgb' ? '2.5% p.a. on issue price' : 'N/A (capital appreciation)' },
        { label: 'Ideal Horizon', value: `${horizon.min}–${horizon.max} years` },
        { label: 'Settlement', value: liqType },
        { label: 'Inflation Hedge', value: 'Yes — historically correlated' },
      ];
    }
    if (cat.includes('deposit') || id.endsWith('_fd')) {
      return [
        { label: 'Interest Rate', value: `${inv.expectedReturn || inv.rate || '—'}% p.a.` },
        { label: 'DICGC Insurance', value: 'Up to ₹5 Lakhs' },
        { label: 'Ideal Tenure', value: `${horizon.min}–${horizon.max} years` },
        { label: 'Premature Withdrawal', value: 'Allowed (with penalty)' },
        { label: 'Compounding', value: 'Quarterly' },
      ];
    }
    // Fallback for Direct Equity, Insurance, Retirement, Other
    return [
      { label: 'Expected Return', value: `${inv.expectedReturn || inv.rate || '—'}% p.a.` },
      { label: 'Risk Category', value: inv.riskLabel || inv.risk_level || 'Medium' },
      { label: 'Ideal Horizon', value: `${horizon.min}–${horizon.max} years` },
      { label: 'Settlement', value: liqType },
    ];
  })();

  // ─── Pros / Cons from master DB ───
  const pros = inv.pros || inv.staticData?.pros || [];
  const cons = inv.cons || inv.staticData?.cons || [];

  // ─── Alternatives ───
  const alternativeIds = inv.alternatives || inv.staticData?.alternatives || [];
  const alternativeInstruments = alternativeIds
    .map(altId => investmentDatabase.find(x => x.id === altId))
    .filter(Boolean)
    .slice(0, 4);

  // ─── Data Provenance ───
  const metadata = inv.metadata || inv.staticData?.metadata || {};
  const returnSource = inv.dynamicData?.expectedReturn?.source || '';
  const returnLastUpdated = inv.dynamicData?.expectedReturn?.lastUpdated || '';

  return (
    <div className="tab-fade-in">
      <div className="ddm-section-header">Asset Intelligence</div>
      <div className="ddm-desc-card">
        <p>{inv.description}</p>
      </div>

      {/* Category-Specific Asset Parameters */}
      <div className="ddm-section-header">Asset Parameters</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginBottom: '24px' }}>
        {categoryParams.map((param, idx) => (
          <div key={idx} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '14px 16px' }}>
            <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>{param.label}</div>
            <div style={{ fontSize: '0.92rem', color: '#e2e8f0', fontWeight: 600 }}>{param.value}</div>
          </div>
        ))}
      </div>

      {/* Strategic Advantages (Pros from Master DB) */}
      <div className="ddm-pc-grid">
        <div className="pc-card pc-card--pros">
          <div className="pc-title" style={{ color: '#22c55e' }}><Shield size={20} /> Strategic Advantages</div>
          <ul className="pc-list">
            {pros.map((pro, idx) => (
              <li key={idx} className="pc-item"><Zap size={14} className="pc-icon" /> {pro}</li>
            ))}
          </ul>
        </div>
        <div className="pc-card pc-card--cons">
          <div className="pc-title" style={{ color: '#f59e0b' }}><AlertCircle size={20} /> Risk Considerations</div>
          <ul className="pc-list">
            {cons.map((con, idx) => (
              <li key={idx} className="pc-item"><BarChart3 size={14} className="pc-icon" /> {con}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Safety & Regulation Section */}
      {(() => {
        const trustInfo = inv.trustBadge || inv.staticData?.trustBadge || TRUST_BADGES[inv.id] || null;
        if (!trustInfo) return null;
        const isSovereign = trustInfo.type === 'sovereign' || trustInfo.type === 'rbi';
        const isInsured = trustInfo.type === 'insured';
        const accentColor = isSovereign ? '#38bdf8' : isInsured ? '#10b981' : '#8b5cf6';
        const accentBg = isSovereign ? 'rgba(56, 189, 248, 0.06)' : isInsured ? 'rgba(16, 185, 129, 0.06)' : 'rgba(139, 92, 246, 0.06)';
        return (
          <>
            <div className="ddm-section-header">Safety & Regulation</div>
            <div className="ddm-trust-card" style={{ borderColor: accentColor.replace(')', ', 0.2)').replace('rgb', 'rgba') }}>
              <div className="ddm-trust-header">
                <div className="ddm-trust-icon" style={{ background: accentBg, color: accentColor }}>
                  {isSovereign ? <Landmark size={22} /> : <ShieldCheck size={22} />}
                </div>
                <div className="ddm-trust-titles">
                  <span className="ddm-trust-label" style={{ color: accentColor }}>{trustInfo.label}</span>
                  <span className="ddm-trust-body">{trustInfo.body}</span>
                </div>
              </div>
              <p className="ddm-trust-desc">{trustInfo.desc}</p>
              <div className="ddm-trust-footer">
                <span className="ddm-trust-chip"><Lock size={11} /> 256-bit Encrypted</span>
                <span className="ddm-trust-chip"><ShieldCheck size={11} /> Audited & Compliant</span>
                {isSovereign && <span className="ddm-trust-chip"><Landmark size={11} /> Zero Default Risk</span>}
                {isInsured && <span className="ddm-trust-chip"><Shield size={11} /> DICGC Protected</span>}
              </div>
            </div>
          </>
        );
      })()}

      {/* People Also Consider (Alternatives) */}
      {alternativeInstruments.length > 0 && (
        <>
          <div className="ddm-section-header">People Also Consider</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px', marginBottom: '24px' }}>
            {alternativeInstruments.map(alt => (
              <button
                key={alt.id}
                onClick={() => onSelectInvestment && onSelectInvestment(alt)}
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '14px',
                  padding: '16px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.25s ease',
                  outline: 'none',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.08)'; e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.3)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f1f5f9' }}>{alt.abbr || alt.name}</span>
                  <ArrowRight size={14} style={{ color: '#38bdf8', opacity: 0.7 }} />
                </div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '6px' }}>{alt.category}</div>
                <div style={{ display: 'flex', gap: '12px', fontSize: '0.75rem' }}>
                  <span style={{ color: '#22c55e' }}>{alt.expectedReturn?.toFixed?.(1) || alt.rate || '—'}% p.a.</span>
                  <span style={{ color: alt.riskLabel?.includes?.('High') ? '#f43f5e' : '#94a3b8' }}>{alt.riskLabel || 'Medium'}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="ddm-section-header">Performance Indexing</div>
      <div className="ddm-chart-container">
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={comparisonData} margin={{ top: 20, right: 20, left: -10, bottom: 30 }}>
            <defs>
              <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity={1}/>
                <stop offset="50%" stopColor="#8b5cf6" stopOpacity={0.8}/>
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.1}/>
              </linearGradient>
              <linearGradient id="barGradMuted" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.4}/>
                <stop offset="100%" stopColor="#475569" stopOpacity={0.05}/>
              </linearGradient>
              <linearGradient id="cursorGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.1}/>
                <stop offset="100%" stopColor="transparent" stopOpacity={0}/>
              </linearGradient>
              <filter id="barGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 11, fontWeight: 600 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} dy={16} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }} axisLine={false} tickLine={false} dx={-10} />
            <Tooltip cursor={{ fill: 'url(#cursorGrad)' }} contentStyle={{ background: 'rgba(15, 23, 42, 0.9)', backdropFilter: 'blur(24px)', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: 16, boxShadow: '0 16px 32px rgba(0,0,0,0.8), 0 0 20px rgba(56, 189, 248, 0.15)', color: '#f8fafc', fontWeight: 600, padding: '16px' }} itemStyle={{ color: '#38bdf8', fontWeight: 800, fontSize: '1.1rem' }} labelStyle={{ color: '#cbd5e1', marginBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }} />
            <Bar dataKey="returnMax" name="Upside Potential %" radius={[6, 6, 0, 0]} barSize={32}>
              {comparisonData.map((entry, idx) => (
                <Cell key={idx} fill={entry.isThis ? 'url(#barGrad)' : 'url(#barGradMuted)'} filter={entry.isThis ? 'url(#barGlow)' : 'none'} style={{ transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)' }} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Data Provenance & Versioning Footer */}
      {metadata.version && (
        <div style={{ marginTop: '24px', padding: '16px 20px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <Info size={14} style={{ color: '#64748b' }} />
            <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Data Provenance</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px', fontSize: '0.78rem' }}>
            <div><span style={{ color: '#64748b' }}>Catalog Version:</span> <span style={{ color: '#94a3b8', fontWeight: 600 }}>v{metadata.version}</span></div>
            <div><span style={{ color: '#64748b' }}>Last Updated:</span> <span style={{ color: '#94a3b8', fontWeight: 600 }}>{metadata.lastUpdated}</span></div>
            <div><span style={{ color: '#64748b' }}>Reviewed By:</span> <span style={{ color: '#94a3b8', fontWeight: 600 }}>{metadata.reviewedBy}</span></div>
            <div><span style={{ color: '#64748b' }}>Confidence:</span> <span style={{ color: metadata.sourceConfidence === 'High' ? '#22c55e' : '#f59e0b', fontWeight: 600 }}>{metadata.sourceConfidence}</span></div>
            {returnSource && <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#64748b' }}>Return Source:</span> <span style={{ color: '#94a3b8', fontWeight: 600 }}>{returnSource} ({returnLastUpdated})</span></div>}
          </div>
        </div>
      )}
    </div>
  );
};

export default OverviewTab;
