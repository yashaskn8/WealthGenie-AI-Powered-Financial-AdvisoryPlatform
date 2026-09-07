import React, { useState } from 'react';
import { ChevronDown, ChevronUp, ShieldAlert, ShieldCheck, Landmark } from 'lucide-react';
import { formatINR } from './recommendationEngine';
import { TRUST_BADGES } from './investmentDatabase';
import JargonTooltip from './components/JargonTooltip';

const TRUST_ICON_MAP = {
  sovereign: <Landmark size={13} />,
  rbi: <Landmark size={13} />,
  insured: <ShieldCheck size={13} />,
  regulated: <ShieldCheck size={13} />,
  sebi: <ShieldCheck size={13} />,
};

const TRUST_COLOR_MAP = {
  sovereign: { bg: 'rgba(56, 189, 248, 0.08)', border: 'rgba(56, 189, 248, 0.25)', text: '#7dd3fc' },
  rbi:       { bg: 'rgba(56, 189, 248, 0.08)', border: 'rgba(56, 189, 248, 0.25)', text: '#7dd3fc' },
  insured:   { bg: 'rgba(16, 185, 129, 0.08)', border: 'rgba(16, 185, 129, 0.25)', text: '#6ee7b7' },
  regulated: { bg: 'rgba(139, 92, 246, 0.08)', border: 'rgba(139, 92, 246, 0.25)', text: '#c4b5fd' },
  sebi:      { bg: 'rgba(139, 92, 246, 0.08)', border: 'rgba(139, 92, 246, 0.25)', text: '#c4b5fd' },
};

const RiskPill = ({ level }) => {
  const getRiskClass = (lvl) => {
    switch(lvl) {
      case "Very Low": return "risk-very-low";
      case "Low": return "risk-low";
      case "Medium": return "risk-medium";
      case "High": return "risk-high";
      case "Very High": return "risk-very-high";
      default: return "risk-medium";
    }
  };

  return (
    <div className={`risk-pill ${getRiskClass(level)}`}>
      <div className="risk-dot"></div>
      {level} Risk
    </div>
  );
};

const InvestmentCard = ({ investment, horizon, onLearnMore }) => {
  const [showSubtypes, setShowSubtypes] = useState(false);
  const { name, category, expected_return_min, expected_return_max, risk_level, types, monthly_allocation, projected_value, tax_benefit } = investment;
  const trustInfo = TRUST_BADGES[investment.id] || null;

  const getCategoryClass = (cat) => cat.toLowerCase();

  return (
    <div className="investment-card">
      <div className="card-header">
        <h3 className="card-title" style={{ color: '#fff' }}>{name}</h3>
        <span className={`badge ${getCategoryClass(category)}`}>{category}</span>
      </div>

      <div className="card-metrics">
        <div className="metric-block">
          <span className="metric-label"><JargonTooltip term="Expected Return">Expected Return</JargonTooltip></span>
          <span className="metric-val">{expected_return_min}% – {expected_return_max}%</span>
        </div>
        <div className="metric-block">
          <span className="metric-label"><JargonTooltip term="Risk Profile">Risk Profile</JargonTooltip></span>
          <RiskPill level={risk_level} />
        </div>
      </div>

      {tax_benefit && (
        <div className="tax-badge" style={{marginBottom: '8px'}}>
          <ShieldAlert size={14} style={{marginRight:'4px'}} /> Tax Benefit Applicable
        </div>
      )}

      {trustInfo && (
        <div className="trust-anchor-badge" style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          background: TRUST_COLOR_MAP[trustInfo.type]?.bg || 'rgba(139,92,246,0.08)',
          border: `1px solid ${TRUST_COLOR_MAP[trustInfo.type]?.border || 'rgba(139,92,246,0.25)'}`,
          color: TRUST_COLOR_MAP[trustInfo.type]?.text || '#c4b5fd',
          padding: '3px 10px', borderRadius: '20px',
          fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.4px',
          marginBottom: '16px', whiteSpace: 'nowrap',
        }}>
          {TRUST_ICON_MAP[trustInfo.type]} {trustInfo.label}
        </div>
      )}

      <div className="card-allocation">
        <div>
          <div className="alloc-subtitle">Monthly Allocation</div>
          <div className="alloc-amt">{formatINR(monthly_allocation)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="alloc-subtitle">Valuation in {horizon} yrs</div>
          <div style={{ fontSize: '1.2rem', fontWeight: '600', color: '#a855f7' }}>
            {formatINR(projected_value)}
          </div>
        </div>
      </div>

      {types && types.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <button className="subtypes-toggle" onClick={() => setShowSubtypes(!showSubtypes)}>
            View Supported Sub-types {showSubtypes ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          
          {showSubtypes && (
            <div className="subtypes-list">
              {types.map(t => (
                <span key={t} className="subtype-pill">{t}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <button className="btn-learn-more" onClick={() => onLearnMore && onLearnMore(investment)}>
        Learn More Details
      </button>
    </div>
  );
};

export default InvestmentCard;
