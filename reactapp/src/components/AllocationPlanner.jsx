import React, { useEffect, useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  ArrowUpRight,
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  Clock3,
  FileSearch,
  Info,
  Landmark,
  LoaderCircle,
  Layers,
  PieChart as PieChartIcon,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
  RefreshCw,
} from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Tooltip from '@radix-ui/react-tooltip';
import { toast } from 'sonner';
import { RISK_COLORS } from '../investmentDatabase';
import * as api from '../services/api';
import ResearchStatusCard from './agent/ResearchStatusCard';
import './AllocationPlanner.css';

const SLICE_GRADIENTS = [
  { id: 'grad-sky', primary: '#38bdf8', stop1: '#0ea5e9', stop2: '#38bdf8', glow: 'rgba(56, 189, 248, 0.35)' },
  { id: 'grad-emerald', primary: '#34d399', stop1: '#059669', stop2: '#34d399', glow: 'rgba(52, 211, 153, 0.35)' },
  { id: 'grad-purple', primary: '#c084fc', stop1: '#7c3aed', stop2: '#c084fc', glow: 'rgba(192, 132, 252, 0.35)' },
  { id: 'grad-amber', primary: '#fbbf24', stop1: '#d97706', stop2: '#fbbf24', glow: 'rgba(251, 191, 36, 0.35)' },
  { id: 'grad-pink', primary: '#f472b6', stop1: '#db2777', stop2: '#f472b6', glow: 'rgba(244, 114, 182, 0.35)' },
  { id: 'grad-cyan', primary: '#22d3ee', stop1: '#0891b2', stop2: '#22d3ee', glow: 'rgba(34, 211, 238, 0.35)' },
];

const RISK_PRESETS = [
  { id: 'Safe & Stable', label: 'Safe & Stable' },
  { id: 'Balanced Growth', label: 'Balanced Growth' },
  { id: 'Aggressive Growth', label: 'Aggressive Growth' },
];

const CATEGORY_EXPLANATIONS = {
  Equity: 'Company Shares — High growth potential over time',
  Debt: 'Fixed Income & FD — Steady, reliable interest income',
  Government: 'Government savings category — rules and access vary by instrument',
  'Equity-Debt': 'Hybrid Funds — Balanced safety and growth',
  Commodity: 'Gold & Metals — Protects against inflation',
  Alternative: 'Alternative Assets — Extra portfolio diversification',
  Gold: 'Gold & Metals — Protects against inflation',
};

const getCategoryIcon = (category) => {
  const value = String(category || '');
  if (value.includes('Equity') || value.includes('MF') || value.includes('ETF')) return <TrendingUp size={19} aria-hidden="true" />;
  if (value.includes('Debt') || value.includes('Govt') || value.includes('Bond') || value.includes('NPS')) return <Landmark size={19} aria-hidden="true" />;
  if (value.includes('Gold') || value.includes('Commodity')) return <Briefcase size={19} aria-hidden="true" />;
  return <Wallet size={19} aria-hidden="true" />;
};

const formatCurrency = (value) => `₹${Number(value).toLocaleString('en-IN')}`;

const normalizeRationaleForDisplay = (text) => text
  .replace(/\s*\[[A-Z0-9_:-]+\]/g, '')
  .replace(/\s{2,}/g, ' ')
  .trim();

const PlanState = ({ kind, title, message }) => (
  <div className={`ap-state ap-state-${kind}`} role="status" aria-live="polite">
    <div className="ap-state-icon" aria-hidden="true">
      {kind === 'loading' ? <Sparkles size={22} /> : <PieChartIcon size={22} />}
    </div>
    <span className="ap-eyebrow">YOUR PLAN</span>
    <h1>{title}</h1>
    <p>{message}</p>
  </div>
);

const PlanTerm = ({ term, explanation }) => (
  <span className="ap-term">
    <span>{term}</span>
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button type="button" className="ap-tooltip-trigger" aria-label={`More information about ${term}`}>
          <Info size={13} aria-hidden="true" />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="ap-tooltip-content" side="top" sideOffset={7}>
          {explanation}
          <Tooltip.Arrow className="ap-tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </span>
);

