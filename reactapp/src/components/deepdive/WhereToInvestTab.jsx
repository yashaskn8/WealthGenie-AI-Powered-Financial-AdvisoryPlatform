import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Shield,
  Star,
  Info,
  Wallet,
  Zap,
  History as HistoryIcon,
  TrendingUp,
  AlertTriangle,
  Globe,
  Activity,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Calculator,
  IndianRupee,
  ArrowUpRight,
  RefreshCw,
} from 'lucide-react';
import * as api from '../../services/api';
import SebiDisclaimer from '../SebiDisclaimer';
import {
  formatMarketTimestamp,
  getMarketDisplayState,
  getMarketEvidenceSource,
  nullableMarketNumber,
} from '../../utils/marketDataDisplay';
import { useMarketContext } from '../../state/useMarketContext';

const RISK_LEVELS = [
  { label: 'Low', color: '#22c55e', desc: 'Lower relative risk. Any guarantee or insurance depends on the specific product terms.' },
  { label: 'Low to Moderate', color: '#84cc16', desc: 'Limited price fluctuation may occur; review the product-specific liquidity and credit terms.' },
  { label: 'Moderate', color: '#eab308', desc: 'Market-price volatility is present and capital value can decline.' },
  { label: 'Moderately High', color: '#f97316', desc: 'Meaningful short-term volatility and loss risk are possible.' },
  { label: 'High', color: '#ef4444', desc: 'Substantial market risk and drawdowns are possible; suitability is profile-dependent.' },
  { label: 'Very High', color: '#dc2626', desc: 'The highest catalog risk tier; large and prolonged losses are possible.' },
];

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
  growth_momentum: 'Growth & Momentum',
  diversified_core: 'Diversified Core',
  value_quality: 'Value & Quality',
  aggressive_alpha: 'Aggressive Alpha',
  diversified_broad: 'Diversified Broad',
  quality_defensive: 'Quality Defensive',
  energy_industrial: 'Energy & Industrial',
  fmcg_consumer: 'FMCG & Consumer',
  office_reits: 'Office REITs',
  retail_reits: 'Retail REITs',
  infrastructure_invits: 'Infrastructure InvITs',
};

const ILLUSTRATIVE_PRINCIPALS = [5000, 10000, 25000, 50000, 100000];

const MARKET_CONTEXT_COPY = {
  NORMAL: {
    headline: 'Market conditions look steady.',
    explanation: 'Your plan maintains standard allocations within investments that fit your profile.',
  },
  CAUTIOUS: {
    headline: 'Markets have been weaker recently.',
    explanation: 'Your plan is being slightly more careful while staying within investments that already fit your profile.',
  },
  HIGH_VOLATILITY: {
    headline: 'Markets are moving more sharply than usual.',
    explanation: 'Your plan stays focused on profile-suitable investments with cautious risk management.',
  },
  RISK_OFF: {
    headline: 'Market risk is elevated right now.',
    explanation: 'Your plan applies the strongest allowed risk reduction while staying within your suitability limits.',
  },
  UNAVAILABLE: {
    headline: 'Verified market information is temporarily unavailable.',
    explanation: 'Your personal suitability rules remain fully active.',
  },
};

function marketSnapshotFingerprint(snapshot) {
  if (!snapshot) return null;
  return [
    snapshot.schemaVersion,
    snapshot.status,
    snapshot.observedAt,
    snapshot.evaluatedAt,
    snapshot.policyOutput?.policyVersion,
    ...(snapshot.policyOutput?.reasonCodes || []),
  ].join('|');
}

const SIGNAL_DEFINITIONS = [
  { key: 'nifty50Current', label: 'NIFTY 50', group: 'market' },
  { key: 'nifty50PreviousClose', label: 'Previous close', group: 'market' },
  { key: 'indiaVixCurrent', label: 'India VIX', group: 'market' },
  { key: 'return1DayPct', label: '1-day return', group: 'market' },
  { key: 'return5DayPct', label: '5-day return', group: 'market' },
  { key: 'return20DayPct', label: '20-day return', group: 'market' },
  { key: 'drawdownFromRecentHighPct', label: 'Drawdown from recent high', group: 'trend' },
  { key: 'movingAverage50Day', label: '50-day moving average', group: 'trend' },
  { key: 'movingAverage200Day', label: '200-day moving average', group: 'trend' },
  { key: 'priceVsMovingAverage50Pct', label: 'vs. 50-day average', group: 'trend' },
  { key: 'priceVsMovingAverage200Pct', label: 'vs. 200-day average', group: 'trend' },
  { key: 'realizedVolatility20DayAnnualizedPct', label: '20-day realized volatility', group: 'volatility' },
];

function getRiskTierColor(tier) {
  switch (tier) {
    case 'Very Low Risk': return { color: '#22c55e', bg: 'rgba(34, 197, 94, 0.1)', border: 'rgba(34, 197, 94, 0.3)' };
    case 'Low Risk': return { color: '#84cc16', bg: 'rgba(132, 204, 22, 0.1)', border: 'rgba(132, 204, 22, 0.3)' };
    case 'Moderate Risk': return { color: '#eab308', bg: 'rgba(234, 179, 8, 0.1)', border: 'rgba(234, 179, 8, 0.3)' };
    case 'High Risk': return { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)', border: 'rgba(239, 68, 68, 0.3)' };
    default: return { color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.1)', border: 'rgba(56, 189, 248, 0.3)' };
  }
}

