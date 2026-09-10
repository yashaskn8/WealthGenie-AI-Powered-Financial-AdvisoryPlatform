/**
 * WealthGenie — Deep Dive Modal (Refactored Shell)
 * ─────────────────────────────────────────────────
 * Each tab panel is extracted into its own component under ./deepdive/
 * for maintainability. This file handles modal state, layout, and tab routing.
 */
import React, { useState, useMemo } from 'react';
import { X, MapPin, Info, Shield, History as HistoryIcon, IndianRupee, Flame, Calculator as CalcIcon, AlertTriangle } from 'lucide-react';
import { investmentDatabase } from '../investmentDatabase';
import api from '../services/api';
import JargonTooltip from './JargonTooltip';
import './DeepDiveModal.css';

// ── Tab Panel Components ────────────────────────────────────────
import { OverviewTab, WhereToInvestTab, CalculatorTab, TaxTab, HistoryTab, WhyInvestTab, StressTestTab } from './deepdive';

const TABS = [
  { id: 'Overview', icon: <Info size={16} /> },
  { id: 'Where to Invest', icon: <MapPin size={16} /> },
  { id: 'Calculator', icon: <CalcIcon size={16} /> },
  { id: 'Tax', icon: <Shield size={16} /> },
  { id: 'History', icon: <HistoryIcon size={16} /> },
  { id: 'Why Invest', icon: <IndianRupee size={16} /> },
  { id: 'Stress Test', icon: <Flame size={16} /> }
];