const AllocationChartTooltip = ({ active, payload }) => {
  if (!active || !payload?.[0]?.payload) return null;
  const item = payload[0].payload;
  return (
    <div className="ap-chart-tooltip" role="status">
      <strong>{item.name}</strong>
      <span>{item.allocationPct.toFixed(1)}% · {formatCurrency(item.monthlyAmount)}/month</span>
    </div>
  );
};

const PLAN_REVIEW_STAGES = [
  'Checking your profile',
  'Checking recommendation freshness',
  'Collecting plan evidence',
  'Preparing a grounded review',
];

const PlanReviewPanel = ({ profileId, onRecomputePlan }) => {
  const prefersReducedMotion = useReducedMotion();
  const [status, setStatus] = useState('idle');
  const [run, setRun] = useState(null);
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  useEffect(() => {
    if (!profileId) return undefined;
    let cancelled = false;
    api.getCurrentPlanReviewRun(profileId, { timeoutMs: 1500 }).then(current => {
      if (cancelled || !current) return;
      setRun(current);
      if (current.result) setReview(current.result);
      if (current.status === 'COMPLETED' || current.status === 'WAITING_FOR_APPROVAL') setStatus('completed');
      else if (['QUEUED', 'RUNNING'].includes(current.status)) setStatus('running');
      else if (['FAILED', 'CANCELLED', 'BUDGET_EXCEEDED'].includes(current.status)) {
        setStatus('error');
        setError(current.status === 'CANCELLED'
          ? 'This plan review was cancelled.'
          : current.failure?.message || 'The plan review did not complete.');
      }
    }).catch(() => {
      // A missing run is the normal initial state; it is not a panel error.
    });
    return () => { cancelled = true; };
  }, [profileId]);

  useEffect(() => {
    if (!run?.runId || status !== 'running') return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const current = await api.getPlanReviewRun(run.runId);
        if (cancelled) return;
        setRun(current);
        if (current.result) setReview(current.result);
        if (current.status === 'COMPLETED' || current.status === 'WAITING_FOR_APPROVAL') {
          setStatus('completed');
          toast.success('Plan review ready', { description: 'No plan changes were made.' });
        } else if (['FAILED', 'CANCELLED', 'BUDGET_EXCEEDED'].includes(current.status)) {
          setStatus('error');
          setError(current.failure?.message || 'The plan review did not complete.');
        }
      } catch (err) {
        if (!cancelled && err?.status && err.status >= 400 && err.status < 500) {
          setStatus('error');
          setError(err.message || 'Plan review is unavailable.');
        }
      }
    };
    void poll();
    const timer = window.setInterval(poll, 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [run?.runId, status]);

  const runReview = async () => {
    if (!profileId || status === 'running') return;
    setStatus('running');
    setRun(null);
    setReview(null);
    setError(null);
    try {
      const queued = await api.runPlanReview(profileId);
      setRun(queued);
      if (queued.result) setReview(queued.result);
      if (queued.status === 'COMPLETED' || queued.status === 'WAITING_FOR_APPROVAL' || queued.summary) {
        setReview(queued.result || queued);
        setStatus('completed');
        toast.success('Plan review ready', { description: 'No plan changes were made.' });
      }
    } catch (err) {
      setStatus('error');
      setError(err?.message || 'Plan review is temporarily unavailable.');
      toast.error('Plan review unavailable', { description: err?.message || 'Try again later.' });
    }
  };

  const evidenceEntries = review?.evidence?.entries || [];
  const actionNeedsRecompute = review?.recommendedAction === 'RECOMPUTE_PLAN';
  const progressPercent = run?.progress?.percent ?? 0;
  const progressLabel = run?.progress?.label || PLAN_REVIEW_STAGES[0];

  return (
    <motion.section
      className="ap-section ap-review-section"
      aria-labelledby="plan-review-title"
      initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="ap-review-orbit" aria-hidden="true" />
      <div className="ap-section-heading ap-review-heading">
        <div>
          <span className="ap-eyebrow"><Sparkles size={12} aria-hidden="true" /> PLAN HEALTH</span>
          <h2 id="plan-review-title">Review my plan</h2>
        </div>
        <span className="ap-section-note">Read-only · evidence-grounded</span>
      </div>
      <div className="ap-review-body">
        <div className="ap-review-copy">
          <div className="ap-review-icon" aria-hidden="true"><FileSearch size={21} /></div>
          <div>
            <h3>Is your saved plan still aligned?</h3>
            <p>The review checks your current profile, recommendation freshness, goals, and available evidence. It cannot change allocations or save a new plan.</p>
          </div>
        </div>
        {status === 'idle' && (
          <button type="button" className="ap-review-primary" onClick={runReview} disabled={!profileId}>
            <Sparkles size={17} aria-hidden="true" />
            {profileId ? 'Run plan review' : 'Profile required'}
          </button>
        )}
        {status === 'running' && (
          <div className="ap-review-progress" role="status" aria-live="polite">
            <div className="ap-review-progress-label"><LoaderCircle className="ap-spin" size={17} aria-hidden="true" /><span>{progressLabel}…</span><strong>{progressPercent}%</strong></div>
            <div className="ap-review-progress-track"><span style={{ width: `${progressPercent}%` }} /></div>
          </div>
        )}
        {status === 'error' && (
          <div className="ap-review-result ap-review-error" role="alert">
            <AlertTriangle size={17} aria-hidden="true" />
            <span>{error}</span>
            <button type="button" className="ap-review-link-button" onClick={runReview}>Try again</button>
          </div>
        )}
        {status === 'completed' && review && (
          <div className="ap-review-result">
            <div className="ap-review-result-head">
              <div className="ap-review-ready"><CheckCircle2 size={17} aria-hidden="true" /><span>Review complete</span></div>
              <span className={`ap-review-action ap-review-action-${review.recommendedAction.toLowerCase()}`}>{review.recommendedAction.replaceAll('_', ' ')}</span>
            </div>
            <p className="ap-review-summary">{review.summary}</p>
            <div className="ap-review-findings">
              {(review.findings || []).slice(0, 3).map(finding => (
                <div className={`ap-review-finding ap-review-finding-${finding.severity.toLowerCase()}`} key={finding.code}>
                  <span>{finding.title}</span><small>{finding.detail}</small>
                </div>
              ))}
            </div>
            <ResearchStatusCard evidenceEntries={evidenceEntries} />
            <div className="ap-review-actions">
              <Dialog.Root open={evidenceOpen} onOpenChange={setEvidenceOpen}>
                <Dialog.Trigger asChild>
                  <button type="button" className="ap-review-secondary"><FileSearch size={16} aria-hidden="true" /> View evidence</button>
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="ap-dialog-overlay" />
                  <Dialog.Content className="ap-dialog-content ap-evidence-dialog">
                    <div className="ap-dialog-kicker">AUDITABLE CONTEXT</div>
                    <Dialog.Title className="ap-dialog-title">Evidence used for this review</Dialog.Title>
                    <Dialog.Description className="ap-dialog-description">These are read-only facts and metadata returned by the backend. The agent cannot edit your profile or recommendation.</Dialog.Description>
                    <div className="ap-evidence-list">
                      {evidenceEntries.length === 0 ? <p className="ap-evidence-empty">No verified evidence is available for this run.</p> : evidenceEntries.map(entry => (
                        <article className="ap-evidence-item" key={entry.id}>
                          <div className="ap-evidence-item-top"><strong>{entry.id}</strong><span>{entry.dataClass || 'Backend evidence'}</span></div>
                          <p>{entry.displayValue || String(entry.value ?? 'Unavailable')}</p>
                          <small>{entry.source?.provider || entry.authority || 'WealthGenie backend'}{entry.observedAt ? ` · Observed ${new Date(entry.observedAt).toLocaleDateString('en-IN')}` : ''}</small>
                        </article>
                      ))}
                    </div>
                    <Dialog.Close asChild><button type="button" className="ap-dialog-close">Close</button></Dialog.Close>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
              {actionNeedsRecompute && typeof onRecomputePlan === 'function' && (
                <button type="button" className="ap-review-primary ap-review-recompute" onClick={onRecomputePlan}><RefreshCw size={16} aria-hidden="true" /> Recompute plan</button>
              )}
              <button type="button" className="ap-review-icon-button" onClick={runReview} aria-label="Run plan review again"><RefreshCw size={16} aria-hidden="true" /></button>
            </div>
          </div>
        )}
      </div>
    </motion.section>
  );
};