const WhereToInvestTab = ({ inv, userProfile, recommendationMeta = null }) => {
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

  const [contextPreview, setContextPreview] = useState(null);
  const [contextPreviewError, setContextPreviewError] = useState(null);
  const [contextPreviewLoading, setContextPreviewLoading] = useState(false);
  const {
    marketContext,
    marketContextError,
    marketContextLoading,
    marketContextRefreshing,
    marketContextTransport,
    refreshMarketContext,
  } = useMarketContext();
  const [sortBy, setSortBy] = useState('score');
  const [isTechExpanded, setIsTechExpanded] = useState(false);

  // Illustrative principal & tax context state
  const [illustrativePrincipal, setIllustrativePrincipal] = useState(10000);
  const [showTaxDrawer, setShowTaxDrawer] = useState(false);
  const [taxAnnualIncome, setTaxAnnualIncome] = useState(
    userProfile?.annualGrossIncome ?? userProfile?.annual_gross_income ?? ''
  );
  const [taxIncomeSource, setTaxIncomeSource] = useState('');
  const [taxRegime, setTaxRegime] = useState('');
  const [taxFiscalYear, setTaxFiscalYear] = useState('');
  const [taxUserAge, setTaxUserAge] = useState(userProfile?.age ?? '');
  const [holdingPeriodMonths, setHoldingPeriodMonths] = useState('');
  const [section112AExemptionUsed, setSection112AExemptionUsed] = useState('');
  const [taxPolicyMetadata, setTaxPolicyMetadata] = useState(null);
  const [taxPolicyError, setTaxPolicyError] = useState(null);
  const [activeTaxContext, setActiveTaxContext] = useState(null);

  useEffect(() => {
    if (typeof api.getTaxPolicyMetadata !== 'function') return undefined;
    let cancelled = false;
    api.getTaxPolicyMetadata()
      .then((metadata) => {
        if (cancelled) return;
        setTaxPolicyMetadata(metadata);
        if (!taxFiscalYear && metadata?.currentFiscalYearVerified && metadata.currentFiscalYear) {
          setTaxFiscalYear(metadata.currentFiscalYear);
        }
      })
      .catch((error) => {
        if (!cancelled) setTaxPolicyError(error?.message || 'Verified tax policy metadata is unavailable.');
      });
    return () => { cancelled = true; };
  }, [taxFiscalYear]);

  useEffect(() => {
    setContextPreview(null);
    setContextPreviewError(null);
  }, [parentInstrumentId]);

  useEffect(() => {
    if (userProfile?.age !== undefined && userProfile?.age !== null) {
      setTaxUserAge(userProfile.age);
    }
  }, [userProfile?.age]);

  const currentMarketSnapshot = marketContext?.marketSnapshot || null;
  const currentSnapshotFingerprint = marketSnapshotFingerprint(currentMarketSnapshot);
  useEffect(() => {
    if (contextPreview && contextPreview.__marketSnapshotFingerprint !== currentSnapshotFingerprint) {
      setContextPreview(null);
      setContextPreviewError('This preview is stale because the verified market snapshot changed. Run it again.');
    }
  }, [currentSnapshotFingerprint, contextPreview]);

  const toggleContextPreview = async () => {
    if (contextPreview && contextPreview.__marketSnapshotFingerprint === currentSnapshotFingerprint) {
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
      setContextPreview({
        ...result,
        __marketSnapshotFingerprint: marketSnapshotFingerprint(result?.marketContext?.marketSnapshot),
      });
    } catch (error) {
      setContextPreview(null);
      setContextPreviewError(error.message || 'Market-context adjustment preview is unavailable.');
    } finally {
      setContextPreviewLoading(false);
    }
  };

  // Fetch products whenever instrument, profile, or activeTaxContext changes
  useEffect(() => {
    const controller = new AbortController();
    if (!profileId || !parentInstrumentId) {
      return () => controller.abort();
    }

    const currentTaxContext = activeTaxContext ? {
      ...activeTaxContext,
      illustrativePrincipal,
    } : {
      illustrativePrincipal,
    };

    api.rankInvestmentCandidates(profileId, parentInstrumentId, currentTaxContext, { signal: controller.signal })
      .then((result) => {
        const ranked = Array.isArray(result?.products) ? result.products : [];
        setRankingResult({
          requestKey,
          products: ranked.map((product) => {
            const historicalReturn = nullableMarketNumber(product.historicalReturn?.valuePct);
            const nav = nullableMarketNumber(product.nav?.value);
            const officialRate = nullableMarketNumber(product.officialRate?.value);
            const isRbiFloatingCoupon = product.officialRate?.dataClass === 'OFFICIAL_RBI_FLOATING_COUPON_RATE'
              || product.parentInstrumentId === 'rbi_bonds';
            const officialRateLabel = isRbiFloatingCoupon
              ? 'Current RBI bond coupon'
              : product.officialRate?.dataClass === 'OFFICIAL_BANK_PUBLISHED_RATE'
                ? 'Current official bank rate'
                : 'Current official rate';

            return {
              ...product,
              displayMetricLabel: Number.isFinite(officialRate)
                ? officialRateLabel
                : Number.isFinite(historicalReturn) ? 'Historical 1Y return' : 'Current NAV',
              displayMetric: Number.isFinite(officialRate)
                ? `${officialRate.toFixed(2)}% p.a.`
                : Number.isFinite(historicalReturn) ? `${historicalReturn.toFixed(2)}% historical`
                  : Number.isFinite(nav) ? `₹${nav.toLocaleString('en-IN')}` : 'Unavailable',
            };
          }),
          catalog: result?.catalog || null,
          suitability: result?.suitability || null,
          ranking: result?.ranking || null,
          comparisonUniverse: result?.comparisonUniverse || null,
          error: null,
        });
      })
      .catch((error) => {
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
  }, [parentInstrumentId, profileId, requestKey, activeTaxContext, illustrativePrincipal]);

  const requiredTaxInputs = useMemo(() => (
    [...new Set((rankingResult.products || []).flatMap(product => product.postTaxAnalysis?.requiredTaxInputs || []))]
  ), [rankingResult.products]);

  const handleApplyTaxInputs = (e) => {
    e.preventDefault();
    const incomeNum = Number(taxAnnualIncome);
    const ageNum = Number(taxUserAge);
    if (!Number.isFinite(incomeNum) || incomeNum < 0 || !Number.isInteger(ageNum) || ageNum < 18 || ageNum > 120
      || !taxIncomeSource || !taxRegime || !taxFiscalYear) return;
    const nextContext = {
      annualGrossIncome: incomeNum,
      regime: taxRegime,
      fiscalYear: taxFiscalYear,
      incomeSource: taxIncomeSource,
      userAge: ageNum,
      illustrativePrincipal,
    };
    if (holdingPeriodMonths !== '') nextContext.holdingPeriodMonths = Number(holdingPeriodMonths);
    if (section112AExemptionUsed !== '') nextContext.section112AExemptionUsed = Number(section112AExemptionUsed);
    setActiveTaxContext(nextContext);
  };

  if (!wtiData) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0' }}>
        <Building2 size={48} color="var(--ddm-text-muted)" />
        <p style={{ color: 'var(--ddm-text-muted)', marginTop: 16, fontSize: '0.9rem' }}>
          No product data available for this instrument.
        </p>
      </div>
    );
  }

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
  const contextRawState = contextAvailable ? marketContext.context : 'MARKET_CONTEXT_UNAVAILABLE';
  const beginnerMarketState = contextAvailable ? marketContext.context : 'UNAVAILABLE';
  const contextCopy = MARKET_CONTEXT_COPY[beginnerMarketState] || MARKET_CONTEXT_COPY.UNAVAILABLE;
  const marketSnapshot = marketContext?.marketSnapshot || null;
  const marketDisplay = getMarketDisplayState(marketContext, {
    loading: marketContextLoading && marketContext === null && !marketContextError,
  });
  const marketEvidenceSource = getMarketEvidenceSource(marketContext);
  const marketObservedAt = formatMarketTimestamp(marketSnapshot?.observedAt || marketContext?.observedAt);
  const currentAllocationSource = recommendationMeta?.current_allocation_source
    || recommendationMeta?.currentAllocationSource
    || 'ORIGINAL_RECOMMENDATION';
  const generationAdjustment = recommendationMeta?.generation_market_adjustment
    || recommendationMeta?.market_adjustment
    || null;
  const adjustmentExplanation = currentAllocationSource === 'USER_REBALANCED'
    ? 'Your current allocation was manually rebalanced. The market context below is current evidence; it is not proof that your saved weights were changed by the market policy.'
    : currentAllocationSource === 'MARKET_CONTEXT_ADJUSTED' && generationAdjustment?.applied === true
      ? 'The saved recommendation includes a bounded market-context adjustment inside your suitability limits.'
      : 'The market context below is current evidence. Your saved recommendation remains profile-led unless the recommendation metadata says a bounded adjustment was applied.';

  let marketBadgeColor = '#38bdf8';
  let marketBadgeBg = 'rgba(56, 189, 248, 0.12)';
  let marketBadgeBorder = 'rgba(56, 189, 248, 0.25)';
  if (beginnerMarketState === 'NORMAL') {
    marketBadgeColor = '#22c55e';
    marketBadgeBg = 'rgba(34, 197, 94, 0.12)';
    marketBadgeBorder = 'rgba(34, 197, 94, 0.25)';
  } else if (beginnerMarketState === 'CAUTIOUS') {
    marketBadgeColor = '#f59e0b';
    marketBadgeBg = 'rgba(245, 158, 11, 0.12)';
    marketBadgeBorder = 'rgba(245, 158, 11, 0.25)';
  } else if (beginnerMarketState === 'HIGH_VOLATILITY' || beginnerMarketState === 'RISK_OFF') {
    marketBadgeColor = '#ef4444';
    marketBadgeBg = 'rgba(239, 68, 68, 0.12)';
    marketBadgeBorder = 'rgba(239, 68, 68, 0.25)';
  }

  const signalMap = marketContext?.signals || {};
  const definedSignalKeys = new Set(SIGNAL_DEFINITIONS.map(d => d.key));
  const marketSignals = SIGNAL_DEFINITIONS.filter(d => d.group === 'market' && signalMap[d.key]);
  const trendSignals = SIGNAL_DEFINITIONS.filter(d => d.group === 'trend' && signalMap[d.key]);
  const volatilitySignals = SIGNAL_DEFINITIONS.filter(d => d.group === 'volatility' && signalMap[d.key]);
  const otherSignals = Object.keys(signalMap)
    .filter(k => !definedSignalKeys.has(k))
    .map(k => ({ key: k, label: k.replace(/([A-Z])/g, ' $1').trim() }));

  const contextReasonCodes = marketContext?.reasonCodes || (marketContextError ? ['MARKET_CONTEXT_REQUEST_FAILED'] : []);

  const semanticFacts = marketSnapshot
    ? `${marketSnapshot.observedFacts?.length || 0} observed · ${marketSnapshot.derivedFacts?.length || 0} derived · 1 policy output`
    : 'Observed, derived, and policy output are separated by the backend contract.';

  const formatSignal = (item) => {
    if (!item?.available || !Number.isFinite(item.value)) return 'UNAVAILABLE';
    const value = Number(item.value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    return item.unit === 'PERCENT' ? `${value}%` : value;
  };

  const signalSemanticClass = (key) => signalMap[key]?.semanticClass || signalMap[key]?.dataClass
    || (['nifty50Current', 'nifty50PreviousClose', 'indiaVixCurrent'].includes(key) ? 'OBSERVED' : 'DERIVED');

  return (
    <div className="tab-fade-in">
      {/* ─── Beginner-First Market Summary Card ─── */}
      <section
        className="wti-beginner-market-card"
        aria-label="Market conditions overview"
        style={{ '--market-accent': marketBadgeColor }}
      >
        <div className="wti-beginner-market-header">
          <div className="wti-header-title-group">
            <Globe size={16} className="wti-header-globe-icon" style={{ color: marketBadgeColor }} />
            <h3 className="wti-header-title">Market today</h3>
          </div>
          <span
            className="wti-beginner-market-badge"
            style={{
              color: marketBadgeColor,
              background: marketBadgeBg,
              borderColor: marketBadgeBorder,
            }}
          >
            {contextAvailable ? contextRawState : marketDisplay.key}
          </span>
        </div>

        <div className="wti-beginner-market-body">
          <p className="wti-beginner-market-headline">{contextCopy.headline}</p>
          <p className="wti-beginner-meaning">
            <span className="wti-meaning-lead">What this means for you:</span> {adjustmentExplanation}
          </p>
          <div className="wti-market-evidence-summary" data-testid="market-data-status">
            <span className="wti-market-data-status">{marketDisplay.label}</span>
            <span>{marketDisplay.detail}</span>
            {marketContextTransport?.revalidationStatus === 'FAILED' && (
              <span role="status">Refresh failed; showing the last verified snapshot.</span>
            )}
            <span className="wti-market-data-asof">
              As of: {marketObservedAt || 'Unavailable'} · Source: {marketEvidenceSource || 'Unavailable'}
            </span>
            <button
              type="button"
              className="wti-market-refresh-btn"
              onClick={() => refreshMarketContext()}
              disabled={marketContextRefreshing || marketContextLoading}
              aria-label="Refresh market data"
            >
              <RefreshCw size={13} className={marketContextRefreshing ? 'wti-refresh-spin' : ''} />
              <span>{marketContextRefreshing ? 'Refreshing…' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        <div className="wti-beginner-market-footer">
          <button
            type="button"
            className="wti-preview-plan-btn"
            onClick={toggleContextPreview}
            disabled={contextPreviewLoading || !contextAvailable || !profileId}
            aria-label="See how this affects my plan"
          >
            <ArrowUpRight size={14} />
            <span>
              {contextPreviewLoading
                ? 'Running Server Preview…'
                : contextPreview
                ? 'Adjustment Preview Ready ✓'
                : 'See how this affects my plan'}
            </span>
          </button>

          <button
            type="button"
            className="wti-tech-toggle-btn"
            onClick={() => setIsTechExpanded(prev => !prev)}
            aria-expanded={isTechExpanded}
            aria-controls="market-context-panel"
          >
            <span>Technical details</span>
            <ChevronDown
              size={14}
              className={`wti-chevron-icon ${isTechExpanded ? 'wti-chevron-rotated' : ''}`}
            />
          </button>
        </div>

        {contextPreview && (
          <p className="wti-preview-feedback">
            Server preview {contextPreview.applied ? 'applied' : 'did not apply'} a bounded {contextPreview.actualTotalTiltPct ?? 0}% total tilt across {contextPreview.explanations?.length ?? 0} allocation change{contextPreview.explanations?.length === 1 ? '' : 's'}. It is not persisted and does not execute trades.
          </p>
        )}
        {contextPreviewError && (
          <p role="alert" className="wti-preview-error">{contextPreviewError}</p>
        )}

        {/* Technical Details Panel — Collapsed by Default */}
        <div
          id="market-context-panel"
          data-testid="market-context-panel"
          className={`wti-tech-panel ${isTechExpanded ? 'wti-tech-panel--expanded' : 'wti-tech-panel--collapsed'}`}
          hidden={!isTechExpanded}
        >
          <div className="wti-tech-panel-inner">
            {/* Metric Signal Groups */}
            <div data-testid="market-context-signals" className="wti-tech-signals-container">
              {marketSignals.length > 0 && (
                <div className="wti-tech-group">
                  <h4 className="wti-tech-group-title">Market & Index</h4>
                  <div className="wti-tech-metric-grid">
                    {marketSignals.map(sig => (
                      <div key={sig.key} className="wti-tech-metric-tile">
                        <span className="wti-tech-metric-label">{sig.label}</span>
                        <span className="wti-tech-metric-class">{signalSemanticClass(sig.key)}</span>
                        <span
                          className="wti-tech-metric-value"
                          style={{ color: signalMap[sig.key]?.available ? '#f8fafc' : '#fbbf24' }}
                        >
                          {formatSignal(signalMap[sig.key])}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {trendSignals.length > 0 && (
                <div className="wti-tech-group">
                  <h4 className="wti-tech-group-title">Trend & Moving Averages</h4>
                  <div className="wti-tech-metric-grid">
                    {trendSignals.map(sig => (
                      <div key={sig.key} className="wti-tech-metric-tile">
                        <span className="wti-tech-metric-label">{sig.label}</span>
                        <span className="wti-tech-metric-class">{signalSemanticClass(sig.key)}</span>
                        <span
                          className="wti-tech-metric-value"
                          style={{ color: signalMap[sig.key]?.available ? '#f8fafc' : '#fbbf24' }}
                        >
                          {formatSignal(signalMap[sig.key])}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {volatilitySignals.length > 0 && (
                <div className="wti-tech-group">
                  <h4 className="wti-tech-group-title">Volatility</h4>
                  <div className="wti-tech-metric-grid">
                    {volatilitySignals.map(sig => (
                      <div key={sig.key} className="wti-tech-metric-tile">
                        <span className="wti-tech-metric-label">{sig.label}</span>
                        <span className="wti-tech-metric-class">{signalSemanticClass(sig.key)}</span>
                        <span
                          className="wti-tech-metric-value"
                          style={{ color: signalMap[sig.key]?.available ? '#f8fafc' : '#fbbf24' }}
                        >
                          {formatSignal(signalMap[sig.key])}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {otherSignals.length > 0 && (
                <div className="wti-tech-group">
                  <h4 className="wti-tech-group-title">Other Signals</h4>
                  <div className="wti-tech-metric-grid">
                    {otherSignals.map(sig => (
                      <div key={sig.key} className="wti-tech-metric-tile">
                        <span className="wti-tech-metric-label">{sig.label}</span>
                        <span className="wti-tech-metric-class">{signalSemanticClass(sig.key)}</span>
                        <span
                          className="wti-tech-metric-value"
                          style={{ color: signalMap[sig.key]?.available ? '#f8fafc' : '#fbbf24' }}
                        >
                          {formatSignal(signalMap[sig.key])}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Evidence & Provenance Section */}
            <div className="wti-tech-evidence-section">
              <h4 className="wti-tech-group-title">Evidence & Policy Provenance</h4>
              <div className="wti-semantic-legend" data-testid="market-semantic-legend">
                <span>Observed facts: provider values</span>
                <span>Derived facts: deterministic calculations</span>
                <span>Policy output: market-context classification</span>
              </div>
              <div className="wti-tech-provenance-lines">Data plane: {semanticFacts}</div>
              <div className="wti-tech-policy-badge">
                {contextAvailable
                  ? `${marketContext.classification} · ${marketContext.policyVersion} · confidence: unavailable (deterministic policy, not ML)`
                  : marketContextError || 'No usable live context is published unless NIFTY 50, India VIX, and sufficient fresh history are all verified.'}
              </div>

              <div className="wti-tech-provenance-lines">
                <div>
                  Observed: {marketContext?.observedAt || 'UNAVAILABLE'} · Evaluated: {marketContext?.evaluatedAt || 'UNAVAILABLE'} · Freshness: {marketContext?.freshness?.status || 'UNAVAILABLE'}
                </div>
                <div>
                  Sources:{' '}
                  {marketContext?.sources?.length
                    ? marketContext.sources.map(source => `${source.provider || 'UNAVAILABLE'} (${source.instrumentId || 'benchmark history'} · ${source.dataClass || 'UNAVAILABLE'})`).join(', ')
                    : 'UNAVAILABLE'}
                </div>
                <div>Reason codes: {contextReasonCodes.length ? contextReasonCodes.join(', ') : 'UNAVAILABLE'}</div>
              </div>

              <p className="wti-tech-safety-note">
                Context can only reduce risk within the already eligible recommendation. It cannot add products, override suitability, or execute trades.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Illustrative Investment & Tax Controls Bar ─── */}
      <div className="wti-controls-bar">
        <div className="wti-illustrative-group">
          <span className="wti-illustrative-label">Illustrative example:</span>
          {ILLUSTRATIVE_PRINCIPALS.map((amount) => (
            <button
              key={amount}
              type="button"
              className={`wti-amount-btn ${illustrativePrincipal === amount ? 'wti-amount-btn--active' : ''}`}
              onClick={() => setIllustrativePrincipal(amount)}
              title={`View illustrative ₹${amount.toLocaleString('en-IN')} investment outcome`}
            >
              ₹{amount.toLocaleString('en-IN')}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="wti-tax-toggle-btn"
          onClick={() => setShowTaxDrawer(!showTaxDrawer)}
          title="Add or update income and tax regime details for personalized after-tax returns"
        >
          <Calculator size={14} />
          <span>{activeTaxContext ? 'Update Tax Details' : 'Calculate after tax'}</span>
          {showTaxDrawer ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* ─── Expandable Tax Inputs Drawer ─── */}
      {showTaxDrawer && (
        <form className="wti-tax-drawer" onSubmit={handleApplyTaxInputs}>
          {requiredTaxInputs.includes('annualGrossIncome') && <div className="wti-tax-input-group">
            <label htmlFor="wti-annual-income">Annual Gross Income (₹)</label>
            <input
              id="wti-annual-income"
              type="number"
              min="0"
              max="1000000000"
              step="10000"
              className="wti-tax-input"
              placeholder="e.g. 1200000"
              value={taxAnnualIncome}
              onChange={(e) => setTaxAnnualIncome(e.target.value)}
              required
            />
          </div>}

          {requiredTaxInputs.includes('incomeSource') && <div className="wti-tax-input-group">
            <label htmlFor="wti-income-source">Income source</label>
            <select
              id="wti-income-source"
              className="wti-tax-input"
              value={taxIncomeSource}
              onChange={(e) => setTaxIncomeSource(e.target.value)}
              required
            >
              <option value="">Select income source</option>
              <option value="salary">Salary</option>
              <option value="pension">Pension</option>
              <option value="family_pension">Family pension</option>
              <option value="business">Business or profession</option>
              <option value="other">Other</option>
            </select>
          </div>}

          {requiredTaxInputs.includes('regime') && <div className="wti-tax-input-group">
            <label htmlFor="wti-tax-regime">Tax Regime</label>
            <select
              id="wti-tax-regime"
              className="wti-tax-input"
              value={taxRegime}
              onChange={(e) => setTaxRegime(e.target.value)}
              required
            >
              <option value="">Select regime</option>
              <option value="new">New Tax Regime</option>
              <option value="old">Old Tax Regime</option>
            </select>
          </div>}

          {requiredTaxInputs.includes('fiscalYear') && <div className="wti-tax-input-group">
            <label htmlFor="wti-fiscal-year">Fiscal Year</label>
            <select
              id="wti-fiscal-year"
              className="wti-tax-input"
              value={taxFiscalYear}
              onChange={(e) => setTaxFiscalYear(e.target.value)}
              required
            >
              <option value="">Select verified fiscal year</option>
              {(taxPolicyMetadata?.verifiedFiscalYears || []).map(year => (
                <option key={year} value={year}>{year.replace('FY', 'FY ')}</option>
              ))}
            </select>
          </div>}

          {requiredTaxInputs.includes('userAge') && (
            <div className="wti-tax-input-group">
              <label htmlFor="wti-user-age">Your age</label>
              <input
                id="wti-user-age"
                type="number"
                min="18"
                max="120"
                step="1"
                className="wti-tax-input"
                value={taxUserAge}
                onChange={(e) => setTaxUserAge(e.target.value)}
                required
              />
            </div>
          )}

          {requiredTaxInputs.includes('holdingPeriodMonths') && (
            <div className="wti-tax-input-group">
              <label htmlFor="wti-holding-period">Your holding period (months)</label>
              <input
                id="wti-holding-period"
                type="number"
                min="0"
                max="1200"
                step="1"
                className="wti-tax-input"
                value={holdingPeriodMonths}
                onChange={(e) => setHoldingPeriodMonths(e.target.value)}
                required
              />
            </div>
          )}

          {requiredTaxInputs.includes('section112AExemptionUsed') && (
            <div className="wti-tax-input-group">
              <label htmlFor="wti-112a-exemption">Section 112A exemption already used this year (₹)</label>
              <input
                id="wti-112a-exemption"
                type="number"
                min="0"
                max="125000"
                step="1000"
                className="wti-tax-input"
                value={section112AExemptionUsed}
                onChange={(e) => setSection112AExemptionUsed(e.target.value)}
                required
              />
              <small>Share the amount already used across your other qualifying equity gains; it is not reset for each product.</small>
            </div>
          )}

          {taxPolicyError && <p role="alert" className="wti-preview-error">{taxPolicyError}</p>}

          {requiredTaxInputs.length > 0
            ? <button type="submit" className="wti-apply-tax-btn">Apply & Calculate</button>
            : <p className="wti-preview-error">No tax inputs are required for the currently qualified product data.</p>}
        </form>
      )}

      <section className="wti-parent-recommendation" aria-labelledby="wti-parent-recommendation-title">
        <div className="wti-parent-recommendation-label">YOUR PLAN RECOMMENDS</div>
        <div className="wti-parent-recommendation-content">
          <div>
            <h3 id="wti-parent-recommendation-title">{inv?.name || 'Selected investment category'}</h3>
            <p>
              This category passed the backend Financial Profile suitability check. The verified options below are a deeper product view inside it.
            </p>
          </div>
          {Number.isFinite(Number(inv?.allocation_pct)) && (
            <div className="wti-parent-recommendation-allocation">
              <span>Plan allocation</span>
              <strong>{inv.allocation_pct}%</strong>
            </div>
          )}
        </div>
      </section>

      {/* ─── Section Header & Sorting ─── */}
      <div className="wti-section-header-row">
        <div>
          <h3 className="wti-section-title">Verified options inside this category</h3>
          <p className="wti-section-subtitle">
            {isEvidenceRanked
              ? 'Up to 5 source-verified Direct-plan options ranked using verified historical NAV evidence.'
              : isComparableSet
                ? 'Source-verified options in this suitable category. Display order is not a merit ranking.'
                : 'No source-qualified product facts are available for this category.'}{' '}
            <span className="wti-status-label">({headerLabel})</span>
          </p>
        </div>

        {/* Sorting Controls */}
        <div className="wti-sort-controls">
          <span className="wti-sort-label">Sort:</span>
          {[
            { id: 'score', label: isEvidenceRanked ? 'Historical Evidence' : 'Comparable Set' },
            { id: 'postTaxYield', label: activeTaxContext ? 'Post-Tax Calculated' : 'Post-Tax Needs Inputs' },
            { id: 'expense', label: 'Expense Ratio Unavailable' },
          ].map(mode => (
            <button
              key={mode.id}
              type="button"
              disabled={mode.id !== 'score'}
              title={mode.id === 'score'
                ? (isEvidenceRanked ? 'Server order among explicitly sourced Direct Growth options by one-year historical NAV return' : 'Stable display order only; not a ranking')
                : 'Unavailable without established provider-specific data'}
              onClick={() => mode.id === 'score' && setSortBy(mode.id)}
              className={`wti-sort-btn ${sortBy === mode.id ? 'wti-sort-btn--active' : ''}`}
            >
              {mode.label}
            </button>
          ))}
        </div>
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
            {(rankingResult.comparisonUniverse.provider === 'AMFI' || rankingResult.comparisonUniverse.sourceProvider === 'AMFI') && (
              <>Source-qualified: {rankingResult.comparisonUniverse.verifiedCategoryProductCount ?? 0}; fresh NAVs: {rankingResult.comparisonUniverse.freshNavProductCount ?? 0}; explicit Direct plans: {rankingResult.comparisonUniverse.sourceEstablishedDirectPlanProductCount ?? 0}; historical evidence: {rankingResult.comparisonUniverse.historicalEvidenceProductCount ?? 0}.</>
            )}
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
        <div role="status" className="wti-status-banner wti-status-banner--unavailable">
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <div><strong>UNAVAILABLE:</strong> No current source-qualified product comparison is available for this parent category. No fallback products or financial values were inserted.</div>
        </div>
      )}

      {/* Sub-Category Sector/Theme Drill-Down Tabs */}
      {subKeys.length > 0 && (
        <div className="wti-sub-pills">
          <span className="wti-sub-pills-label">Category context</span>
          {subKeys.map(key => (
            <span
              key={key}
              className="wti-sub-pill wti-sub-pill--context"
            >
              {SUB_TAB_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </span>
          ))}
        </div>
      )}

      {rankingError && (
        <div className="wti-status-banner wti-status-banner--error">
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2, color: '#ef4444' }} />
          <div>{rankingError}</div>
        </div>
      )}

      {/* Parent-Category Suitability Gauge */}
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

      {/* ─── Beginner Product Comparison Cards Grid ─── */}
      <div className="wti-grid">
        {products.map((product) => {
          const riskStyle = getRiskTierColor(product.beginnerSuitability?.riskTier);
          const postTax = product.postTaxAnalysis;
          const productObservedAt = formatMarketTimestamp(
            product.officialRate?.observedAt
              || product.nav?.observedAt
              || product.valuationDate
              || product.historicalReturn?.endDate,
          );

          return (
            <div
              key={product.id}
              className={`wti-item ${isEvidenceRanked && product.rank === 1 && rankingResult.ranking?.hasUniqueLeader ? 'wti-item--featured' : ''}`}
            >
              <div
                className="wti-rank"
                title={isEvidenceRanked ? `Evidence rank ${product.rank}` : 'Comparable option; display position is not a rank'}
              >
                {isEvidenceRanked ? product.rank : '='}
              </div>

              <div className="wti-card-body">
                {/* Card Top: Product Name, Chips, Metric */}
                <div className="wti-card-top">
                  <div>
                    <div className="wti-card-chips" style={{ marginTop: 0, marginBottom: 4 }}>
                      <h4 className="wti-name" style={{ margin: 0 }}>{product.name}</h4>
                      <span
                        className="wti-badge"
                        style={{
                          background: isEvidenceRanked ? 'rgba(34, 197, 94, 0.12)' : 'rgba(56, 189, 248, 0.08)',
                          color: isEvidenceRanked ? '#4ade80' : '#38bdf8',
                          borderColor: isEvidenceRanked ? 'rgba(34, 197, 94, 0.3)' : 'rgba(56, 189, 248, 0.25)',
                        }}
                      >
                        {product.presentationStatus?.replaceAll('_', ' ') || 'UNAVAILABLE'}
                      </span>
                      {product.tiedRank && <span className="wti-badge">TIED RANK</span>}
                    </div>

                    <span className="wti-provider">
                      {product.provider || 'Provider unavailable'} · {product.source?.provider || 'Source unavailable'}
                    </span>
                    <div className="wti-card-evidence-row">
                      <span>Source: {product.source?.provider || 'Unavailable'}</span>
                      <span>As of: {productObservedAt || 'Unavailable'}</span>
                    </div>

                    {/* Risk & Access Chips */}
                    <div className="wti-card-chips">
                      <span
                        className="wti-risk-chip"
                        style={{
                          color: riskStyle.color,
                          background: riskStyle.bg,
                          borderColor: riskStyle.border,
                        }}
                      >
                        {product.beginnerSuitability?.riskTier || 'Risk classification unavailable'}
                      </span>
                      <span className="wti-access-chip">
                        {product.beginnerSuitability?.accessToMoney || 'Access terms unavailable'}
                      </span>
                    </div>
                  </div>

                  {/* Fact Metric Display */}
                  <div className="wti-card-metric-col">
                    <span className="wti-card-metric-label">
                      {product.displayMetricLabel}
                    </span>
                    <div className="wti-rate-chip">{product.displayMetric}</div>
                  </div>
                </div>

                {/* Plain-English "Why This Fits You" */}
                {product.beginnerSuitability?.whyThisFitsYou && (
                  <div className="wti-why-fits">
                    <span className="wti-why-fits-label">
                      <Sparkles size={12} />
                      Why this fits you
                    </span>
                    <p className="wti-why-fits-text">{product.beginnerSuitability.whyThisFitsYou}</p>
                  </div>
                )}

                {/* Defensible Post-Tax Calculation & Illustrative Outcome Box */}
                {postTax && postTax.status === 'CALCULATED' && (
                  <div className="wti-post-tax-box">
                    <div className="wti-post-tax-header">
                      <span className="wti-post-tax-title">
                        {postTax.metricLabel}:{' '}
                        <strong>{Number.isFinite(postTax.postTaxRatePct) ? `${postTax.postTaxRatePct}%` : 'Unavailable'}</strong>
                      </span>
                      <span className="wti-badge" style={{ background: 'rgba(52, 211, 153, 0.1)', color: '#34d399', borderColor: 'rgba(52, 211, 153, 0.2)' }}>
                        Defensible Post-Tax
                      </span>
                    </div>

                    <div className="wti-illustrative-grid">
                      <div>
                        <span>You invest</span>
                        <strong>₹{postTax.illustrativePrincipal.toLocaleString('en-IN')}</strong>
                      </div>
                      <div>
                        <span>Gross return</span>
                        <strong>₹{Number.isFinite(postTax.grossGain) ? postTax.grossGain.toLocaleString('en-IN') : 'Unavailable'}</strong>
                      </div>
                      <div>
                        <span>Tax on gain</span>
                        <strong>₹{Number.isFinite(postTax.incrementalTax) ? postTax.incrementalTax.toLocaleString('en-IN') : 'Unavailable'}</strong>
                      </div>
                      <div className="wti-keep-highlight">
                        <span>You keep</span>
                        <strong>₹{Number.isFinite(postTax.netGain) ? postTax.netGain.toLocaleString('en-IN') : 'Unavailable'}</strong>
                      </div>
                    </div>

                    <div className="wti-post-tax-disclosure">
                      {postTax.disclosure}
                    </div>
                  </div>
                )}

                {/* If Post-Tax Requires Inputs */}
                {postTax && postTax.status === 'REQUIRES_TAX_INPUTS' && (
                  <div className="wti-post-tax-cta-box">
                    <span>After tax: Add tax details to calculate your return</span>
                    <button
                      type="button"
                      onClick={() => setShowTaxDrawer(true)}
                      className="wti-calc-tax-btn"
                    >
                      Calculate after tax
                    </button>
                  </div>
                )}

                {postTax && ['TAX_CLASSIFICATION_UNAVAILABLE', 'FISCAL_YEAR_UNSUPPORTED', 'PRODUCT_FACTS_UNAVAILABLE', 'UNAVAILABLE'].includes(postTax.status) && (
                  <div className="wti-post-tax-cta-box">
                    <span>After-tax result: {postTax.status.replaceAll('_', ' ').toLowerCase()}.</span>
                    {postTax.disclosure && <small>{postTax.disclosure}</small>}
                  </div>
                )}

                {/* Existing Highlights & Warnings */}
                <p className="wti-highlights">
                  {product.officialRate
                    ? product.officialRate.dataClass === 'OFFICIAL_RBI_FLOATING_COUPON_RATE' || product.parentInstrumentId === 'rbi_bonds'
                      ? `Current RBI Floating Rate Savings Bond coupon effective ${product.officialRate.effectiveFrom || 'UNAVAILABLE'}${product.officialRate.effectiveTo ? ` to ${product.officialRate.effectiveTo}` : ''}. Interest is paid semiannually and the coupon resets on January 1 and July 1; this is not a fixed 7-year guaranteed rate.`
                      : product.officialRate.dataClass === 'QUARTERLY_OFFICIAL_RATE'
                      ? `Official Government of India rate effective ${product.officialRate.effectiveFrom || 'UNAVAILABLE'} to ${product.officialRate.effectiveTo || 'UNAVAILABLE'}. This is an official interval fact, not a live market price or expected return.`
                      : `Official bank-published card rate effective from ${product.officialRate.effectiveFrom || 'UNAVAILABLE'} for ${product.tenure?.label || 'the source-established tenure'} and ${product.depositorType?.replaceAll('_', ' ') || 'the source-established depositor class'}. No best-FD claim is made.`
                    : isEvidenceRanked
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

                {/* Progressive Disclosure: Technical Details & Provenance */}
                <details className="wti-card-tech-details">
                  <summary className="wti-tech-summary">
                    <Info size={12} />
                    <span>View technical details & provenance</span>
                  </summary>

                  <div className="wti-meta-footer">
                    <div className="meta-box"><Building2 size={12} /> Source: {product.source?.provider || 'UNAVAILABLE'}</div>
                    {product.nav && <div className="meta-box"><Wallet size={12} /> NAV: {Number.isFinite(nullableMarketNumber(product.nav?.value)) ? `₹${nullableMarketNumber(product.nav.value).toLocaleString('en-IN')}` : 'UNAVAILABLE'}</div>}
                    {product.nav && <div className="meta-box"><HistoryIcon size={12} /> Valuation: {product.valuationDate || 'UNAVAILABLE'}</div>}
                    {product.officialRate && <div className="meta-box"><Wallet size={12} /> Rate class: {product.officialRate.dataClass?.replaceAll('_', ' ') || 'UNAVAILABLE'}</div>}
                    {product.officialRate && <div className="meta-box"><HistoryIcon size={12} /> Effective: {product.officialRate.effectiveFrom || 'UNAVAILABLE'} → {product.officialRate.effectiveTo || 'until revised'}</div>}
                    <div className="meta-box"><Activity size={12} /> Freshness: {product.freshness?.status || 'UNAVAILABLE'}</div>
                    <div className="meta-box">Eligibility: {product.productEligibility?.status?.replaceAll('_', ' ') || 'UNAVAILABLE'}</div>
                    {product.productType === 'MUTUAL_FUND' && <div className="meta-box">Plan: {product.plan || 'UNAVAILABLE'}</div>}
                    {product.productType === 'MUTUAL_FUND' && <div className="meta-box">Option: {product.option || 'UNAVAILABLE'}</div>}
                    {product.historicalReturn && <div className="meta-box"><HistoryIcon size={12} /> History: {product.historicalReturn.startDate} → {product.historicalReturn.endDate}</div>}
                    {isEvidenceRanked && product.rank === 1 && rankingResult.ranking?.hasUniqueLeader && (
                      <div className="meta-box meta-box--pick"><Star size={12} /> Rank #1 by 1Y Historical NAV Return</div>
                    )}
                  </div>
                </details>
              </div>
            </div>
          );
        })}
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
