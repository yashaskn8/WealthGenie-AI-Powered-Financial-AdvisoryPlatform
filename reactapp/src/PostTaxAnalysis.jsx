import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, TrendingUp, TrendingDown, ShieldCheck, Layers, Award, ChevronDown, Zap, ArrowRight, Sparkles, Target } from 'lucide-react';
import { formatINR } from './utils/recommendationPresentation';
import { computePostTaxReturnBatch } from './services/api';
import './PostTaxAnalysis.css';

const PostTaxAnalysis = ({ profile, recommendations }) => {
  const [showBreakdown, setShowBreakdown] = useState(true);
  const [grossAnnualIncome, setGrossAnnualIncome] = useState('');
  const [incomeSource, setIncomeSource] = useState('');
  const [regime, setRegime] = useState('');
  const [inflationRate, setInflationRate] = useState('');
  const [backendPostTaxData, setBackendPostTaxData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const calculate = async event => {
    event.preventDefault();
    setError('');
    setBackendPostTaxData(null);
    const annualIncome = Number(grossAnnualIncome);
    const explicitInflationRate = Number(inflationRate);
    const horizon = Number(profile?.investment_horizon_years);
    const age = Number(profile?.age);
    if (!Number.isFinite(annualIncome) || annualIncome < 0 || !incomeSource || !regime) {
      setError('Enter gross annual taxable income, income source, and tax regime explicitly.');
      return;
    }
    if (!Number.isFinite(explicitInflationRate) || inflationRate === '' || explicitInflationRate < 0 || explicitInflationRate > 100) {
      setError('Enter an explicit inflation rate from 0% to 100%.');
      return;
    }
    if (!Number.isInteger(age) || !Number.isFinite(horizon) || horizon <= 0) {
      setError('The Financial Profile must provide age and investment horizon before this analysis can run.');
      return;
    }
    const instruments = recommendations.map(instrument => ({
      instrumentType: instrument.type,
      nominalRate: Number(instrument.nominalReturn) / 100,
      holdingYears: horizon,
      monthlySIP: Number(instrument.monthly_allocation),
    }));
    if (instruments.some(item => !item.instrumentType || !Number.isFinite(item.nominalRate)
        || !Number.isFinite(item.monthlySIP) || item.monthlySIP < 0)) {
      setError('The backend recommendation is missing required return or allocation facts.');
      return;
    }
    try {
      setLoading(true);
      const data = await computePostTaxReturnBatch(
        instruments,
        annualIncome,
        regime,
        age,
        incomeSource,
        explicitInflationRate / 100,
      );
      setBackendPostTaxData(data);
    } catch (requestError) {
      setError(requestError?.message || 'Authoritative post-tax analysis is unavailable.');
    } finally {
      setLoading(false);
    }
  };

  const postTaxData = useMemo(() => {
    if (!backendPostTaxData?.results) return [];
    return recommendations.map((inv, idx) => {
      const result = backendPostTaxData.results[idx];
      return {
        ...inv,
        taxDetails: {
          taxType: result.taxType,
          taxRatePercent: result.effectiveTaxPercent,
          postTaxGain: result.postTaxGain,
          taxDragWealth: result.taxDragWealth,
          taxDragCAGR: result.taxDragCAGR * 100,
        },
        totalInvested: result.totalInvested,
        wealthGained: result.postTaxGain,
        nominalReturn: result.nominalReturnPercent,
        postTaxReturn: result.postTaxReturnPercent,
        realReturn: result.realReturnPercent,
      };
    });
  }, [recommendations, backendPostTaxData]);

  const totalTaxDragRupees = backendPostTaxData?.summary?.totalTaxDrag ?? 0;
  const keptAmount = backendPostTaxData?.summary?.keptPerThousand ?? 0;
  const erodedAmount = backendPostTaxData?.summary?.erodedPerThousand ?? 0;
  const efficiencyPercent = backendPostTaxData?.summary?.retentionEfficiencyPercent ?? 0;
  const marginalRate = backendPostTaxData?.summary?.maxTaxRate ?? 0;

  const strokeDashoffset = useMemo(() => {
    return 251.2 - (251.2 * efficiencyPercent) / 100;
  }, [efficiencyPercent]);

  const actionableInsights = (backendPostTaxData?.insights || []).map(insight => ({
    ...insight,
    icon: insight.icon === 'trend' ? <TrendingDown size={18} /> : <ShieldCheck size={18} />,
  }));

  if (!profile || !recommendations || !Array.isArray(recommendations) || recommendations.length === 0) {
    return (
      <div className="pta-empty-state">
        <div className="pta-empty-icon"><Target size={48} /></div>
        <h3>No Recommendations Yet</h3>
        <p>Set up your financial profile to see your actual returns after tax and inflation.</p>
      </div>
    );
  }

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.06, delayChildren: 0.04 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 16 } }
  };

  const getTaxBadgeClass = (taxType) => {
    const t = taxType.toLowerCase();
    if (t.includes('eee') || t.includes('free')) return 'pta-badge--green';
    if (t.includes('slab')) return 'pta-badge--red';
    if (t.includes('equity') || t.includes('elss') || t.includes('gains') || t.includes('capital')) return 'pta-badge--purple';
    if (t.includes('retirement') || t.includes('nps')) return 'pta-badge--blue';
    if (t.includes('gold') || t.includes('sgb')) return 'pta-badge--amber';
    return 'pta-badge--default';
  };

  const barColors = ['#38bdf8', '#c084fc', '#34d399', '#fbbf24', '#fb7185', '#f472b6'];

  return (
    <motion.div
      className="pta-root"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
    >
      {/* Ambient background */}
      <div className="pta-bg-glow pta-bg-glow--1" />
      <div className="pta-bg-glow pta-bg-glow--2" />
      <div className="pta-bg-glow pta-bg-glow--3" />

      {/* ═══════ HEADER ═══════ */}
      <motion.header className="pta-header" variants={itemVariants}>
        <div className="pta-header-badge">
          <Sparkles size={13} />
          Tax & Inflation Engine
        </div>
        <h1 className="pta-header-title">
          Actual Returns Summary
        </h1>
        <p className="pta-header-subtitle">
          Your true growth after Indian tax laws and your explicit inflation assumption
        </p>
      </motion.header>

      <motion.form
        onSubmit={calculate}
        className="pta-card"
        variants={itemVariants}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 14,
          marginBottom: 20,
          alignItems: 'end',
        }}
      >
        <label style={{ display: 'grid', gap: 7, color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 700 }}>
          Gross annual taxable income (₹)
          <input
            aria-label="Gross annual taxable income"
            type="number"
            min="0"
            value={grossAnnualIncome}
            onChange={event => setGrossAnnualIncome(event.target.value)}
            placeholder="Enter gross income"
            className="tax-input"
          />
        </label>
        <label style={{ display: 'grid', gap: 7, color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 700 }}>
          Income source
          <select aria-label="Income source" value={incomeSource} onChange={event => setIncomeSource(event.target.value)} className="tax-input">
            <option value="">Choose explicitly</option>
            <option value="salary">Salary</option>
            <option value="pension">Pension</option>
            <option value="family_pension">Family pension</option>
            <option value="business">Business</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 7, color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 700 }}>
          Tax regime
          <select aria-label="Tax regime" value={regime} onChange={event => setRegime(event.target.value)} className="tax-input">
            <option value="">Choose explicitly</option>
            <option value="new">New regime</option>
            <option value="old">Old regime</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 7, color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 700 }}>
          Inflation assumption (%)
          <input
            aria-label="Inflation assumption"
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={inflationRate}
            onChange={event => setInflationRate(event.target.value)}
            placeholder="Enter inflation"
            className="tax-input"
          />
        </label>
        <button type="submit" className="hud-profile-btn" disabled={loading} style={{ minHeight: 42 }}>
          {loading ? 'Calculating…' : 'Calculate explicit tax what-if'}
        </button>
        <small style={{ gridColumn: '1 / -1', color: '#64748b', lineHeight: 1.5 }}>
          SEPARATE_TAX_WHAT_IF: these inputs are not stored in or inferred from your Financial Profile and do not alter suitability.
        </small>
        {error && <p role="alert" style={{ gridColumn: '1 / -1', color: '#fda4af', margin: 0 }}>{error}</p>}
      </motion.form>

      {/* ═══════ HERO KPI STRIP ═══════ */}
      <motion.div className="pta-kpi-strip" variants={itemVariants}>
        <div className="pta-kpi-card pta-kpi-card--regime">
          <div className="pta-kpi-icon-wrap pta-kpi-icon--blue">
            <Layers size={18} />
          </div>
          <div className="pta-kpi-content">
            <span className="pta-kpi-label">Tax Regime</span>
            <span className="pta-kpi-value">{regime ? (regime === 'new' ? 'New System' : 'Old System') : 'Not selected'}</span>
          </div>
        </div>

        <div className="pta-kpi-divider" />

        <div className="pta-kpi-card pta-kpi-card--bracket">
          <div className="pta-kpi-icon-wrap pta-kpi-icon--purple">
            <Award size={18} />
          </div>
          <div className="pta-kpi-content">
            <span className="pta-kpi-label">Max Tax Bracket</span>
            <span className="pta-kpi-value">{(marginalRate * 100).toFixed(0)}%</span>
          </div>
        </div>

        <div className="pta-kpi-divider" />

        <div className="pta-kpi-card pta-kpi-card--inflation">
          <div className="pta-kpi-icon-wrap pta-kpi-icon--amber">
            <TrendingDown size={18} />
          </div>
          <div className="pta-kpi-content">
            <span className="pta-kpi-label">Inflation Rate</span>
            <span className="pta-kpi-value">{backendPostTaxData ? `${Number(backendPostTaxData.assumptions.inflationRate * 100).toFixed(1)}%` : 'Not calculated'}</span>
          </div>
        </div>

        <div className="pta-kpi-divider" />

        <div className="pta-kpi-card pta-kpi-card--erosion">
          <div className="pta-kpi-icon-wrap pta-kpi-icon--rose">
            <AlertCircle size={18} />
          </div>
          <div className="pta-kpi-content">
            <span className="pta-kpi-label">Total Tax Drag</span>
            <span className="pta-kpi-value pta-kpi-value--rose">{formatINR(totalTaxDragRupees)}</span>
          </div>
        </div>
      </motion.div>

      {/* ═══════ MAIN GRID ═══════ */}
      <div className="pta-main-grid">
        {/* ─── LEFT COLUMN ─── */}
        <div className="pta-col">
          {/* Chart Card */}
          <motion.div className="pta-card" variants={itemVariants}>
            <div className="pta-card-header">
              <div>
                <h3 className="pta-card-title">Return Drag Comparison</h3>
                <p className="pta-card-subtitle">Before Tax → After Tax → Real (inflation-adjusted)</p>
              </div>
            </div>

            <div className="pta-chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={postTaxData} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                  <defs>
                    <linearGradient id="gradNominal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.95}/>
                      <stop offset="100%" stopColor="#0284c7" stopOpacity={0.6}/>
                    </linearGradient>
                    <linearGradient id="gradPostTax" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#c084fc" stopOpacity={0.95}/>
                      <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.6}/>
                    </linearGradient>
                    <linearGradient id="gradReal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34d399" stopOpacity={0.95}/>
                      <stop offset="100%" stopColor="#059669" stopOpacity={0.6}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} interval={0} />
                  <YAxis tick={{ fill: '#475569', fontSize: 11, fontWeight: 500 }} tickFormatter={(val) => `${val}%`} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.03)', radius: 6 }}
                    contentStyle={{ background: 'rgba(2, 6, 18, 0.96)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: 14, color: '#f8fafc', fontSize: '0.82rem', fontWeight: 600, padding: '12px 16px', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}
                    formatter={(value, name) => [`${Number(value).toFixed(1)}%`, name]}
                  />
                  <Legend verticalAlign="top" height={40} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.3px' }}/>
                  <Bar dataKey="nominalReturn" name="Before Tax" fill="url(#gradNominal)" radius={[6,6,0,0]} barSize={22} />
                  <Bar dataKey="postTaxReturn" name="After Tax" fill="url(#gradPostTax)" radius={[6,6,0,0]} barSize={22} />
                  <Bar dataKey="realReturn" name="Real Return" fill="url(#gradReal)" radius={[6,6,0,0]} barSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Detailed Rates Table */}
          <motion.div className="pta-card pta-card--flush" variants={itemVariants}>
            <div className="pta-table-header" onClick={() => setShowBreakdown(!showBreakdown)} role="button" tabIndex={0}>
              <div className="pta-table-header-left">
                <h3 className="pta-card-title">Detailed Breakdown</h3>
                <span className="pta-table-count">{postTaxData.length} assets</span>
              </div>
              <div className="pta-table-header-right">
                <span className="pta-inflation-chip">
                  <TrendingDown size={12} /> {backendPostTaxData ? `${Number(backendPostTaxData.assumptions.inflationRate * 100).toFixed(1)}% inflation` : 'Awaiting inputs'}
                </span>
                <motion.div
                  animate={{ rotate: showBreakdown ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  className="pta-chevron-wrap"
                >
                  <ChevronDown size={18} />
                </motion.div>
              </div>
            </div>

            <AnimatePresence>
              {showBreakdown && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="pta-table-scroll">
                    <table className="pta-table">
                      <thead>
                        <tr>
                          <th className="pta-th--left">Asset</th>
                          <th className="pta-th--left">Tax Treatment</th>
                          <th className="pta-th--center">Nominal</th>
                          <th className="pta-th--center">Post-Tax</th>
                          <th className="pta-th--center">Real</th>
                          <th className="pta-th--right">Projected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {postTaxData.map((data, i) => (
                          <tr key={i} className="pta-table-row">
                            <td className="pta-td--asset">
                              <div className="pta-asset-color" style={{ background: barColors[i % barColors.length] }} />
                              <div>
                                <span className="pta-asset-name">{data.name}</span>
                                <span className="pta-asset-cat">{data.category}</span>
                              </div>
                            </td>
                            <td>
                              <span className={`pta-badge ${getTaxBadgeClass(data.taxDetails.taxType)}`}>
                                {data.taxDetails.taxType}
                              </span>
                            </td>
                            <td className="pta-td--mono pta-td--center pta-td--dim">
                              {data.nominalReturn.toFixed(1)}%
                            </td>
                            <td className="pta-td--mono pta-td--center pta-td--purple">
                              {data.postTaxReturn.toFixed(1)}%
                            </td>
                            <td className={`pta-td--mono pta-td--center ${data.realReturn > 0 ? 'pta-td--green' : 'pta-td--rose'}`}>
                              <span className="pta-real-cell">
                                {data.realReturn > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                {data.realReturn > 0 ? '+' : ''}{data.realReturn.toFixed(1)}%
                              </span>
                            </td>
                            <td className="pta-td--mono pta-td--right pta-td--blue pta-td--bold">
                              {formatINR(data.wealthGained)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        {/* ─── RIGHT COLUMN ─── */}
        <div className="pta-col">
          {/* Profit Retention Efficiency - Hero Widget */}
          <motion.div className="pta-card pta-retention-hero" variants={itemVariants}>
            <h3 className="pta-retention-label">Profit Retention Efficiency</h3>

            <div className="pta-donut-container">
              <svg className="pta-donut-svg" viewBox="0 0 100 100">
                <defs>
                  <linearGradient id="ptaProgressGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#10b981" />
                    <stop offset="100%" stopColor="#34d399" />
                  </linearGradient>
                </defs>
                {/* Background track */}
                <circle cx="50" cy="50" r="40" className="pta-donut-track" />
                {/* Eroded portion (red) */}
                <circle cx="50" cy="50" r="40"
                  className="pta-donut-eroded"
                  strokeDasharray="251.2"
                  strokeDashoffset="0"
                  transform="rotate(-90 50 50)"
                />
                {/* Retained portion (green) */}
                <circle cx="50" cy="50" r="40"
                  className="pta-donut-fill"
                  strokeDasharray="251.2"
                  strokeDashoffset={strokeDashoffset}
                  transform="rotate(-90 50 50)"
                />
              </svg>

              <div className="pta-donut-center">
                <span className="pta-donut-pct">{efficiencyPercent.toFixed(1)}%</span>
                <span className="pta-donut-sub">RETAINED</span>
              </div>

              {/* Outer glow ring */}
              <div className="pta-donut-glow" />
            </div>

            <div className="pta-retention-metrics">
              <div className="pta-metric-pill pta-metric-pill--green">
                <span className="pta-metric-label">You Keep</span>
                <span className="pta-metric-value">₹{keptAmount}</span>
              </div>
              <div className="pta-metric-pill pta-metric-pill--rose">
                <span className="pta-metric-label">Eroded</span>
                <span className="pta-metric-value">₹{erodedAmount}</span>
              </div>
            </div>
            <p className="pta-retention-footnote">Per ₹1,000 of gross profits</p>
          </motion.div>

          {/* Tax Erosion Warning */}
          {totalTaxDragRupees > 0 && (
            <motion.div className="pta-card pta-erosion-card" variants={itemVariants}>
              <div className="pta-erosion-icon-wrap">
                <AlertCircle size={20} />
              </div>
              <div className="pta-erosion-content">
                <h4 className="pta-erosion-title">Projected Tax Erosion</h4>
                <p className="pta-erosion-text">
                  Taxes will reduce your total projected savings by roughly <strong>{formatINR(totalTaxDragRupees)}</strong> over your investment timeline.
                </p>
              </div>
            </motion.div>
          )}

          {/* Advisory Actions */}
          <motion.div className="pta-card pta-advisory-card" variants={itemVariants}>
            <h3 className="pta-advisory-header">
              <Zap size={15} className="pta-advisory-icon" />
              Advisory Actions
            </h3>
            <div className="pta-advisory-list">
              {actionableInsights.map((insight, idx) => (
                <motion.div
                  key={idx}
                  className={`pta-advisory-item pta-advisory-item--${insight.color}`}
                  whileHover={{ x: 4, scale: 1.005 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                >
                  <div className={`pta-advisory-item-icon pta-advisory-item-icon--${insight.color}`}>
                    {insight.icon}
                  </div>
                  <div className="pta-advisory-item-body">
                    <h4 className="pta-advisory-item-title">{insight.title}</h4>
                    <p className="pta-advisory-item-desc">{insight.body}</p>
                  </div>
                  <ArrowRight size={14} className="pta-advisory-arrow" />
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
};

export default PostTaxAnalysis;
