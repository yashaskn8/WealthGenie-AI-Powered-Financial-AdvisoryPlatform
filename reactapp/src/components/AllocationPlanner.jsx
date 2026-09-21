import React, { useState, useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { PieChart as PieChartIcon, TrendingUp, Landmark, Briefcase, Wallet, Sparkles, ShieldCheck, Info, Layers } from 'lucide-react';
import { RISK_COLORS } from '../investmentDatabase';
import JargonTooltip from './JargonTooltip';
import './AllocationPlanner.css';

// Rich Gradient Palettes for SVG Donut Slices
const SLICE_GRADIENTS = [
  { id: 'grad-sky', primary: '#38bdf8', stop1: '#0ea5e9', stop2: '#38bdf8', glow: 'rgba(56, 189, 248, 0.45)' },
  { id: 'grad-emerald', primary: '#34d399', stop1: '#059669', stop2: '#34d399', glow: 'rgba(52, 211, 153, 0.45)' },
  { id: 'grad-purple', primary: '#c084fc', stop1: '#7c3aed', stop2: '#c084fc', glow: 'rgba(192, 132, 252, 0.45)' },
  { id: 'grad-amber', primary: '#fbbf24', stop1: '#d97706', stop2: '#fbbf24', glow: 'rgba(251, 191, 36, 0.45)' },
  { id: 'grad-pink', primary: '#f472b6', stop1: '#db2777', stop2: '#f472b6', glow: 'rgba(244, 114, 182, 0.45)' },
  { id: 'grad-cyan', primary: '#22d3ee', stop1: '#0891b2', stop2: '#22d3ee', glow: 'rgba(34, 211, 238, 0.45)' },
];

const getCategoryIcon = (cat) => {
  if (!cat) return <Wallet size={20} />;
  if (cat.includes('Equity') || cat.includes('MF') || cat.includes('ETF')) return <TrendingUp size={20} />;
  if (cat.includes('Debt') || cat.includes('Govt') || cat.includes('Bond') || cat.includes('NPS')) return <Landmark size={20} />;
  if (cat.includes('Gold') || cat.includes('Commodity')) return <Briefcase size={20} />;
  return <Wallet size={20} />;
};

const RISK_PRESETS = [
  { id: 'Safe & Stable', label: 'Safe & Stable' },
  { id: 'Balanced Growth', label: 'Balanced Growth' },
  { id: 'Aggressive Growth', label: 'Aggressive Growth' },
];

const CATEGORY_EXPLANATIONS = {
  'Equity': 'Company Shares — High growth potential over time',
  'Debt': 'Fixed Income & FD — Steady, reliable interest income',
  'Government': 'Government Savings — 100% safe capital protection',
  'Equity-Debt': 'Hybrid Funds — Balanced safety and growth',
  'Commodity': 'Gold & Metals — Protects against inflation',
  'Alternative': 'Alternative Assets — Extra portfolio diversification',
  'Gold': 'Gold & Metals — Protects against inflation'
};

const AllocationPlanner = ({ profile, recommendations = [], recommendationMeta }) => {
  const savings = Number(profile?.monthly_savings);

  const riskView = (
    profile?.risk_tolerance === 'Aggressive' ? 'Aggressive Growth' :
    profile?.risk_tolerance === 'Conservative' ? 'Safe & Stable' : 'Balanced Growth'
  );

  // Only convert backend-authoritative weights into chart presentation fields.
  const allocation = useMemo(() => {
    return recommendations.filter(item => Number(item.monthly_allocation) > 0).map((item, idx) => {
      const grad = SLICE_GRADIENTS[idx % SLICE_GRADIENTS.length];
      const allocationWeight = Number(item.allocationWeight);
      const monthlyAmount = Number(item.monthly_allocation);
      const nominalRate = Number(item.nominalReturn);
      if (!Number.isFinite(allocationWeight) || !Number.isFinite(monthlyAmount) || !Number.isFinite(nominalRate)) {
        throw new TypeError(`Authoritative allocation fields are missing for ${item.id || item.name || 'an investment'}`);
      }
      return {
        ...item,
        allocationPct: allocationWeight * 100,
        monthlyAmount,
        nominalRate,
        cat: item.cat || item.category || item.assetClass || 'Other',
        riskLabel: item.riskLabel || item.riskLevel || 'Unavailable',
        gradId: grad.id,
        themeColor: grad.primary,
        glowColor: grad.glow,
      };
    });
  }, [recommendations]);

  const blendedReturn = Number(recommendationMeta?.portfolio_return_assumption);

  // KPI exposures
  const equityExposure = useMemo(() =>
    allocation.filter(a => a.cat === "Equity").reduce((s, a) => s + a.allocationPct, 0), [allocation]);
  const debtGovtExposure = useMemo(() =>
    allocation.filter(a => a.cat === "Government" || a.cat === "Debt" || a.cat === "Equity-Debt").reduce((s, a) => s + a.allocationPct, 0), [allocation]);
  const altExposure = useMemo(() =>
    allocation.filter(a => a.cat === "Commodity" || a.cat === "Alternative" || a.cat === "Gold").reduce((s, a) => s + a.allocationPct, 0), [allocation]);
  
  const rationaleText = recommendationMeta?.advisory_text
    || (['PENDING', 'GENERATING'].includes(recommendationMeta?.advisory_explanation?.status)
      ? 'Generating grounded explanation…'
      : 'The recommendation service did not return an advisory explanation.');
  const assetClassCount = new Set(allocation.map(item => item.cat)).size;

  const [hoveredSlice, setHoveredSlice] = useState(null);

  if (!Number.isFinite(savings) || savings <= 0 || !allocation || allocation.length === 0) {
    return (
      <motion.div className="ap-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="ap-empty">
          <div className="ap-empty-icon"><PieChartIcon size={48} /></div>
          <h3>No allocation available</h3>
          <p>Adjust your profile settings to unlock personalized investment options.</p>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="ap-page">
      {/* Top Banner Header */}
      <motion.div
        className="ap-header-section"
        initial={{ opacity: 0, y: -15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="ap-page-badge">
          <Sparkles size={13} className="text-sky" />
          <span>SMART MONEY MIX</span>
        </div>
        <h1 className="ap-page-title">
          Where to <span className="title-gradient">Invest Your Money</span>
        </h1>
        <p className="ap-page-subtitle">
          How to split your <strong>₹{savings.toLocaleString("en-IN")}/month</strong> savings to grow wealth safely.
        </p>

        {/* Risk Presets Segmented Toggle */}
        <div className="risk-presets-container">
          <div className="risk-presets-segmented">
            {RISK_PRESETS.filter(preset => preset.id === riskView).map(preset => {
              const isActive = riskView === preset.id;
              return (
                <button
                  key={preset.id}
                  className={`risk-preset-btn ${isActive ? 'active' : ''}`}
                  aria-label="Current backend risk strategy"
                >
                  <span>{preset.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Rationale Banner */}
        <div className="ap-rationale-box">
          <div className="rationale-header">
            <ShieldCheck size={16} className="text-sky" />
            <span>Why This Strategy Works</span>
          </div>
          <p>{rationaleText}</p>
        </div>
      </motion.div>

      {/* MAIN CONTENT GRID */}
      <div className="ap-main-grid">
        {/* LEFT: Stunning Donut Chart with SVG Gradients & Glow */}
        <motion.div 
          className="ap-donut-panel"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.15 }}
        >
          <div className="donut-chart-header">
            <div className="donut-chart-title">
              <Layers size={15} className="text-sky" />
              <span>Investment Breakdown</span>
            </div>
            <div className="donut-chart-count">{assetClassCount} Asset Classes</div>
          </div>

          <div className="donut-chart-wrapper" role="region" aria-label="Investment allocation breakdown donut chart">
            {/* Background Ambient Radial Ring Glow */}
            <div className="donut-glow-ring" />

            <ResponsiveContainer width="100%" height={380} initialDimension={{ width: 1, height: 1 }}>
              <PieChart>
                <defs>
                  {/* SVG Gradients for Slices */}
                  {SLICE_GRADIENTS.map(g => (
                    <linearGradient key={g.id} id={g.id} x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor={g.stop1} />
                      <stop offset="100%" stopColor={g.stop2} />
                    </linearGradient>
                  ))}
                  {/* Soft Drop Glow Filter */}
                  <filter id="pie-glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>

                <Pie 
                  data={allocation} 
                  dataKey="allocationPct" 
                  cx="50%" cy="50%"
                  innerRadius={112} 
                  outerRadius={162} 
                  paddingAngle={5}
                  cornerRadius={8} 
                  stroke="rgba(10, 16, 30, 0.95)" 
                  strokeWidth={3}
                  onMouseEnter={(_, index) => setHoveredSlice(allocation[index])}
                  onMouseLeave={() => setHoveredSlice(null)}
                >
                  {allocation.map((a, i) => {
                    const isHovered = hoveredSlice?.id === a.id;
                    return (
                      <Cell 
                        key={i} 
                        fill={`url(#${a.gradId})`} 
                        style={{ 
                          filter: isHovered 
                            ? `drop-shadow(0px 0px 16px ${a.themeColor})` 
                            : `drop-shadow(0px 4px 10px ${a.glowColor})`,
                          cursor: 'pointer',
                          transform: isHovered ? 'scale(1.04)' : 'scale(1)',
                          transformOrigin: 'center center',
                          transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                        }} 
                      />
                    );
                  })}
                </Pie>
              </PieChart>
            </ResponsiveContainer>

            {/* Donut Center Display */}
            <div className="ap-donut-center">
              <AnimatePresence mode="wait">
                {hoveredSlice ? (
                  <motion.div 
                    key="hovered"
                    initial={{ opacity: 0, scale: 0.88 }} 
                    animate={{ opacity: 1, scale: 1 }} 
                    exit={{ opacity: 0, scale: 0.88 }}
                    transition={{ duration: 0.2 }}
                    className="center-content-wrap"
                  >
                    <div className="center-hover-tag" style={{ background: `${hoveredSlice.themeColor}20`, color: hoveredSlice.themeColor, border: `1px solid ${hoveredSlice.themeColor}40` }}>
                      {hoveredSlice.cat || 'Asset'}
                    </div>
                    <div className="center-hover-name">{hoveredSlice.abbr || hoveredSlice.name}</div>
                    <div className="center-hover-pct" style={{ color: hoveredSlice.themeColor }}>
                      {hoveredSlice.allocationPct.toFixed(1)}%
                    </div>
                    <div className="center-hover-amt">
                      ₹{hoveredSlice.monthlyAmount?.toLocaleString("en-IN")}/mo
                    </div>
                  </motion.div>
                ) : (
                  <motion.div 
                    key="default"
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }} 
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="center-content-wrap"
                  >
                    <div className="donut-center-badge">TOTAL INVESTMENT</div>
                    <div className="donut-value-text">
                      ₹{savings.toLocaleString("en-IN")}
                    </div>
                    <div className="donut-sub-text">PER MONTH</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Donut Legend */}
          <div className="ap-legend-grid">
            {allocation.map((item, idx) => {
              const isHovered = hoveredSlice?.id === item.id;
              return (
                <div 
                  key={idx} 
                  className={`legend-chip ${isHovered ? 'active' : ''}`}
                  style={{
                    borderColor: isHovered ? item.themeColor : 'rgba(255, 255, 255, 0.07)',
                    boxShadow: isHovered ? `0 0 14px ${item.glowColor}` : 'none'
                  }}
                  onMouseEnter={() => setHoveredSlice(item)}
                  onMouseLeave={() => setHoveredSlice(null)}
                >
                  <span className="legend-dot" style={{ background: item.themeColor, boxShadow: `0 0 8px ${item.themeColor}` }} />
                  <span className="legend-name">{item.abbr || item.name}</span>
                  <span className="legend-pct" style={{ color: item.themeColor }}>{item.allocationPct.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* RIGHT: Detailed Investment Allocation Cards */}
        <div className="ap-cards-panel">
          <h2 className="sr-only" style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}>Detailed Asset Class Allocations</h2>
          {allocation.map((a, index) => {
            const isHovered = hoveredSlice?.id === a.id;
            return (
              <motion.div 
                key={a.id} 
                className={`ap-alloc-card ${isHovered ? 'active-card' : ''}`} 
                style={{ 
                  '--card-accent': a.themeColor,
                  borderColor: isHovered ? a.themeColor : 'rgba(255, 255, 255, 0.08)',
                  boxShadow: isHovered ? `0 16px 40px rgba(0,0,0,0.5), 0 0 24px ${a.glowColor}` : '0 10px 30px rgba(0, 0, 0, 0.3)'
                }}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + (index * 0.08) }}
                onMouseEnter={() => setHoveredSlice(a)}
                onMouseLeave={() => setHoveredSlice(null)}
              >
                <div className="ap-card-top">
                  <div className="ap-card-info-group">
                    <div className="ap-card-icon" style={{ 
                      background: `linear-gradient(135deg, ${a.themeColor}30, ${a.themeColor}10)`,
                      color: a.themeColor, 
                      borderColor: `${a.themeColor}50`,
                      boxShadow: `0 4px 16px ${a.glowColor}`
                    }}>
                      {getCategoryIcon(a.cat || a.name)}
                    </div>
                    <div>
                      <div className="ap-card-header-row">
                        <h3 className="ap-card-name">{a.name}</h3>
                      </div>
                      <div className="ap-card-desc">
                        {CATEGORY_EXPLANATIONS[a.cat] || CATEGORY_EXPLANATIONS[a.name] || a.cat || ''}
                      </div>
                    </div>
                  </div>

                  <div className="ap-card-pct-badge" style={{ color: a.themeColor, textShadow: `0 0 12px ${a.glowColor}` }}>
                    {a.allocationPct.toFixed(1)}%
                  </div>
                </div>

                {/* Card Metrics Row */}
                <div className="ap-card-metrics-grid">
                  <div className="metric-pill">
                    <span className="metric-label">Monthly SIP</span>
                    <span className="metric-val text-sky">₹{a.monthlyAmount?.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="metric-pill">
                    <span className="metric-label">Model return assumption</span>
                    <span className="metric-val text-green">{a.nominalRate}%/yr</span>
                  </div>
                  <div className="metric-pill">
                    <span className="metric-label">Safety & Risk</span>
                    <span className="risk-tag" style={{ color: RISK_COLORS[a.riskLabel] || '#f59e0b', borderColor: `${RISK_COLORS[a.riskLabel] || '#f59e0b'}30` }}>
                      {a.riskLabel} Risk
                    </span>
                  </div>
                </div>

                {a.concentrationBadge && (
                  <div className="ap-conc-badge">
                    <Info size={13} /> {a.concentrationBadge}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* SUMMARY STATS & BLENDED RETURN BAR */}
      <motion.div 
        className="ap-summary-container"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
      >
        <div className="ap-blended-bar">
          <div className="blended-left">
            <div className="blended-label">PORTFOLIO MODEL RETURN ASSUMPTION</div>
            <div className="blended-value">
              {Number.isFinite(blendedReturn) ? `${blendedReturn.toFixed(1)}%` : 'N/A'} <span className="per-year">per year</span>
            </div>
            <div className="blended-sub">
              Backend-weighted, pre-tax nominal model assumption — not a provider forecast. Tax is calculated separately with explicit tax inputs.
            </div>
          </div>
          <div className="blended-right">
            <div className="summary-pill">
              <span className="sp-label">Equity Shares</span>
              <span className="sp-val text-sky">{equityExposure.toFixed(1)}%</span>
            </div>
            <div className="summary-pill">
              <span className="sp-label">FD & Safer Funds</span>
              <span className="sp-val text-purple">{debtGovtExposure.toFixed(1)}%</span>
            </div>
            {altExposure > 0 && (
              <div className="summary-pill">
                <span className="sp-label">Gold & Others</span>
                <span className="sp-val text-orange">{altExposure.toFixed(1)}%</span>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default AllocationPlanner;
