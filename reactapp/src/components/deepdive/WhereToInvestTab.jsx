import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Shield, Star, Info, Wallet, Zap, History as HistoryIcon, TrendingUp, AlertTriangle, Globe, Activity } from 'lucide-react';
import * as api from '../../services/api';
import SebiDisclaimer from '../SebiDisclaimer';
import { nullableMarketNumber } from '../../utils/marketDataDisplay';

const RISK_LEVELS = [
  { label: 'Low', color: '#22c55e', desc: 'Lower relative risk. Any guarantee or insurance depends on the specific product terms.' },
  { label: 'Low to Moderate', color: '#84cc16', desc: 'Limited price fluctuation may occur; review the product-specific liquidity and credit terms.' },
  { label: 'Moderate', color: '#eab308', desc: 'Market-price volatility is present and capital value can decline.' },
  { label: 'Moderately High', color: '#f97316', desc: 'Meaningful short-term volatility and loss risk are possible.' },
  { label: 'High', color: '#ef4444', desc: 'Substantial market risk and drawdowns are possible; suitability is profile-dependent.' },
  { label: 'Very High', color: '#dc2626', desc: 'The highest catalog risk tier; large and prolonged losses are possible.' },
];

// Human-readable labels for sub-category tabs (professional typography)
const SUB_TAB_LABELS = {
  sovereign_gsec: 'Sovereign G-Sec',
  aaa_corporate: 'AAA Corporate',
  section_54ec: 'Section 54EC',
  tax_free_bonds: 'Tax-Free Bonds',
  psu_bonds: 'PSU Bonds',
  broad_market: 'Broad Market',
  sectoral_thematic: 'Sectoral & Thematic',
  smart_beta: 'Smart Beta & Factor',
  commodity: 'Commodity ETFs',
  international: 'International ETFs',
  physical_gold_etf: 'Physical Gold ETF',
  silver_etf: 'Silver ETF',
  sgb_secondary: 'SGB Secondary',
  largecap_index: 'LargeCap Index',
  next50_midcap: 'Next50 & MidCap',
  smart_beta_factor: 'Smart Beta Factor',
  large_cap: 'Large Cap',
  mid_cap: 'Mid Cap',
  small_cap: 'Small Cap',
  flexi_multi: 'Flexi & Multi Cap',
  sector_thematic: 'Sector & Thematic',
  value_contra: 'Value & Contra',
  growth_bluechip: 'Growth & Bluechip',
  momentum_quant: 'Momentum & Quant',
  dividend_yield: 'Dividend Yield',
  pharma_healthcare: 'Pharma & Healthcare',
  banking_financial: 'Banking & Financial',
  it_technology: 'IT & Technology',
  infrastructure: 'Infrastructure',
  defence_manufacturing: 'Defence & Mfg',
  energy_metals: 'Energy & Metals',
  consumption_fmcg: 'Consumption & FMCG',
  // midcap/smallcap MF strategy sub-tabs
  growth_momentum: 'Growth & Momentum',
  diversified_core: 'Diversified Core',
  value_quality: 'Value & Quality',
  aggressive_alpha: 'Aggressive Alpha',
  diversified_broad: 'Diversified Broad',
  quality_defensive: 'Quality Defensive',
  // direct equity sector sub-tabs
  energy_industrial: 'Energy & Industrial',
  fmcg_consumer: 'FMCG & Consumer',
  // REIT sub-tabs
  office_reits: 'Office REITs',
  retail_reits: 'Retail REITs',
  infrastructure_invits: 'Infrastructure InvITs',
};

