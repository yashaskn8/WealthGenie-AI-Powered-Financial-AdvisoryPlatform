import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Share, X, TrendingUp, Users, Target, ChevronRight, Info, ArrowUpRight, AlertTriangle, Shield, Activity, Sparkles, PieChart, Zap } from 'lucide-react';
import './HealthScoreScreen.css';
import * as api from './services/api';

/* ── Animated Counter Hook ────────────────────────────────── */
function useAnimatedCounter(target, duration = 2000) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let start;
    let frame;
    const step = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      setCount(Math.round((1 - Math.pow(1 - p, 3)) * target));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return count;
}

/* ── FIX 5: Export Scorecard ─────────────────────────────────── */
import { jsPDF } from 'jspdf';

function exportHealthScorecard(score, metrics, profile, healthData) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pw = doc.internal.pageSize.getWidth();  // 210
  const ph = doc.internal.pageSize.getHeight(); // 297
  const L = 16;           // left margin
  const R = pw - 16;      // right edge
  const W = R - L;        // content width

  // ── Color helpers ──
  const setTxt = (r, g, b) => doc.setTextColor(r, g, b);
  const setFill = (r, g, b) => doc.setFillColor(r, g, b);
  const setDraw = (r, g, b) => doc.setDrawColor(r, g, b);
  const scoreColor = (v) => v >= 70 ? [34,197,94] : v >= 40 ? [245,158,11] : [239,68,68];
  const fitLabel = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Needs Work' : 'Critical';

  // ═══════════════════════════════════════════════
  //  HEADER — dark band (70mm tall so ring fits)
  // ═══════════════════════════════════════════════
  const headerH = 70;
  setFill(2, 6, 23);
  doc.rect(0, 0, pw, headerH, 'F');

  // Teal accent bar at bottom of header
  setFill(14, 165, 233);
  doc.rect(0, headerH, pw, 1, 'F');

  // Brand name
  doc.setFont(undefined, 'bold');
  doc.setFontSize(18);
  setTxt(56, 189, 248);
  doc.text('WealthGenie', L, 16);

  doc.setFontSize(18);
  setTxt(226, 232, 240);
  const brandW = doc.getTextWidth('WealthGenie');
  doc.text('  Health Scorecard', L + brandW, 16);

  // Investor info line
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  setTxt(148, 163, 184);
  const incomeStr = Number(profile.monthly_take_home).toLocaleString('en-IN');
  const savingsStr = Number(profile.monthly_savings).toLocaleString('en-IN');
  doc.text(`Age ${profile.age}  ·  Income ₹${incomeStr}/mo  ·  Savings ₹${savingsStr}/mo`, L, 24);

  // Date line
  doc.setFontSize(8);
  setTxt(100, 116, 139);
  const now = new Date();
  doc.text(`Report generated ${now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} at ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`, L, 30);

  // ── Score Ring (centered in right half) ──
  const ringX = pw - 42;
  const ringY = 38;
  const ringR = 18;
  const [sR, sG, sB] = scoreColor(score);

  // Outer ring — dark bg ring
  setDraw(30, 41, 59);
  doc.setLineWidth(3);
  doc.circle(ringX, ringY, ringR, 'S');

  // Colored ring on top
  setDraw(sR, sG, sB);
  doc.setLineWidth(3);
  doc.circle(ringX, ringY, ringR, 'S');

  // Score text
  doc.setFont(undefined, 'bold');
  doc.setFontSize(28);
  setTxt(sR, sG, sB);
  doc.text(`${score}`, ringX, ringY + 2, { align: 'center' });

  // "out of 100" below score
  doc.setFont(undefined, 'normal');
  doc.setFontSize(7);
  setTxt(148, 163, 184);
  doc.text('out of 100', ringX, ringY + 8, { align: 'center' });

  // Fitness label below ring
  doc.setFont(undefined, 'bold');
  doc.setFontSize(9);
  setTxt(sR, sG, sB);
  doc.text(fitLabel, ringX, ringY + 15, { align: 'center' });

  // ═══════════════════════════════════════════════
  //  STATS ROW — 3 cards
  // ═══════════════════════════════════════════════
  let y = headerH + 8;
  const savingsRate = Number(healthData?.savings_rate_pct);
  const horizon = Number(profile.investment_horizon_years);

  const cardGap = 4;
  const cardW = (W - cardGap * 2) / 3;
  const cardH = 18;
  const cards = [
    { title: 'SAVINGS RATE', val: Number.isFinite(savingsRate) ? `${savingsRate}%` : 'N/A', c: [34,197,94] },
    { title: 'RISK CATEGORY', val: profile.risk_tolerance, c: [245,158,11] },
    { title: 'HORIZON', val: `${horizon} ${horizon === 1 ? 'Year' : 'Years'}`, c: [139,92,246] },
  ];

  cards.forEach((card, i) => {
    const cx = L + i * (cardW + cardGap);

    // Card bg
    setFill(245, 248, 255);
    doc.roundedRect(cx, y, cardW, cardH, 2, 2, 'F');

    // Card border
    setDraw(220, 225, 235);
    doc.setLineWidth(0.3);
    doc.roundedRect(cx, y, cardW, cardH, 2, 2, 'S');

    // Title
    doc.setFont(undefined, 'bold');
    doc.setFontSize(6.5);
    setTxt(120, 130, 150);
    doc.text(card.title, cx + cardW / 2, y + 7, { align: 'center' });

    // Value
    doc.setFont(undefined, 'bold');
    doc.setFontSize(13);
    setTxt(...card.c);
    doc.text(card.val, cx + cardW / 2, y + 15, { align: 'center' });
  });

  y += cardH + 10;

  // ═══════════════════════════════════════════════
  //  METRIC BREAKDOWN — table-style
  // ═══════════════════════════════════════════════

  // Section header bar
  setFill(238, 242, 250);
  doc.roundedRect(L, y, W, 8, 1.5, 1.5, 'F');
  doc.setFont(undefined, 'bold');
  doc.setFontSize(8);
  setTxt(30, 41, 59);
  doc.text('METRIC BREAKDOWN', L + 5, y + 5.5);

  // Column headers
  y += 12;
  doc.setFont(undefined, 'bold');
  doc.setFontSize(7);
  setTxt(120, 130, 150);
  doc.text('Metric', L + 3, y);
  doc.text('Progress', L + 78, y);
  doc.text('Score', R - 5, y, { align: 'right' });

  // Thin line under headers
  y += 2;
  setDraw(220, 225, 235);
  doc.setLineWidth(0.3);
  doc.line(L, y, R, y);
  y += 3;

  // ── Metric rows ──
  const barStartX = L + 78;
  const barW = 70;
  const barH = 5;
  const rowH = 16;

  metrics.forEach((m, idx) => {
    const isScored = Number.isFinite(m.val);
    const mScore = isScored ? Math.round(m.val) : null;
    const [cr, cg, cb] = scoreColor(mScore);

    // Alternating row background
    if (idx % 2 === 0) {
      setFill(250, 251, 253);
      doc.rect(L, y - 1, W, rowH, 'F');
    }

    // Metric name (bold)
    doc.setFont(undefined, 'bold');
    doc.setFontSize(9);
    setTxt(20, 30, 50);
    doc.text(m.label, L + 3, y + 5);

    // Weight (small, below name)
    doc.setFont(undefined, 'normal');
    doc.setFontSize(7);
    setTxt(150, 160, 175);
    doc.text(`Weight: ${m.weight}%`, L + 3, y + 10);

    // Progress bar — track
    setFill(230, 233, 240);
    doc.roundedRect(barStartX, y + 3, barW, barH, 2, 2, 'F');

    // Progress bar — fill
    if (isScored) {
      const fillW = Math.max(3, (mScore / 100) * barW);
      setFill(cr, cg, cb);
      doc.roundedRect(barStartX, y + 3, fillW, barH, 2, 2, 'F');
    }

    // Score number
    doc.setFont(undefined, 'bold');
    doc.setFontSize(12);
    setTxt(cr, cg, cb);
    doc.text(isScored ? `${mScore}` : 'N/A', R - 14, y + 7, { align: 'right' });

    // "/100"
    doc.setFont(undefined, 'normal');
    doc.setFontSize(8);
    setTxt(150, 160, 175);
    doc.text(isScored ? '/100' : '', R - 3, y + 7, { align: 'right' });

    y += rowH;
  });

  // Bottom border for table
  setDraw(220, 225, 235);
  doc.setLineWidth(0.3);
  doc.line(L, y, R, y);
  y += 8;

  // ═══════════════════════════════════════════════
  //  CRITICAL ACTIONS
  // ═══════════════════════════════════════════════
  setFill(255, 241, 241);
  doc.roundedRect(L, y, W, 8, 1.5, 1.5, 'F');
  doc.setFont(undefined, 'bold');
  doc.setFontSize(8);
  setTxt(185, 28, 28);
  doc.text('CRITICAL ACTIONS', L + 5, y + 5.5);
  y += 12;

  const alerts = metrics.filter(m => m.alert);
  if (alerts.length === 0) {
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);
    setTxt(34, 197, 94);
    doc.text('✓  All metrics are healthy. No immediate actions required.', L + 3, y);
    y += 8;
  } else {
    alerts.forEach(m => {
      // Red bullet
      setFill(239, 68, 68);
      doc.circle(L + 5, y, 1.5, 'F');

      // Label (bold)
      doc.setFont(undefined, 'bold');
      doc.setFontSize(9);
      setTxt(30, 41, 59);
      doc.text(m.label, L + 10, y + 1);
      y += 5;

      // Description (wrapped)
      doc.setFont(undefined, 'normal');
      doc.setFontSize(8);
      setTxt(80, 90, 110);
      const lines = doc.splitTextToSize(m.extra || '', W - 14);
      lines.forEach(line => {
        doc.text(line, L + 10, y);
        y += 4;
      });
      y += 3;
    });
  }

  // ═══════════════════════════════════════════════
  //  FOOTER
  // ═══════════════════════════════════════════════
  const footY = ph - 16;

  setFill(245, 248, 252);
  doc.rect(0, footY, pw, 16, 'F');

  setFill(14, 165, 233);
  doc.rect(0, footY, pw, 0.5, 'F');

  doc.setFont(undefined, 'normal');
  doc.setFontSize(6.5);
  setTxt(148, 163, 184);
  doc.text('Disclaimer: For educational purposes only. Not SEBI-registered investment advice. Consult a qualified financial adviser.', pw / 2, footY + 6, { align: 'center' });

  doc.setFont(undefined, 'bold');
  doc.setFontSize(7);
  setTxt(56, 189, 248);
  doc.text('WealthGenie  ·  AI-Powered Financial Advisory', pw / 2, footY + 11, { align: 'center' });

  // ── Download ──
  doc.save('WealthGenie_HealthScore_' + new Date().toISOString().slice(0, 10) + '.pdf');
}