const AllocationPlanner = ({ profile, recommendations = [], recommendationMeta, onRecomputePlan }) => {
  const prefersReducedMotion = useReducedMotion();
  const [hoveredSlice, setHoveredSlice] = useState(null);
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const savings = Number(profile?.monthly_savings);

  const riskView = (
    profile?.risk_tolerance === 'Aggressive' ? 'Aggressive Growth' :
      profile?.risk_tolerance === 'Conservative' ? 'Safe & Stable' : 'Balanced Growth'
  );

  // Only convert backend-authoritative weights into chart presentation fields.
  // Keep the incoming recommendation order and values unchanged.
  const allocation = useMemo(() => recommendations
    .filter(item => Number(item.monthly_allocation) > 0)
    .map((item, idx) => {
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
    }), [recommendations]);

  const blendedReturn = Number(recommendationMeta?.portfolio_return_assumption);
  const equityExposure = useMemo(() => allocation
    .filter(item => item.cat === 'Equity')
    .reduce((sum, item) => sum + item.allocationPct, 0), [allocation]);
  const debtGovtExposure = useMemo(() => allocation
    .filter(item => item.cat === 'Government' || item.cat === 'Debt' || item.cat === 'Equity-Debt')
    .reduce((sum, item) => sum + item.allocationPct, 0), [allocation]);
  const altExposure = useMemo(() => allocation
    .filter(item => item.cat === 'Commodity' || item.cat === 'Alternative' || item.cat === 'Gold')
    .reduce((sum, item) => sum + item.allocationPct, 0), [allocation]);

  const rationaleText = recommendationMeta?.advisory_text
    || (['PENDING', 'GENERATING'].includes(recommendationMeta?.advisory_explanation?.status)
      ? 'Generating grounded explanation…'
      : 'The recommendation service did not return an advisory explanation.');
  const rationaleBullets = useMemo(() => normalizeRationaleForDisplay(rationaleText)
    .split(/\n+|(?<=[.!?])\s+/)
    .map(item => item.trim())
    .filter(Boolean), [rationaleText]);
  const assetClassCount = new Set(allocation.map(item => item.cat)).size;
  const riskLabel = recommendationMeta?.final_risk_tier || profile?.risk_tolerance || 'Unavailable';
  const horizonYears = Number(profile?.investment_horizon_years);
  const goals = Array.isArray(profile?.investment_goals) ? profile.investment_goals.filter(Boolean) : [];
  const isLoading = recommendationMeta?.loading === true || recommendationMeta?.status === 'LOADING';
  const hasError = Boolean(recommendationMeta?.error || recommendationMeta?.status === 'ERROR');
  const methodologyRows = [
    ['Allocation source', recommendationMeta?.current_allocation_source || 'Backend recommendation'],
    ['Return basis', recommendationMeta?.return_basis || 'Model assumption'],
    ['Assumption version', recommendationMeta?.return_assumption_version || 'Unavailable'],
    ['Policy lineage', recommendationMeta?.policy_lineage || 'Unavailable'],
  ];

  if (isLoading) {
    return (
      <Tooltip.Provider delayDuration={220} skipDelayDuration={120}>
        <motion.div className="ap-page ap-state-page" initial={prefersReducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }}>
          <PlanState kind="loading" title="Preparing your plan" message="Your profile is being matched with the recommendation engine." />
        </motion.div>
      </Tooltip.Provider>
    );
  }

  if (hasError) {
    return (
      <Tooltip.Provider delayDuration={220} skipDelayDuration={120}>
        <motion.div className="ap-page ap-state-page" initial={prefersReducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }}>
          <PlanState kind="error" title="We couldn't load your plan" message="The recommendation service did not return a usable plan. Your saved profile is unchanged; please try again from the profile screen." />
        </motion.div>
      </Tooltip.Provider>
    );
  }

  if (!Number.isFinite(savings) || savings <= 0 || allocation.length === 0) {
    return (
      <Tooltip.Provider delayDuration={220} skipDelayDuration={120}>
        <motion.div className="ap-page ap-state-page" initial={prefersReducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }}>
          <PlanState kind="empty" title="No allocation available" message="Complete or update your financial profile to unlock personalized investment options." />
        </motion.div>
      </Tooltip.Provider>
    );
  }

  return (
    <Tooltip.Provider delayDuration={220} skipDelayDuration={120}>
      <div className="ap-page">
        <motion.header
          className="ap-hero"
          initial={prefersReducedMotion ? false : { opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
        >
          <div className="ap-page-badge"><Sparkles size={13} aria-hidden="true" /><span>PERSONALISED PLAN</span></div>
          <div className="ap-hero-row">
            <div>
              <p className="ap-eyebrow">MY PLAN</p>
              <h1 className="ap-page-title">Where to <span className="title-gradient">invest your money</span></h1>
              <p className="ap-page-subtitle">
                A clear monthly plan for your <strong>{formatCurrency(savings)}</strong> savings, shaped around your profile.
              </p>
            </div>
            <div className="ap-plan-status" aria-label={`Current plan strategy: ${riskView}`}>
              <CheckCircle2 size={16} aria-hidden="true" />
              <span>{riskView}</span>
            </div>
          </div>
          <div className="ap-summary-metrics" aria-label="Plan summary">
            <div className="ap-summary-metric ap-summary-metric-primary">
              <span className="ap-metric-label">Monthly investment</span>
              <strong>{formatCurrency(savings)}</strong>
              <span className="ap-metric-help">Your current monthly savings</span>
            </div>
            <div className="ap-summary-metric"><span className="ap-metric-label">Investments</span><strong>{allocation.length}</strong><span className="ap-metric-help">Across your plan</span></div>
            <div className="ap-summary-metric"><span className="ap-metric-label">Strategy</span><strong>{riskView}</strong><span className="ap-metric-help">Based on your profile</span></div>
            <div className="ap-summary-metric"><span className="ap-metric-label">Risk profile</span><strong>{riskLabel}</strong><span className="ap-metric-help">Suitability context</span></div>
          </div>
          <div className="ap-context-strip" aria-label="Plan context">
            <div className="ap-context-item"><Clock3 size={16} aria-hidden="true" /><span>Investment horizon</span><strong>{Number.isFinite(horizonYears) && horizonYears > 0 ? `${horizonYears} years` : 'Not provided'}</strong></div>
            <div className="ap-context-item"><Target size={16} aria-hidden="true" /><span>Goals in profile</span><strong>{goals.length > 0 ? goals.join(' · ') : 'Not provided'}</strong></div>
          </div>
        </motion.header>

        <PlanReviewPanel
          key={profile?.profileId || recommendationMeta?.profileId || 'no-profile'}
          profileId={profile?.profileId || recommendationMeta?.profileId}
          onRecomputePlan={onRecomputePlan}
        />

        <section className="ap-section ap-overview-section" aria-labelledby="portfolio-overview-title">
          <div className="ap-section-heading">
            <div><span className="ap-eyebrow">AT A GLANCE</span><h2 id="portfolio-overview-title">Portfolio overview</h2></div>
            <span className="ap-section-note">{assetClassCount} asset {assetClassCount === 1 ? 'class' : 'classes'}</span>
          </div>
          <div className="ap-overview-grid">
            <div className="ap-chart-panel">
              <div className="ap-chart-heading"><div><Layers size={16} aria-hidden="true" /><span>Allocation mix</span></div><span className="ap-muted-label">Monthly plan</span></div>
              <div className="ap-chart-wrap" role="region" aria-label="Investment allocation breakdown donut chart" aria-describedby="allocation-chart-description">
                <p id="allocation-chart-description" className="ap-sr-only">The chart shows the percentage and monthly amount assigned to each investment in the same order as the recommendation.</p>
                <div className="ap-donut-aura" aria-hidden="true" />
                <ResponsiveContainer width="100%" height={350} initialDimension={{ width: 1, height: 1 }}>
                  <PieChart>
                    <defs>
                      {SLICE_GRADIENTS.map(gradient => (
                        <linearGradient key={gradient.id} id={gradient.id} x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0%" stopColor={gradient.stop1} />
                          <stop offset="100%" stopColor={gradient.stop2} />
                        </linearGradient>
                      ))}
                    </defs>
                    <Pie
                      data={allocation}
                      dataKey="allocationPct"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={104}
                      outerRadius={148}
                      paddingAngle={4}
                      cornerRadius={7}
                      stroke="#0b1220"
                      strokeWidth={3}
                      isAnimationActive={!prefersReducedMotion}
                      onMouseEnter={(_, index) => setHoveredSlice(allocation[index])}
                      onMouseLeave={() => setHoveredSlice(null)}
                    >
                      {allocation.map(item => (
                        <Cell
                          key={item.id}
                          fill={`url(#${item.gradId})`}
                          style={{
                            filter: `drop-shadow(0 5px 12px ${item.glowColor})`,
                            cursor: 'pointer',
                            transform: hoveredSlice?.id === item.id ? 'scale(1.035)' : 'scale(1)',
                            transformOrigin: 'center center',
                            transition: 'transform 180ms ease, filter 180ms ease',
                          }}
                        />
                      ))}
                    </Pie>
                    <RechartsTooltip content={<AllocationChartTooltip />} cursor={false} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="ap-donut-center" aria-hidden={Boolean(hoveredSlice)}>
                  <AnimatePresence mode="wait">
                    {hoveredSlice ? (
                      <motion.div key="hovered" className="ap-center-content" initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                        <span className="ap-center-kicker">{hoveredSlice.cat || 'Asset'}</span>
                        <strong>{hoveredSlice.allocationPct.toFixed(1)}%</strong>
                        <span>{formatCurrency(hoveredSlice.monthlyAmount)}/month</span>
                      </motion.div>
                    ) : (
                      <motion.div key="default" className="ap-center-content" initial={prefersReducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <span className="ap-center-kicker">TOTAL INVESTMENT</span>
                        <strong>{formatCurrency(savings)}</strong>
                        <span>PER MONTH</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              <div className="ap-legend-grid" aria-label="Allocation legend">
                {allocation.map(item => {
                  const isActive = hoveredSlice?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`ap-legend-item ${isActive ? 'active' : ''}`}
                      style={{ '--legend-color': item.themeColor }}
                      aria-pressed={isActive}
                      onMouseEnter={() => setHoveredSlice(item)}
                      onMouseLeave={() => setHoveredSlice(null)}
                      onFocus={() => setHoveredSlice(item)}
                      onBlur={() => setHoveredSlice(null)}
                    >
                      <span className="ap-legend-dot" aria-hidden="true" />
                      <span className="ap-legend-name">{item.abbr || item.name}</span>
                      <strong>{item.allocationPct.toFixed(1)}%</strong>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="ap-overview-stats">
              <div className="ap-stat-lead"><span className="ap-eyebrow">YOUR MONTHLY MIX</span><strong>{formatCurrency(savings)}</strong><span>allocated across {allocation.length} investment{allocation.length === 1 ? '' : 's'}</span></div>
              <div className="ap-stat-list">
                <div><span>Equity</span><strong>{equityExposure.toFixed(1)}%</strong></div>
                <div><span>Debt & government</span><strong>{debtGovtExposure.toFixed(1)}%</strong></div>
                {altExposure > 0 && <div><span>Gold & alternatives</span><strong>{altExposure.toFixed(1)}%</strong></div>}
              </div>
              <div className="ap-overview-note"><ShieldCheck size={16} aria-hidden="true" /><span>Your allocation is presented in the recommendation order returned for your profile.</span></div>
            </div>
          </div>
        </section>

        <section className="ap-section" aria-labelledby="investment-plan-title">
          <div className="ap-section-heading"><div><span className="ap-eyebrow">DETAILS</span><h2 id="investment-plan-title">Your investment plan</h2></div><span className="ap-section-note">Monthly contributions</span></div>
          <div className="ap-plan-grid">
            {allocation.map((item, index) => {
              const isActive = hoveredSlice?.id === item.id;
              const itemRiskColor = RISK_COLORS[item.riskLabel] || '#fbbf24';
              return (
                <motion.article
                  key={item.id}
                  className={`ap-plan-card ${isActive ? 'active-card' : ''}`}
                  style={{ '--card-accent': item.themeColor, '--card-glow': item.glowColor }}
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: prefersReducedMotion ? 0 : 0.08 + index * 0.05 }}
                  onMouseEnter={() => setHoveredSlice(item)}
                  onMouseLeave={() => setHoveredSlice(null)}
                >
                  <div className="ap-plan-card-head"><div className="ap-plan-card-identity"><span className="ap-plan-icon">{getCategoryIcon(item.cat || item.name)}</span><div><h3>{item.name}</h3><span>{item.type || item.cat || item.category || 'Investment'}</span></div></div><strong className="ap-plan-percent">{item.allocationPct.toFixed(1)}%</strong></div>
                  <div className="ap-plan-card-category">{CATEGORY_EXPLANATIONS[item.cat] || CATEGORY_EXPLANATIONS[item.name] || item.cat || ''}</div>
                  <div className="ap-progress-track" role="progressbar" aria-label={`${item.name}: ${item.allocationPct.toFixed(1)} percent allocation`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={item.allocationPct}><span style={{ width: `${Math.max(0, Math.min(100, item.allocationPct))}%` }} /></div>
                  <div className="ap-plan-card-metrics">
                    <div><span>Monthly</span><strong>{formatCurrency(item.monthlyAmount)}</strong></div>
                    <div><PlanTerm term="Model return assumption" explanation="A versioned model input for planning. It is not a live rate, provider forecast, or guarantee." /><strong>{item.nominalRate}%/yr</strong></div>
                    <div><PlanTerm term="Risk" explanation="The risk classification supplied with this recommendation. It is shown as context, not a promise about future performance." /><strong className="ap-risk-value" style={{ color: itemRiskColor }}>{item.riskLabel}</strong></div>
                  </div>
                  {item.concentrationBadge && <div className="ap-concentration"><Info size={14} aria-hidden="true" />{item.concentrationBadge}</div>}
                </motion.article>
              );
            })}
          </div>
        </section>

        <section className="ap-section ap-rationale-section" aria-labelledby="plan-fit-title">
          <div className="ap-section-heading"><div><span className="ap-eyebrow">THE WHY</span><h2 id="plan-fit-title">Why this plan fits</h2></div><Dialog.Root open={methodologyOpen} onOpenChange={setMethodologyOpen}><Dialog.Trigger asChild><button type="button" className="ap-text-button">View methodology <ArrowUpRight size={15} aria-hidden="true" /></button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="ap-dialog-overlay" /><Dialog.Content className="ap-dialog-content"><div className="ap-dialog-kicker">PLAN CONTEXT</div><Dialog.Title className="ap-dialog-title">How this plan is built</Dialog.Title><Dialog.Description className="ap-dialog-description">These are the existing recommendation inputs made visible for clarity. They do not change the recommendation or calculate a new result.</Dialog.Description><dl className="ap-methodology-list">{methodologyRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><div className="ap-dialog-advisory"><span>Technical advisory detail</span><p>{rationaleText}</p></div><Dialog.Close asChild><button type="button" className="ap-dialog-close">Close</button></Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root></div>
          <div className="ap-rationale-box"><div className="ap-rationale-mark"><ShieldCheck size={18} aria-hidden="true" /></div><div><div className="ap-rationale-heading">Built around your profile</div><ul className="ap-rationale-list">{rationaleBullets.map((bullet, index) => <li key={`${bullet}-${index}`}>{bullet}</li>)}</ul></div></div>
        </section>

        <section className="ap-section ap-assumptions-section" aria-labelledby="plan-assumptions-title">
          <div className="ap-section-heading"><div><span className="ap-eyebrow">TRANSPARENCY</span><h2 id="plan-assumptions-title">Plan assumptions</h2></div><span className="ap-section-note">For context, not a promise</span></div>
          <div className="ap-assumptions-grid">
            <div className="ap-assumption-main"><div className="ap-assumption-label"><PlanTerm term="Portfolio model return assumption" explanation="A backend-weighted, pre-tax nominal model input used for planning. It is not a provider forecast or guaranteed outcome." /></div><strong>{Number.isFinite(blendedReturn) ? `${blendedReturn.toFixed(1)}%` : 'Unavailable'} <small>per year</small></strong><p>Backend-weighted, pre-tax nominal model assumption. Tax is calculated separately with explicit tax inputs.</p></div>
            <div className="ap-assumption-facts"><div><span>Allocation model</span><strong>Profile-based</strong></div><div><span>Risk context</span><strong>{riskLabel}</strong></div><div><span>Equity / debt / other</span><strong>{equityExposure.toFixed(1)}% / {debtGovtExposure.toFixed(1)}% / {altExposure.toFixed(1)}%</strong></div></div>
          </div>
        </section>
      </div>
    </Tooltip.Provider>
  );
};

export default AllocationPlanner;