const WhereToInvestTab = ({ inv, userProfile }) => {
  const profileId = userProfile?.profileId;
  const parentInstrumentId = inv?.id;
  const requestKey = `${profileId || 'missing-profile'}:${parentInstrumentId || 'missing-instrument'}`;
  const [rankingResult, setRankingResult] = useState({
    requestKey: null,
    products: [],
    catalog: null,
    suitability: null,
    ranking: null,
    comparisonUniverse: null,
    error: null,
  });
  const wtiData = useMemo(() => rankingResult.catalog || ({
    riskLevel: inv?.riskScore ?? inv?.risk ?? null,
    note: null,
    howToStart: null,
  }), [inv, rankingResult.catalog]);
  const subCategoryMap = wtiData?.sectors || wtiData?.subCategories || null;
  const subKeys = subCategoryMap ? Object.keys(subCategoryMap) : [];

  const [activeSubTab, setActiveSubTab] = useState(subKeys[0] || null);
  const [contextPreview, setContextPreview] = useState(null);
  const [contextPreviewError, setContextPreviewError] = useState(null);
  const [contextPreviewLoading, setContextPreviewLoading] = useState(false);
  const [marketContext, setMarketContext] = useState(null);
  const [marketContextError, setMarketContextError] = useState(null);
  const [sortBy, setSortBy] = useState('score');

  useEffect(() => {
    const controller = new AbortController();
    api.getCurrentMarketContext({ signal: controller.signal })
      .then((result) => {
        setMarketContext(result);
        setMarketContextError(null);
      })
      .catch(error => {
        if (error?.code !== 'REQUEST_ABORTED') {
          setMarketContext(null);
          setMarketContextError(error.message || 'Live market context request failed.');
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setContextPreview(null);
    setContextPreviewError(null);
  }, [parentInstrumentId]);

  const toggleContextPreview = async () => {
    if (contextPreview) {
      setContextPreview(null);
      return;
    }
    if (marketContext?.status !== 'MARKET_CONTEXT_AVAILABLE' || !profileId) {
      setContextPreviewError('A live market context and saved Financial Profile are required.');
      return;
    }
    try {
      setContextPreviewLoading(true);
      setContextPreviewError(null);
      const result = await api.previewMarketContextAdjustment(profileId);
      setContextPreview(result);
    } catch (error) {
      setContextPreview(null);
      setContextPreviewError(error.message || 'Market-context adjustment preview is unavailable.');
    } finally {
      setContextPreviewLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    if (!profileId || !parentInstrumentId) {
      return () => controller.abort();
    }

    api.rankInvestmentCandidates(profileId, parentInstrumentId, { signal: controller.signal }).then((result) => {
      const ranked = Array.isArray(result?.products) ? result.products : [];
      setRankingResult({
        requestKey,
        products: ranked.map((product) => {
          const historicalReturn = nullableMarketNumber(product.historicalReturn?.valuePct);
          const nav = nullableMarketNumber(product.nav?.value);
          return {
            ...product,
            displayMetricLabel: Number.isFinite(historicalReturn) ? 'Historical 1Y return' : 'Current NAV',
            displayMetric: Number.isFinite(historicalReturn)
              ? `${historicalReturn.toFixed(2)}% historical`
              : Number.isFinite(nav) ? `₹${nav.toLocaleString('en-IN')}` : 'Unavailable',
          };
        }),
        catalog: result?.catalog || null,
        suitability: result?.suitability || null,
        ranking: result?.ranking || null,
        comparisonUniverse: result?.comparisonUniverse || null,
        error: null,
      });
    }).catch((error) => {
      if (error?.code === 'REQUEST_ABORTED') return;
      setRankingResult({
        requestKey,
        products: [],
        catalog: null,
        suitability: null,
        ranking: null,
        comparisonUniverse: null,
        error: 'Authoritative product ranking is temporarily unavailable. No personalized ranking has been generated.',
      });
    });

    return () => controller.abort();
  }, [parentInstrumentId, profileId, requestKey]);

  if (!wtiData) return (
    <div style={{ textAlign: 'center', padding: '80px 0' }}>
      <Building2 size={48} color="var(--ddm-text-muted)" />
      <p style={{ color: 'var(--ddm-text-muted)', marginTop: 16, fontSize: '0.9rem' }}>No product data available for this instrument.</p>
    </div>
  );

  const riskLevel = Number(wtiData.riskLevel);
  const level = Number.isFinite(riskLevel) ? Math.max(0, Math.min(5, riskLevel - 1)) : null;
  const risk = level === null
    ? { label: 'Not available', color: '#64748b', desc: 'The backend did not provide a parent-category suitability risk classification.' }
    : { ...RISK_LEVELS[level], desc: `${RISK_LEVELS[level].desc} This is the parent-category suitability tier, not a verified product Risk-o-Meter.` };
  const CX = 140, CY = 125, R = 90, r2 = 62;
  const totalAngle = Math.PI;
  const segGap = 0.025;

  const missingRankingInput = !profileId || !parentInstrumentId;
  const rankingStatus = missingRankingInput
    ? 'error'
    : rankingResult.requestKey === requestKey
    ? (rankingResult.error ? 'error' : 'ready')
    : 'loading';
  const products = rankingStatus === 'ready' ? rankingResult.products : [];
  const isEvidenceRanked = rankingResult.ranking?.status === 'EVIDENCE_RANKED';
  const isComparableSet = rankingResult.ranking?.status === 'VERIFIED_COMPARABLE_OPTIONS';
  const isUnavailable = rankingStatus === 'ready' && rankingResult.ranking?.status === 'UNAVAILABLE';
  const rankingError = missingRankingInput
    ? 'A saved Financial Profile and authoritative parent instrument are required. No provider ranking is shown.'
    : rankingStatus === 'error' ? rankingResult.error : null;
  const headerLabel = rankingStatus === 'loading'
    ? 'Loading Verified Product Data…'
    : isEvidenceRanked
      ? `Verified Products (${products.length} Ranked Option${products.length === 1 ? '' : 's'})`
      : isComparableSet
        ? `Verified Products (${products.length} Comparable Option${products.length === 1 ? '' : 's'})`
        : 'Verified Products Unavailable';
  const contextAvailable = marketContext?.status === 'MARKET_CONTEXT_AVAILABLE';
  const contextColor = contextAvailable ? '#38bdf8' : '#f59e0b';
  const contextSignals = Object.entries(marketContext?.signals || {});
  const contextReasonCodes = marketContext?.reasonCodes || (marketContextError ? ['MARKET_CONTEXT_REQUEST_FAILED'] : []);
  const formatSignal = (item) => {
    if (!item?.available || !Number.isFinite(item.value)) return 'UNAVAILABLE';
    const value = Number(item.value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    return item.unit === 'PERCENT' ? `${value}%` : value;
  };

  return (
    <div className="tab-fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: '1rem' }}>
        <div className="ddm-section-header" style={{ marginBottom: 0 }}>{headerLabel}</div>
        
        {/* Interactive Sorting Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(15, 23, 42, 0.7)', padding: '4px 8px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, marginRight: 2 }}>Sort:</span>
          {[
            { id: 'score', label: isEvidenceRanked ? 'Historical Evidence' : 'Comparable Set' },
            { id: 'postTaxYield', label: 'Post-Tax Yield' },
            { id: 'expense', label: 'Low Expense Ratio' }
          ].map(mode => (
            <button
              key={mode.id}
              type="button"
              disabled={mode.id !== 'score'}
              title={mode.id === 'score'
                ? (isEvidenceRanked ? 'Server order among explicitly sourced Direct Growth options by one-year historical NAV return' : 'Stable display order only; not a ranking')
                : 'Unavailable without established provider-specific data'}
              onClick={() => mode.id === 'score' && setSortBy(mode.id)}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                border: sortBy === mode.id ? '1px solid #38bdf8' : '1px solid transparent',
                background: sortBy === mode.id ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                color: sortBy === mode.id ? '#38bdf8' : '#94a3b8',
                fontSize: '0.72rem',
                fontWeight: 600,
                cursor: mode.id === 'score' ? 'pointer' : 'not-allowed',
                opacity: mode.id === 'score' ? 1 : 0.55,
                transition: 'all 0.2s ease'
              }}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {/* Verified live market context. It is never replaced with a static regime. */}
      <div data-testid="market-context-panel" style={{
          background: 'rgba(15, 23, 42, 0.85)',
          border: `1px solid ${contextColor}`,
          borderRadius: '12px',
          padding: '14px 18px',
          marginBottom: '1.25rem',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Globe size={18} style={{ color: contextColor }} />
              <span style={{ fontSize: '0.9rem', fontWeight: '700', color: '#f8fafc' }}>Verified Live Market Context</span>
            </div>
            <span style={{
              fontSize: '0.72rem',
              fontWeight: '700',
              padding: '4px 10px',
              borderRadius: '12px',
              background: 'rgba(255,255,255,0.08)',
              color: contextColor,
              border: `1px solid ${contextColor}`
            }}>
              {marketContext === null && !marketContextError
                ? 'LOADING'
                : contextAvailable ? marketContext.context : 'MARKET_CONTEXT_UNAVAILABLE'}
            </span>
          </div>
          <p style={{ fontSize: '0.82rem', lineHeight: '1.5', color: '#cbd5e1', margin: '0 0 10px 0' }}>
            {contextAvailable
              ? `${marketContext.classification} · ${marketContext.policyVersion} · confidence: unavailable (deterministic policy, not ML)`
              : marketContextError || 'No usable live context is published unless NIFTY 50, India VIX, and sufficient fresh history are all verified.'}
          </p>
          {contextSignals.length > 0 && (
            <div data-testid="market-context-signals" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 6, marginBottom: 10 }}>
              {contextSignals.map(([key, item]) => (
                <div key={key} style={{ background: 'rgba(255,255,255,0.035)', borderRadius: 6, padding: '6px 8px' }}>
                  <div style={{ color: '#64748b', fontSize: '0.64rem' }}>{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                  <div style={{ color: item?.available ? '#e2e8f0' : '#fbbf24', fontSize: '0.76rem', fontWeight: 650 }}>{formatSignal(item)}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: '0.7rem', lineHeight: 1.55, color: '#94a3b8', marginBottom: 8 }}>
            <div>Observed: {marketContext?.observedAt || 'UNAVAILABLE'} · Evaluated: {marketContext?.evaluatedAt || 'UNAVAILABLE'} · Freshness: {marketContext?.freshness?.status || 'UNAVAILABLE'}</div>
            <div>Sources: {marketContext?.sources?.length
              ? marketContext.sources.map(source => `${source.provider || 'UNAVAILABLE'} (${source.instrumentId || 'benchmark history'})`).join(', ')
              : 'UNAVAILABLE'}</div>
            <div>Reason codes: {contextReasonCodes.length ? contextReasonCodes.join(', ') : 'UNAVAILABLE'}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <span style={{ fontSize: '0.75rem', fontStyle: 'italic', color: '#94a3b8' }}>
              Context can only reduce risk within the already eligible recommendation. It cannot add products, override suitability, or execute trades.
            </span>
            <button
              type="button"
              onClick={toggleContextPreview}
              disabled={contextPreviewLoading || !contextAvailable || !profileId}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: 'none',
                background: contextPreview ? '#22c55e' : contextColor,
                color: '#020617',
                fontSize: '0.75rem',
                fontWeight: '700',
                cursor: contextAvailable && profileId ? 'pointer' : 'not-allowed',
                opacity: contextAvailable && profileId ? 1 : 0.55,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.3s ease'
              }}
            >
              <Activity size={14} />
              {contextPreviewLoading ? 'Running Server Preview…' : contextPreview ? 'Adjustment Preview Ready ✓' : 'Preview Profile-Safe Adjustment'}
            </button>
          </div>
          {contextPreview && (
            <p style={{ fontSize: '0.72rem', color: '#94a3b8', margin: '10px 0 0' }}>
              Server preview {contextPreview.applied ? 'applied' : 'did not apply'} a bounded {contextPreview.actualTotalTiltPct ?? 0}% total transfer across {contextPreview.explanations?.length ?? 0} allocation change{contextPreview.explanations?.length === 1 ? '' : 's'}. It is not persisted and does not execute trades.
            </p>
          )}
          {contextPreviewError && <p role="alert" style={{ fontSize: '0.72rem', color: '#fca5a5', margin: '10px 0 0' }}>{contextPreviewError}</p>}
        </div>

      {wtiData.note && (
        <div className="wti-note-banner">
          <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <p><strong>REFERENCE METADATA:</strong> {wtiData.note}</p>
        </div>
      )}

      {rankingResult.comparisonUniverse && (
        <div className="wti-note-banner" data-testid="wti-comparison-universe">
          <TrendingUp size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <p>
            <strong>{isEvidenceRanked ? 'VERIFIED RANKING UNIVERSE' : 'VERIFIED COMPARISON UNIVERSE'}:</strong>{' '}
            {rankingResult.comparisonUniverse.disclosure}{' '}
            Source-qualified: {rankingResult.comparisonUniverse.verifiedCategoryProductCount ?? 0}; fresh NAVs: {rankingResult.comparisonUniverse.freshNavProductCount ?? 0}; explicit Direct plans: {rankingResult.comparisonUniverse.sourceEstablishedDirectPlanProductCount ?? 0}; historical evidence: {rankingResult.comparisonUniverse.historicalEvidenceProductCount ?? 0}.
          </p>
        </div>
      )}

      {rankingResult.ranking?.warning && (
        <div className="wti-note-banner">
          <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <p>{rankingResult.ranking.warning}</p>
        </div>
      )}

      {isUnavailable && !rankingError && (
        <div role="status" style={{
          background: 'rgba(100, 116, 139, 0.12)',
          border: '1px solid rgba(148, 163, 184, 0.3)',
          borderRadius: '8px',
          padding: '10px 14px',
          marginBottom: '1rem',
          display: 'flex',
          gap: '10px',
          fontSize: '0.8rem',
          color: '#cbd5e1'
        }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div><strong>UNAVAILABLE:</strong> No source-qualified Phase-2 product ranking is available for this parent category. No fallback products or values were inserted.</div>
        </div>
      )}

      {/* Sub-Category Sector/Theme Drill-Down Tabs */}
      {subKeys.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {subKeys.map(key => (
            <button
              key={key}
              onClick={() => setActiveSubTab(key)}
              style={{
                padding: '6px 14px',
                borderRadius: '20px',
                border: activeSubTab === key ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                background: activeSubTab === key ? 'rgba(56, 189, 248, 0.15)' : 'rgba(15, 23, 42, 0.6)',
                color: activeSubTab === key ? '#38bdf8' : '#94a3b8',
                fontSize: '0.8rem',
                fontWeight: '600',
                cursor: 'pointer',
                textTransform: 'capitalize'
              }}
            >
              {SUB_TAB_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </button>
          ))}
        </div>
      )}

      {rankingError && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '8px',
          padding: '10px 14px',
          marginBottom: '1rem',
          display: 'flex',
          gap: '10px',
          fontSize: '0.8rem',
          color: '#fecaca'
        }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2, color: '#ef4444' }} />
          <div>{rankingError}</div>
        </div>
      )}

      {/* Parent-category suitability gauge; not a product Risk-o-Meter. */}
      <div className="risk-meter-container">
        <div className="risk-meter-header">
          <Shield size={14} style={{ color: risk.color }} />
          <span>Parent Category Risk</span>
          <span className="risk-meter-sebi-tag">Suitability Filter</span>
        </div>
        <div className="risk-meter-gauge">
          <svg viewBox="0 0 280 155" className="risk-meter-svg">
            <defs>
              <filter id="rmGlow">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <filter id="rmNeedleShadow">
                <feDropShadow dx="0" dy="1" stdDeviation="3" floodColor={risk.color} floodOpacity="0.6" />
              </filter>
              <linearGradient id="rmNeedleGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f8fafc" />
                <stop offset="100%" stopColor={risk.color} />
              </linearGradient>
              <radialGradient id="rmHubGrad">
                <stop offset="0%" stopColor="rgba(30,41,59,1)" />
                <stop offset="100%" stopColor="rgba(15,23,42,1)" />
              </radialGradient>
            </defs>

            <path
              d={`M ${CX + (R + 8) * Math.cos(Math.PI)} ${CY - (R + 8) * Math.sin(Math.PI)} A ${R + 8} ${R + 8} 0 0 1 ${CX + (R + 8) * Math.cos(0)} ${CY - (R + 8) * Math.sin(0)}`}
              fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1"
            />

            {RISK_LEVELS.map((r, i) => {
              const a1 = Math.PI - (i / 6) * totalAngle + segGap;
              const a2 = Math.PI - ((i + 1) / 6) * totalAngle - segGap;
              const ox1 = CX + R * Math.cos(a1), oy1 = CY - R * Math.sin(a1);
              const ox2 = CX + R * Math.cos(a2), oy2 = CY - R * Math.sin(a2);
              const ix2 = CX + r2 * Math.cos(a2), iy2 = CY - r2 * Math.sin(a2);
              const ix1 = CX + r2 * Math.cos(a1), iy1 = CY - r2 * Math.sin(a1);
              const isActive = i === level;
              return (
                <path
                  key={i}
                  d={`M ${ox1} ${oy1} A ${R} ${R} 0 0 1 ${ox2} ${oy2} L ${ix2} ${iy2} A ${r2} ${r2} 0 0 0 ${ix1} ${iy1} Z`}
                  fill={r.color}
                  opacity={isActive ? 1 : 0.18}
                  filter={isActive ? 'url(#rmGlow)' : 'none'}
                  style={{ transition: 'opacity 0.6s ease' }}
                />
              );
            })}

            {RISK_LEVELS.map((r, i) => {
              const midAngle = Math.PI - ((i + 0.5) / 6) * totalAngle;
              const labelR = R + 16;
              const lx = CX + labelR * Math.cos(midAngle);
              const ly = CY - labelR * Math.sin(midAngle);
              const isActive = i === level;
              const rotDeg = -((midAngle * 180) / Math.PI - 90);
              const flip = rotDeg > 90 || rotDeg < -90;
              const finalRot = flip ? rotDeg + 180 : rotDeg;
              return (
                <text
                  key={i}
                  x={lx} y={ly}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={isActive ? '#f1f5f9' : 'rgba(255,255,255,0.3)'}
                  fontSize={isActive ? '7' : '6'}
                  fontWeight={isActive ? '700' : '400'}
                  fontFamily="Inter, system-ui, sans-serif"
                  transform={`rotate(${finalRot}, ${lx}, ${ly})`}
                  style={{ transition: 'all 0.4s ease' }}
                >
                  {r.label}
                </text>
              );
            })}

            {[0, 1, 2, 3, 4, 5, 6].map(i => {
              const a = Math.PI - (i / 6) * totalAngle;
              const t1 = CX + (R + 1) * Math.cos(a), u1 = CY - (R + 1) * Math.sin(a);
              const t2 = CX + (R + 6) * Math.cos(a), u2 = CY - (R + 6) * Math.sin(a);
              return <line key={i} x1={t1} y1={u1} x2={t2} y2={u2} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />;
            })}

             {level !== null && (() => {
               const needleAngle = Math.PI - ((level + 0.5) / 6) * totalAngle;
              const needleLen = r2 - 6;
              const tipX = CX + needleLen * Math.cos(needleAngle);
              const tipY = CY - needleLen * Math.sin(needleAngle);
              const basePerp = Math.PI / 2;
              const bx1 = CX + 4 * Math.cos(needleAngle + basePerp);
              const by1 = CY - 4 * Math.sin(needleAngle + basePerp);
              const bx2 = CX + 4 * Math.cos(needleAngle - basePerp);
              const by2 = CY - 4 * Math.sin(needleAngle - basePerp);
              return (
                <g filter="url(#rmNeedleShadow)">
                  <polygon
                    points={`${bx1},${by1} ${bx2},${by2} ${tipX},${tipY}`}
                    fill="url(#rmNeedleGrad)"
                  />
                  <circle cx={tipX} cy={tipY} r="2" fill="#f8fafc" />
                </g>
              );
            })()}

            <circle cx={CX} cy={CY} r="12" fill="url(#rmHubGrad)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
            <circle cx={CX} cy={CY} r="5" fill={risk.color} opacity="0.9" />
            <circle cx={CX} cy={CY} r="2.5" fill="#020617" />
            <line x1={CX - R - 4} y1={CY + 1} x2={CX + R + 4} y2={CY + 1} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          </svg>
        </div>
        <div className="risk-meter-result">
          <div className="risk-meter-pill" style={{ '--risk-color': risk.color, color: 'var(--risk-color)', borderColor: 'var(--risk-color)' }}>
            {risk.label}
          </div>
          <p className="risk-meter-desc">{risk.desc}</p>
        </div>
      </div>

      <div className="wti-grid">
        {products.map((product) => (
          <div key={product.id} className={`wti-item ${isEvidenceRanked && product.rank === 1 && rankingResult.ranking?.hasUniqueLeader ? 'wti-item--featured' : ''}`}>
            <div className="wti-rank" title={isEvidenceRanked ? `Evidence rank ${product.rank}` : 'Comparable option; display position is not a rank'}>{isEvidenceRanked ? product.rank : '='}</div>
            <div className="wti-card-body">
              <div className="wti-card-top">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <h4 className="wti-name">{product.name}</h4>
                    <span className="wti-badge" style={{ background: isEvidenceRanked ? 'rgba(34, 197, 94, 0.15)' : 'rgba(56, 189, 248, 0.12)', color: isEvidenceRanked ? '#4ade80' : '#38bdf8', borderColor: isEvidenceRanked ? 'rgba(34, 197, 94, 0.4)' : 'rgba(56, 189, 248, 0.3)' }}>
                      {product.presentationStatus?.replaceAll('_', ' ') || 'UNAVAILABLE'}
                    </span>
                    {product.tiedRank && <span className="wti-badge">TIED RANK</span>}
                  </div>
                  <span className="wti-provider">{product.provider || 'Provider unavailable'} · {product.source?.provider || 'Source unavailable'}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 700 }}>{product.displayMetricLabel}</span>
                  <div className="wti-rate-chip">{product.displayMetric}</div>
                </div>
              </div>
              <p className="wti-highlights">
                {isEvidenceRanked
                  ? 'Ranked only among explicitly sourced Direct Growth options in the exact AMFI category by verified one-year historical NAV return. Historical performance is not an expected return.'
                  : 'Verified AMFI category and fresh NAV. No defensible merit order is claimed for this comparable option.'}
              </p>

              {product.taxSavingsNote && (
                <div style={{ fontSize: '0.75rem', color: product.taxSavingsNote.startsWith('⚠') ? '#f59e0b' : '#4ade80', fontWeight: 600, margin: '6px 0 4px 0', display: 'flex', alignItems: 'center', gap: 6, background: product.taxSavingsNote.startsWith('⚠') ? 'rgba(245, 158, 11, 0.08)' : 'rgba(34, 197, 94, 0.08)', padding: '4px 8px', borderRadius: '6px', border: `1px solid ${product.taxSavingsNote.startsWith('⚠') ? 'rgba(245, 158, 11, 0.2)' : 'rgba(34, 197, 94, 0.2)'}` }}>
                  <Zap size={12} style={{ color: product.taxSavingsNote.startsWith('⚠') ? '#f59e0b' : '#4ade80', flexShrink: 0 }} />
                  <span>{product.taxSavingsNote}</span>
                </div>
              )}

              {product.realReturnWarning && (
                <div style={{ fontSize: '0.72rem', color: product.realReturnVal < 0 ? '#ef4444' : '#f59e0b', fontWeight: 600, margin: '4px 0 8px 0', display: 'flex', alignItems: 'center', gap: 6, background: product.realReturnVal < 0 ? 'rgba(239, 68, 68, 0.08)' : 'rgba(245, 158, 11, 0.08)', padding: '4px 8px', borderRadius: '6px', border: `1px solid ${product.realReturnVal < 0 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)'}` }}>
                  <AlertTriangle size={11} style={{ color: product.realReturnVal < 0 ? '#ef4444' : '#f59e0b', flexShrink: 0 }} />
                  <span>{product.realReturnWarning}</span>
                </div>
              )}

              <div className="wti-meta-footer">
                <div className="meta-box"><Building2 size={12} /> Source: {product.source?.provider || 'UNAVAILABLE'}</div>
                <div className="meta-box"><Wallet size={12} /> NAV: {Number.isFinite(nullableMarketNumber(product.nav?.value)) ? `₹${nullableMarketNumber(product.nav.value).toLocaleString('en-IN')}` : 'UNAVAILABLE'}</div>
                <div className="meta-box"><HistoryIcon size={12} /> Valuation: {product.valuationDate || 'UNAVAILABLE'}</div>
                <div className="meta-box"><Activity size={12} /> Freshness: {product.freshness?.status || 'UNAVAILABLE'}</div>
                <div className="meta-box">Eligibility: {product.productEligibility?.status?.replaceAll('_', ' ') || 'UNAVAILABLE'}</div>
                <div className="meta-box">Plan: {product.plan || 'UNAVAILABLE'}</div>
                <div className="meta-box">Option: {product.option || 'UNAVAILABLE'}</div>
                {product.historicalReturn && <div className="meta-box"><HistoryIcon size={12} /> History: {product.historicalReturn.startDate} → {product.historicalReturn.endDate}</div>}
                {isEvidenceRanked && product.rank === 1 && rankingResult.ranking?.hasUniqueLeader && <div className="meta-box meta-box--pick"><Star size={12} /> Rank #1 by 1Y Historical NAV Return</div>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {wtiData.howToStart && (
        <div className="wti-howto">
          <Zap size={14} style={{ flexShrink: 0, color: '#22c55e' }} />
          <div>
            <span className="wti-howto-label">How to get started</span>
            <p>{wtiData.howToStart}</p>
          </div>
        </div>
      )}

      {/* Mandatory SEBI Disclaimer Component */}
      <SebiDisclaimer />
    </div>
  );
};

export default WhereToInvestTab;