/* ── Score History Panel ─────────────────────────────────────── */
const ScoreHistoryPanel = ({ currentScore, snapshot, subScores }) => {
  const scoredMetrics = subScores.filter(metric => Number.isFinite(metric.val));
  const weakest = scoredMetrics.reduce((min, metric) => metric.val < min.val ? metric : min, scoredMetrics[0]);
  const pointsToExcellent = Math.max(0, 80 - currentScore);
  const recordedAt = snapshot?.recorded_at ? new Date(snapshot.recorded_at) : null;
  const history = [{
    date: recordedAt && !Number.isNaN(recordedAt.getTime())
      ? recordedAt.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
      : 'Current',
    score: currentScore,
    label: 'Current verified snapshot',
    stage: 'current',
  }];

  return (
    <div className="score-history-panel glass-panel">
      <h4 className="panel-title"><TrendingUp size={14} />Your Score Over Time</h4>
      <div className="history-list">
        {history.map((entry, i) => (
          <div key={i} className={`history-row ${entry.stage === 'current' ? 'history-row-active' : ''}`}>
            <div className="timeline-marker">
              <div className="timeline-dot" style={{ background: entry.score >= 70 ? '#22c55e' : entry.score >= 50 ? '#f59e0b' : '#ef4444' }} />
              {i < history.length - 1 && <div className="timeline-line" />}
            </div>
            <span className="history-date">{entry.date}</span>
            <div className="history-bar-track">
              <motion.div className="history-bar-fill" initial={{ width: 0 }} animate={{ width: `${entry.score}%` }} transition={{ duration: 1, delay: i * 0.3 }}
                style={{ color: entry.score >= 70 ? '#22c55e' : entry.score >= 50 ? '#f59e0b' : '#ef4444' }} />
            </div>
            <span className="history-score">{entry.score}</span>
            <span className="history-label">{entry.label}</span>
          </div>
        ))}
      </div>
      <div className="history-note">
        <div className="note-badge"><Sparkles size={12} /> Personalised Tip</div>
        <p>
          {pointsToExcellent > 0
            ? `You need ${pointsToExcellent} more points for "Excellent" (80+). Focus first on ${weakest?.label || 'a scored metric'}${weakest ? ` (${Math.round(weakest.val)}/100)` : ''}. Historical trend appears only after verified snapshots are persisted.`
            : 'You have reached Excellent status. Historical trend appears only after verified snapshots are persisted.'}
        </p>
      </div>
    </div>
  );
};