const DeepDiveModal = ({ isOpen, onClose, investment, onSelectInvestment, allRecommendations, horizon, userProfile, recommendationMeta = null, initialTab = 'Overview' }) => {
  const [activeTab, setActiveTab] = useState(initialTab || 'Overview');

  React.useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab, investment?.id]);
  const calcMode = 'SIP';
  const [calcAmount, setCalcAmount] = useState(5000);
  const [calcYears, setCalcYears] = useState(15);
  const [calcReturn, setCalcReturn] = useState(10);
  const [inflationRate, setInflationRate] = useState(6);
  const [benchmarkRate, setBenchmarkRate] = useState(2.7);
  const [projection, setProjection] = useState(null);
  const [projectionError, setProjectionError] = useState(null);
  const [projectionLoading, setProjectionLoading] = useState(false);
  const [stressTestAmount, setStressTestAmount] = useState(100000);

  const [prevInvestmentId, setPrevInvestmentId] = useState(investment?.id);
  const [prevHorizon, setPrevHorizon] = useState(horizon);

  const modalRef = React.useRef(null);
  const previouslyFocusedElementRef = React.useRef(null);

  React.useEffect(() => {
    if (isOpen) {
      previouslyFocusedElementRef.current = document.activeElement;
      if (modalRef.current) {
        modalRef.current.focus();
      }

      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        } else if (e.key === 'Tab' && modalRef.current) {
          const focusableElements = modalRef.current.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          );
          if (focusableElements.length === 0) return;
          const first = focusableElements[0];
          const last = focusableElements[focusableElements.length - 1];

          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        if (previouslyFocusedElementRef.current && previouslyFocusedElementRef.current.focus) {
          previouslyFocusedElementRef.current.focus();
        }
      };
    }
  }, [isOpen, onClose]);

  // ─── Instrument-Aware Calculator Bounds ───
  const calcBounds = useMemo(() => {
    if (!investment) return { returnMin: 1, returnMax: 30, yearMin: 1, yearMax: 40 };
    const exactReturn = Number(investment.nominalReturn);
    const retMin = Number(investment.expected_return_min ?? investment.returnRange?.min ?? exactReturn);
    const retMax = Number(investment.expected_return_max ?? investment.returnRange?.max ?? exactReturn);
    if (!Number.isFinite(retMin) || !Number.isFinite(retMax)) throw new TypeError('Instrument return assumptions are unavailable.');
    const cat = (investment.category || investment.cat || '').toLowerCase();
    const name = (investment.name || investment.abbr || '').toLowerCase();

    let yearMin = 1, yearMax = 30;
    if (name.includes('ppf')) { yearMin = 15; yearMax = 30; }
    else if (name.includes('scss')) { yearMin = 5; yearMax = 8; }
    else if (name.includes('sukanya') || name.includes('ssy')) { yearMin = 15; yearMax = 21; }
    else if (name.includes('nps')) { yearMin = 10; yearMax = 40; }
    else if (name.includes('rbi') && name.includes('bond')) { yearMin = 7; yearMax = 7; }
    else if (name.includes('pmvvy')) { yearMin = 10; yearMax = 10; }
    else if (name.includes('fd') || name.includes('fixed deposit')) { yearMin = 1; yearMax = 10; }
    else if (name.includes('liquid')) { yearMin = 1; yearMax = 3; }
    else if (name.includes('sgb') || name.includes('gold bond')) { yearMin = 5; yearMax = 8; }
    else if (name.includes('elss')) { yearMin = 3; yearMax = 25; }
    else if (cat.includes('equity')) { yearMin = 3; yearMax = 30; }
    else if (cat.includes('hybrid')) { yearMin = 3; yearMax = 25; }
    else if (cat.includes('debt') || cat.includes('deposit') || cat.includes('bond')) { yearMin = 1; yearMax = 10; }

    const sliderRetMin = Math.max(1, Math.floor(retMin - 2));
    const sliderRetMax = Math.min(30, Math.ceil(retMax + 2));

    return { returnMin: sliderRetMin, returnMax: sliderRetMax, yearMin, yearMax };
  }, [investment]);

  // Reset calculator state when instrument changes
  if (investment?.id !== prevInvestmentId || horizon !== prevHorizon) {
    setPrevInvestmentId(investment?.id);
    setPrevHorizon(horizon);

    const exactReturn = Number(investment?.nominalReturn);
    const retMin = Number(investment?.expected_return_min ?? investment?.returnRange?.min ?? exactReturn);
    const retMax = Number(investment?.expected_return_max ?? investment?.returnRange?.max ?? exactReturn);
    if (!Number.isFinite(retMin) || !Number.isFinite(retMax)) throw new TypeError('Instrument return assumptions are unavailable.');
    const cat = investment ? (investment.category || investment.cat || '').toLowerCase() : '';
    const name = investment ? (investment.name || investment.abbr || '').toLowerCase() : '';

    let _yearMin = 1, yearMax = 30;
    if (name.includes('ppf')) { _yearMin = 15; yearMax = 30; }
    else if (name.includes('scss')) { _yearMin = 5; yearMax = 8; }
    else if (name.includes('sukanya') || name.includes('ssy')) { _yearMin = 15; yearMax = 21; }
    else if (name.includes('nps')) { _yearMin = 10; yearMax = 40; }
    else if (name.includes('rbi') && name.includes('bond')) { _yearMin = 7; yearMax = 7; }
    else if (name.includes('pmvvy')) { _yearMin = 10; yearMax = 10; }
    else if (name.includes('fd') || name.includes('fixed deposit')) { _yearMin = 1; yearMax = 10; }
    else if (name.includes('liquid')) { _yearMin = 1; yearMax = 3; }
    else if (name.includes('sgb') || name.includes('gold bond')) { _yearMin = 5; yearMax = 8; }
    else if (name.includes('elss')) { _yearMin = 3; yearMax = 25; }
    else if (cat.includes('equity')) { _yearMin = 3; yearMax = 30; }
    else if (cat.includes('hybrid')) { _yearMin = 3; yearMax = 25; }
    else if (cat.includes('debt') || cat.includes('deposit') || cat.includes('bond')) { _yearMin = 1; yearMax = 10; }

    const sliderRetMin = Math.max(1, Math.floor(retMin - 2));
    const sliderRetMax = Math.min(30, Math.ceil(retMax + 2));
    const midReturn = ((sliderRetMin + sliderRetMax) / 2).toFixed(1);

    setCalcReturn(Number(midReturn));
    const declaredHorizon = Number(horizon);
    if (!Number.isFinite(declaredHorizon)) throw new TypeError('Investment horizon is unavailable.');
    setCalcYears(Math.max(_yearMin, Math.min(declaredHorizon, yearMax)));
    setCalcAmount(5000);
    setActiveTab('Overview');
  }

  // Normalize fields
  const inv = useMemo(() => {
    if (!investment) return {};
    return {
      ...investment,
      expected_return_min: investment.expected_return_min ?? investment.returnRange?.min ?? investment.nominalReturn,
      expected_return_max: investment.expected_return_max ?? investment.returnRange?.max ?? investment.nominalReturn,
      category: investment.category || investment.cat,
      risk_level: investment.risk_level || investment.riskLabel,
      lock_in_years: investment.lock_in_years ?? investment.lockIn ?? null,
      tax_benefit: investment.tax_benefit ?? null,
      tax_section: investment.tax_section || 'N/A',
      tax_free_interest: investment.tax_free_interest ?? null,
      liquidity: investment.liquidity || 'Unavailable',
      description: investment.description || investment.desc,
      name: investment.name || investment.abbr,
    };
  }, [investment]);
  const returnMin = Number(inv.expected_return_min);
  const returnMax = Number(inv.expected_return_max);
  const hasReturnRange = Number.isFinite(returnMin) && Number.isFinite(returnMax);
  const riskLevel = typeof inv.risk_level === 'string' ? inv.risk_level : '';

  React.useEffect(() => {
    if (!isOpen || !investment) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setProjectionLoading(true);
      setProjectionError(null);
      api.compareInvestmentProjection(
        calcAmount,
        calcReturn / 100,
        benchmarkRate / 100,
        inflationRate / 100,
        calcYears,
        { signal: controller.signal },
      ).then(result => {
        if (!cancelled) setProjection(result);
      }).catch(error => {
        if (!cancelled && error?.code !== 'REQUEST_ABORTED') {
          setProjection(null);
          setProjectionError(error.message);
        }
      }).finally(() => {
        if (!cancelled) setProjectionLoading(false);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, investment, calcAmount, calcReturn, benchmarkRate, inflationRate, calcYears]);

  const historicalData = useMemo(() => (projection?.normalizedChart || []).map(point => ({
    ...point,
    fd: point.benchmark,
  })), [projection]);

  if (!isOpen || !investment) return null;

  // ─── Runtime Safety: Missing Catalog ID Fallback ───
  const catalogMatch = investmentDatabase.find(x => x.id === investment?.id);
  if (!catalogMatch) {
    console.warn(`[WealthGenie Diagnostics] Investment ID "${investment?.id}" not found in master catalog.`);
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="ddm-content" onClick={e => e.stopPropagation()} style={{ minHeight: '320px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '48px 32px' }}>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
          <div style={{ textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ display: 'inline-flex', padding: '18px', borderRadius: '50%', background: 'rgba(251, 191, 36, 0.1)', color: '#fbbf24', marginBottom: '20px' }}>
              <AlertTriangle size={36} />
            </div>
            <h3 style={{ color: '#f8fafc', fontSize: '1.2rem', marginBottom: '8px' }}>Investment Details Unavailable</h3>
            <p style={{ fontSize: '0.9rem', maxWidth: '340px', margin: '0 auto 24px auto', lineHeight: '1.6', color: '#94a3b8' }}>
              The profile for <strong style={{ color: '#e2e8f0' }}>"{investment?.name || investment?.id || 'Unknown'}"</strong> is temporarily unavailable or undergoing maintenance.
            </p>
            <button onClick={onClose} style={{ background: 'linear-gradient(135deg, #38bdf8, #818cf8)', color: '#0f172a', border: 'none', borderRadius: '10px', padding: '10px 24px', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' }}>
              Return to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Comparison data
  const comparisonData = (allRecommendations || []).slice(0, 8).map(r => ({
    name: (r.name || r.abbr || '').length > 10 ? (r.name || r.abbr || '').substring(0, 10) + '..' : (r.name || r.abbr || ''),
    returnMax: r.expected_return_max ?? r.nominalReturn,
    isThis: r.id === inv.id
  }));

  // The backend owns every displayed projection. Tax is intentionally not
  // inferred here because this modal does not collect a complete tax context.
  const calcProps = {
    inv,
    calcAmount,
    calcReturn,
    calcYears,
    calcMode,
    calcBounds,
    inflationRate,
    benchmarkRate,
    projection,
    projectionError,
    projectionLoading,
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <style>{`
        /* Scoped overrides for Deep Dive Modal calculator range sliders */
        .calc-field input[type="range"] {
          -webkit-appearance: none !important;
          appearance: none !important;
          width: 100% !important;
          height: 20px !important;
          background: transparent !important;
          outline: none !important;
          margin: 0 !important;
          padding: 0 !important;
          border: none !important;
          box-sizing: border-box !important;
          cursor: pointer !important;
        }

        .calc-field input[type="range"]::-webkit-slider-runnable-track {
          width: 100% !important;
          height: 4px !important;
          border-radius: 3px !important;
          border: none !important;
          box-sizing: border-box !important;
          background: linear-gradient(to right, #38bdf8 0%, #38bdf8 var(--slider-pct, 0%), rgba(255,255,255,0.08) var(--slider-pct, 0%), rgba(255,255,255,0.08) 100%) !important;
        }

        .calc-field input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none !important;
          appearance: none !important;
          height: 16px !important;
          width: 16px !important;
          border-radius: 50% !important;
          background: #ffffff !important;
          border: 3px solid #38bdf8 !important;
          cursor: pointer !important;
          box-shadow: 0 0 10px rgba(56, 189, 248, 0.5), 0 2px 6px rgba(0, 0, 0, 0.4) !important;
          transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease !important;
          margin-top: -6px !important;
          box-sizing: border-box !important;
        }

        .calc-field input[type="range"]::-webkit-slider-thumb:hover {
          transform: scale(1.15) !important;
          box-shadow: 0 0 14px rgba(56, 189, 248, 0.7), 0 2px 8px rgba(0, 0, 0, 0.5) !important;
        }

        .calc-field input[type="range"]::-moz-range-track {
          width: 100% !important;
          height: 4px !important;
          border-radius: 3px !important;
          border: none !important;
          box-sizing: border-box !important;
          background: linear-gradient(to right, #38bdf8 0%, #38bdf8 var(--slider-pct, 0%), rgba(255,255,255,0.08) var(--slider-pct, 0%), rgba(255,255,255,0.08) 100%) !important;
        }

        .calc-field input[type="range"]::-moz-range-thumb {
          height: 16px !important;
          width: 16px !important;
          border-radius: 50% !important;
          background: #ffffff !important;
          border: 3px solid #38bdf8 !important;
          cursor: pointer !important;
          box-shadow: 0 0 10px rgba(56, 189, 248, 0.5), 0 2px 6px rgba(0, 0, 0, 0.4) !important;
          transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease !important;
          box-sizing: border-box !important;
        }

        .calc-field input[type="range"]::-moz-range-thumb:hover {
          transform: scale(1.15) !important;
          box-shadow: 0 0 14px rgba(56, 189, 248, 0.7), 0 2px 8px rgba(0, 0, 0, 0.5) !important;
        }
      `}</style>
      <div className="ddm-content" ref={modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="deepdive-modal-title" onClick={e => e.stopPropagation()}>
        
        {/* Sticky Header */}
        <div className="ddm-sticky-header">
          <button className="modal-close" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>
          
          <div className="ddm-header-top">
            <span className="premium-badge">{inv.category}</span>
            <h2 id="deepdive-modal-title" className="ddm-title">{inv.name}</h2>
            <span className="ddm-data-note">
              {inv.returnDataClass || 'MODEL_ASSUMPTION'} · {inv.returnAssumptionVersion || 'wealthgenie-projection-assumptions-1.0.0'} · not an observed market fact or provider forecast
            </span>
          </div>

          <div className="ddm-quick-metrics">
            <div className="metric-item">
              <span className="metric-label"><JargonTooltip term="Risk Profile">Risk Profile</JargonTooltip></span>
              <span className="metric-value" style={{ color: !riskLevel ? '#64748b' : riskLevel.includes('High') ? '#f43f5e' : riskLevel.includes('Medium') ? '#f59e0b' : '#22c55e' }}>
                {riskLevel || 'Unavailable'}
              </span>
            </div>
            <div className="metric-item">
              <span className="metric-label"><JargonTooltip term="Return Potential">Model Return Assumption</JargonTooltip></span>
              <span className="metric-value" style={{ color: '#22c55e' }}>
                {hasReturnRange
                  ? `${returnMin.toFixed(1).replace(/\.0$/, '')}% – ${returnMax.toFixed(1).replace(/\.0$/, '')}%`
                  : 'Unavailable'}
              </span>
            </div>
            <div className="metric-item">
              <span className="metric-label"><JargonTooltip term="Lock-in Period">Lock-in Period</JargonTooltip></span>
              <span className="metric-value">{inv.lock_in_years === null ? 'Unavailable' : inv.lock_in_years > 0 ? `${inv.lock_in_years} Years` : 'None'}</span>
            </div>
            <div className="metric-item">
              <span className="metric-label"><JargonTooltip term="Tax Benefit">Reference Tax Tag</JargonTooltip></span>
              <span className="metric-value">Unavailable · use Tax tab</span>
            </div>
          </div>

          <div className="ddm-tabs-nav" role="tablist" aria-label="Investment detail sections">
            {TABS.map(tab => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`ddm-tab-btn ${activeTab === tab.id ? 'ddm-tab-btn--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="ddm-tab-btn-content">{tab.icon} {tab.id}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable Content Area */}
        <div className="ddm-scroll-container">
          {activeTab === 'Overview' && <OverviewTab inv={inv} comparisonData={comparisonData} onSelectInvestment={onSelectInvestment} />}
          {activeTab === 'Where to Invest' && <WhereToInvestTab inv={inv} userProfile={userProfile} recommendationMeta={recommendationMeta} />}
          {activeTab === 'Calculator' && <CalculatorTab {...calcProps} setCalcAmount={setCalcAmount} setCalcYears={setCalcYears} setCalcReturn={setCalcReturn} setInflationRate={setInflationRate} />}
          {activeTab === 'Tax' && <TaxTab inv={inv} calcAmount={calcAmount} calcYears={calcYears} userProfile={userProfile} />}
          {activeTab === 'History' && <HistoryTab inv={inv} historicalData={historicalData} benchmarkRate={benchmarkRate} inflationRate={inflationRate} projectionError={projectionError} />}
          {activeTab === 'Why Invest' && <WhyInvestTab {...calcProps} setActiveTab={setActiveTab} setInflationRate={setInflationRate} setBenchmarkRate={setBenchmarkRate} />}
          {activeTab === 'Stress Test' && (
            <StressTestTab
              inv={inv}
              profileId={userProfile?.profileId}
              stressTestAmount={stressTestAmount}
              setStressTestAmount={setStressTestAmount}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default DeepDiveModal;