/* ── Peer Comparison Panel ───────────────────────────────────── */
const PeerComparisonPanel = ({ score, profile }) => {
  return (
    <div className="peer-comparison-panel glass-panel">
      <h4 className="panel-title"><Users size={14} />How You Compare to Others</h4>
      <div className="peer-stat">
        <span className="peer-percentile">Not available</span>
        <span className="peer-label">for age {profile.age}, {profile.risk_tolerance} risk</span>
      </div>
      <div className="peer-vs-row">
        <div className="peer-vs-item">
          <span className="peer-vs-label">Your Score</span>
          <span className="peer-vs-value user-score">{score}</span>
        </div>
        <div className="peer-vs-divider">
          <span className="vs-badge">vs</span>
        </div>
        <div className="peer-vs-item">
          <span className="peer-vs-label">Peer Average</span>
          <span className="peer-vs-value peer-avg-value">N/A</span>
        </div>
      </div>
      <div className="peer-delta-badge">
        <ArrowUpRight size={14} /> Verified cohort benchmark unavailable
      </div>
      <div className="peer-improvement">
        <Target size={16} color="#38bdf8" style={{ flexShrink: 0 }} />
        <span>Your profile-grounded score is available. A peer rank requires a verified, comparable cohort dataset.</span>
      </div>
      <span className="peer-disclaimer">No percentile or peer average is fabricated from generic survey assumptions.</span>
    </div>
  );
};

/* ── FIX 4: Resolution Modal ─────────────────────────────────── */
const ResolutionModal = ({ metric, metricData, onClose, onNavigate }) => {
  const steps = {
    'Emergency Safety Net': {
      title: 'Build Your Emergency Safety Net',
      why: `An emergency fund covering 3–6 months of expenses keeps your long-term investments safe when unexpected expenses come up (medical bills, job loss, etc.).`,
      target: '6 months of essential expenses. Enter the amount only in a dedicated goal because monthly expenses are not an authorised Financial Profile input.',
      steps: [
        { action: 'Set an Emergency Fund goal', detail: 'Go to Goal Planner → New Goal → Emergency Fund.', cta: 'Go to Goal Planner', route: 'goal-planner' },
        { action: 'Review liquid options', detail: 'Use the server-ranked “Where to Invest” view to compare established access and liquidity terms; no product is selected in this score explanation.', cta: null },
        { action: 'Use your declared coverage', detail: metricData?.extra || 'Add your actual emergency-fund coverage to the Financial Profile; WealthGenie will not assume it.', cta: null },
      ],
    },
  };
  const content = steps[metric];
  if (!content) return null;
  return (
    <AnimatePresence>
      <motion.div className="modal-overlay" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.div className="resolution-modal glass-panel" onClick={e => e.stopPropagation()} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}>
          <button className="modal-close-btn" onClick={onClose}><X size={20} /></button>
          <h3>{content.title}</h3>
          <div className="resolution-why">
            <p>{content.why}</p>
            <p><strong>Recommended target:</strong> {content.target}</p>
          </div>
          <div className="resolution-steps">
            {content.steps.map((step, i) => (
              <div key={i} className="resolution-step">
                <div className="step-number">{i + 1}</div>
                <div className="step-content">
                  <p className="step-action">{step.action}</p>
                  <p className="step-detail">{step.detail}</p>
                  {step.cta && (
                    <button className="step-cta" onClick={() => { onNavigate(step.route); onClose(); }}>
                      {step.cta} <ChevronRight size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button className="btn-glass btn-close-modal" onClick={onClose}>Close</button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

/* ══════════════════════════════════════════════════════════════ */
const HealthScoreScreen = ({ profile, onNavigate }) => {
  const [resolutionMetric, setResolutionMetric] = useState(null);
  const [retryKey, setRetryKey] = useState(0);
  const [healthRequest, setHealthRequest] = useState({ profileId: null, data: null, error: null });
  const currentProfileId = profile?.profileId || null;

  useEffect(() => {
    if (!currentProfileId) return undefined;
    const controller = new AbortController();
    api.getFinancialHealthScore(currentProfileId, { signal: controller.signal })
      .then(data => {
        const scoreValue = Number(data?.score);
        const validSubScores = Array.isArray(data?.sub_scores) && data.sub_scores.every(metric => (
          typeof metric?.label === 'string'
          && (metric.value === null || (Number.isFinite(Number(metric.value)) && Number(metric.value) >= 0 && Number(metric.value) <= 100))
        ));
        if (!Number.isFinite(scoreValue) || scoreValue < 0 || scoreValue > 100 || !data?.grade || !validSubScores) {
          throw new TypeError('The health service returned an incomplete score.');
        }
        setHealthRequest({ profileId: currentProfileId, data, error: null });
      })
      .catch(error => {
        if (error?.code !== 'REQUEST_ABORTED') {
          setHealthRequest({ profileId: currentProfileId, data: null, error: error?.message || 'Unable to load financial health score.' });
        }
      });
    return () => controller.abort();
  }, [currentProfileId, retryKey]);

  const isCurrentResponse = healthRequest.profileId === currentProfileId;
  const healthData = isCurrentResponse ? healthRequest.data : null;
  const healthError = profile && !currentProfileId
    ? 'Save the Financial Profile before loading its health score.'
    : isCurrentResponse ? healthRequest.error : null;
  const score = healthData ? Number(healthData.score) : 0;
  const grade = healthData?.grade || '';
  const color = healthData?.color || '#38bdf8';
  const subScores = (healthData?.sub_scores || []).map(metric => ({ ...metric, val: metric.value }));

  const handleNavigate = (page) => {
    if (onNavigate) onNavigate(page);
  };


  const displayScore = useAnimatedCounter(score, 2500);

  const tickCount = 40;
  const activeTicks = Math.floor((score / 100) * tickCount);

  return (
    <div className="health-screen-wrapper">
      {/* Loading guard — profile or recommendations not yet available */}
      {!profile || (!healthData && !healthError) ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 16 }} role="status" aria-label={profile ? 'Loading health score' : 'Financial profile required'}>
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}>
            <Activity size={36} color="var(--color-primary)" />
          </motion.div>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>{profile ? 'Calculating your financial health score…' : 'Save a Financial Profile before opening your health score.'}</p>
        </div>
      ) : healthError ? (
        <div className="glass-panel" role="alert" style={{ margin: '32px auto', maxWidth: 720, padding: 28, textAlign: 'center' }}>
          <AlertTriangle size={32} color="#ef4444" />
          <h2>Financial health score unavailable</h2>
          <p style={{ color: 'var(--text-muted)' }}>{healthError}</p>
          <button className="btn-glass" onClick={() => setRetryKey(value => value + 1)}>Try Again</button>
        </div>
      ) : (
      <>
      {/* Top Header */}
      <div className="hs-header">
        <div>
          <h1 className="hs-title">Your Financial Health Score</h1>
          <p className="hs-subtitle">A complete check-up of how well your money is working for you.</p>
        </div>
        <div className="hs-header-right">
          <h2>WealthGenie</h2>
          <p>AI-Powered Money Check-up</p>
        </div>
      </div>

      {/* FIX 1: Row 1 — Score Card + Score History + Peer Comparison */}
      <div className="health-score-layout">
        {/* Score Card */}
        <div className="glass-panel score-card">
          <div className="score-dial-wrapper">
            <svg viewBox="0 0 200 200" className="score-svg" style={{ overflow: 'visible' }}>
              <defs>
                <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor={color} stopOpacity="1" />
                  <stop offset="100%" stopColor={color} stopOpacity="0.4" />
                </linearGradient>
                <filter id="gaugeGlow">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              {/* Decorative outer orbit ring */}
              <circle cx="100" cy="100" r="96" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" strokeDasharray="3 6" />

              {/* Inner Speedometer Ticks */}
              {[...Array(tickCount)].map((_, i) => (
                <line
                  key={`tick-${i}`}
                  x1="100" y1="22" x2="100" y2="28"
                  stroke={i < activeTicks ? color : "rgba(255,255,255,0.04)"}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  transform={`rotate(${i * (360 / tickCount)} 100 100)`}
                  style={{ transition: 'stroke 1s ease-out', opacity: i < activeTicks ? 0.8 : 1 }}
                />
              ))}

              {/* Ultra-sleek faint track */}
              <circle cx="100" cy="100" r="82" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="6" />
              
              {/* Ambient Glow Ring */}
              <motion.circle cx="100" cy="100" r="82" fill="none" stroke={color} strokeWidth="14" strokeDasharray="515"
                initial={{ strokeDashoffset: 515 }} animate={{ strokeDashoffset: 515 - (515 * score) / 100 }}
                transition={{ duration: 2.5, ease: "easeOut", delay: 0.5 }} strokeLinecap="round"
                style={{ transform: 'rotate(-90deg)', transformOrigin: '100px 100px', opacity: 0.15, filter: 'blur(12px)' }} />
                
              {/* Core Ring */}
              <motion.circle cx="100" cy="100" r="82" fill="none" stroke="url(#gaugeGrad)" strokeWidth="6" strokeDasharray="515"
                initial={{ strokeDashoffset: 515 }} animate={{ strokeDashoffset: 515 - (515 * score) / 100 }}
                transition={{ duration: 2.5, ease: "easeOut", delay: 0.5 }} strokeLinecap="round"
                filter="url(#gaugeGlow)"
                style={{ transform: 'rotate(-90deg)', transformOrigin: '100px 100px' }} />

            </svg>
            <div className="score-center-text">
              <motion.span className="score-number" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', bounce: 0.5, duration: 1, delay: 0.2 }}>
                {displayScore}
              </motion.span>
              <motion.span className="score-outof" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 }}>
                OUT OF 100
              </motion.span>
            </div>
          </div>
          <motion.div className="score-grade-badge" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }}
            style={{ '--grade-color': color }}>
            <span className="score-grade-dot" style={{ background: color }} />
            {grade}
          </motion.div>
          {/* FIX 5: Export Scorecard button */}
          <motion.button initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.5 }}
            className="btn-glass export-btn" onClick={() => exportHealthScorecard(score, subScores, profile, healthData)}>
            <Share size={14} /> Export Scorecard
          </motion.button>
        </div>

        <ScoreHistoryPanel currentScore={score} snapshot={healthData.snapshot} subScores={subScores} />
        <PeerComparisonPanel score={score} profile={profile} />
      </div>

      {/* Row 2: Metric Breakdown (full width) */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.3 }}
        className="glass-panel metric-breakdown-panel">
        <h3 className="breakdown-title">
          <Activity size={16} /> Detailed Score Breakdown
          <span className="breakdown-subtitle">Scored across {subScores.length} key areas of your finances</span>
        </h3>
        <div className="breakdown-grid">
          {subScores.map((sub, i) => {
            const isScored = Number.isFinite(sub.val);
            const barColor = !isScored ? '#94a3b8' : sub.val >= 80 ? '#4ade80' : sub.val >= 50 ? '#eab308' : '#ef4444';
            const icons = {
              'Savings Capacity': <Shield size={14} />,
              'Emergency Safety Net': <AlertTriangle size={14} />,
              'Investment Variety': <PieChart size={14} />,
              'Tax Efficiency': <Zap size={14} />,
              'Goal Coverage': <Target size={14} />,
              'Risk-Timeline Match': <Activity size={14} />,
            };
            const icon = icons[sub.label] || (sub.alert ? <AlertTriangle size={14} color="#ef4444" /> : <ArrowUpRight size={14} color="#4ade80" />);
            return (
              <motion.div key={i} className={`breakdown-row ${sub.alert ? 'alert' : ''}`}
                initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, delay: i * 0.1 + 0.5 }}>
                <div className="breakdown-header">
                  <div className="breakdown-label-group">
                    <span className={`metric-icon-wrap ${sub.alert ? 'alert-icon' : ''}`} style={{ '--metric-color': barColor }}>{icon}</span>
                    <span className="breakdown-label">{sub.label}</span>
                    <span className="breakdown-weight">{sub.weight}%</span>
                  </div>
                  <span className="breakdown-score" style={{ color: barColor }}>{isScored ? Math.round(sub.val) : 'N/A'}{isScored && <span className="score-max">/100</span>}</span>
                </div>
                <div className="progress-track">
                  <motion.div initial={{ width: 0 }} animate={{ width: isScored ? `${sub.val}%` : '0%' }} transition={{ duration: 1.5, delay: i * 0.1 + 0.8 }}
                    className="progress-fill" style={{ color: barColor }} />
                </div>
                <div className="breakdown-extra">
                  {sub.alert ? <strong style={{ color: '#fca5a5' }}>{sub.extra}</strong> : sub.extra}
                </div>
                {sub.hasDisclaimer && (
                  <span className="metric-disclaimer">ⓘ Score based on goals declared within WealthGenie. External savings are not tracked.</span>
                )}
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* Row 3: Critical Action Required (full width) */}
      {subScores.some(s => s.alert) && (
        <div className="glass-panel critical-action-panel">
          <div className="widget-title critical-widget-title">
            <AlertTriangle size={20} color="#ef4444" /> ATTENTION NEEDED
          </div>
          <div className="critical-items">
            {subScores.filter(s => s.alert).map((alertItem, idx) => (
              <div key={idx} className="critical-item">
                <div className="critical-item-content">
                  <div className="critical-item-header">
                    <strong>{alertItem.label}{Number.isFinite(alertItem.val) ? ' Shortfall' : ' Information Needed'}</strong>
                    <span className="critical-item-score">{Number.isFinite(alertItem.val) ? `Score: ${Math.round(alertItem.val)}/100` : 'Not scored'}</span>
                  </div>
                  <div className="critical-item-desc">{alertItem.extra}</div>
                </div>
                <div className="critical-item-action">
                  <button className="btn-glass resolution-cta" onClick={() => setResolutionMetric(alertItem.label)}>
                    VIEW NEXT STEPS <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FIX 4: Resolution Modal */}
      {resolutionMetric && (
        <ResolutionModal metric={resolutionMetric} metricData={subScores.find(item => item.label === resolutionMetric)} onClose={() => setResolutionMetric(null)} onNavigate={handleNavigate} />
      )}
      </>
      )}
    </div>
  );
};

export default HealthScoreScreen;
