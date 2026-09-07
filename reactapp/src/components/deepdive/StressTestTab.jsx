/**
 * DeepDiveModal — Stress Test Tab (Crash & Macro Shock Simulator)
 * The server owns scenario selection and all value-impact arithmetic. This
 * component preserves the restored visual structure and renders that result.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Info,
  Flame,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Percent,
  Zap,
  Compass,
  AlertTriangle,
  LoaderCircle,
} from 'lucide-react';
import api from '../../services/api';
import { formatINR } from '../../utils/indianNumberFormat';

const ICONS_BY_PROFILE = {
  guaranteed: <ShieldCheck size={20} color="#10b981" />,
  liquid_debt: <Compass size={20} color="#14b8a6" />,
  long_debt: <Percent size={20} color="#06b6d4" />,
  gold: <Zap size={20} color="#eab308" />,
  reit: <Compass size={20} color="#ec4899" />,
  midsmall_equity: <AlertTriangle size={20} color="#ef4444" />,
  large_equity: <TrendingUp size={20} color="#38bdf8" />,
};

const StressTestTab = ({ inv, stressTestAmount, setStressTestAmount, profileId }) => {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const missingInputs = !profileId || !inv?.id;

  useEffect(() => {
    if (missingInputs) return undefined;

    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      api.runInstrumentStressTest(profileId, inv.id, stressTestAmount, { signal: controller.signal })
        .then((result) => {
          if (!cancelled) setReport(result);
        })
        .catch((requestError) => {
          if (!cancelled && requestError.code !== 'REQUEST_ABORTED') {
            setReport(null);
            setError(requestError.message || 'Unable to run this stress test.');
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [inv?.id, missingInputs, profileId, stressTestAmount]);

  const assetProfile = useMemo(() => {
    const profile = missingInputs ? null : report?.asset_profile;
    if (!profile) {
      return {
        type: null,
        title: loading ? 'Loading stress profile…' : 'Stress profile unavailable',
        desc: loading ? 'Applying the authoritative server-owned scenario model.' : 'A current recommendation is required.',
        icon: loading ? <LoaderCircle size={20} className="spin" /> : <AlertTriangle size={20} color="#f59e0b" />,
        insight: null,
      };
    }
    return {
      ...profile,
      desc: profile.description,
      icon: ICONS_BY_PROFILE[profile.type] || <AlertTriangle size={20} color="#f59e0b" />,
    };
  }, [loading, missingInputs, report]);

  const scenarios = missingInputs ? [] : report?.scenarios || [];
  const visibleError = missingInputs
    ? 'Your current Financial Profile and recommendation are required for this stress test.'
    : error;

  return (
    <div className="tab-fade-in" style={{ padding: '8px 0' }}>
      <div className="ddm-section-header" style={{ marginBottom: 12 }}>Crash Stress Test</div>

      {/* Asset classification card */}
      <div className="stress-asset-header" style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '16px 20px',
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: '16px',
        marginBottom: 20,
      }}>
        <div style={{
          width: '38px',
          height: '38px',
          borderRadius: '10px',
          background: 'rgba(255, 255, 255, 0.04)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {assetProfile.icon}
        </div>
        <div>
          <div style={{ fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--ddm-text-muted)', letterSpacing: '1px' }}>Asset Category</div>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: '#f8fafc', marginTop: 1 }}>{assetProfile.title}</div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: '0.72rem', color: '#94a3b8', maxWidth: '50%', textAlign: 'right', lineHeight: '1.4' }}>
          {assetProfile.desc}
        </div>
      </div>

      <div className="stress-hero">
        <div className="stress-hero-icon"><Flame size={24} /></div>
        <div>
          <div className="stress-hero-title">What happens when markets crash?</div>
          <div className="stress-hero-subtitle">
            Every asset can face adverse conditions. The simulator below applies server-owned historical or hypothetical stress assumptions to your entered principal. <strong style={{ color: '#fbbf24' }}>It is a risk illustration, not a return forecast.</strong>
          </div>
        </div>
      </div>

      <div className="stress-amount-input-container">
        <label className="stress-amount-label">Enter your investment principal to test</label>
        <div className="stress-amount-input-wrapper">
          <span className="stress-amount-prefix">₹</span>
          <input
            type="number"
            className="stress-amount-input"
            value={stressTestAmount}
            onChange={(event) => {
              const value = Math.max(1000, Math.min(10000000, Number(event.target.value) || 0));
              setStressTestAmount(value);
            }}
            min={1000}
            max={10000000}
            step={5000}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <span className="stress-amount-hint">Min ₹1,000 · Max ₹1 Crore</span>
          <span style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 700 }}>Adjust values to see the server projection update</span>
        </div>
      </div>

      {visibleError && (
        <div role="alert" className="stress-card" style={{ padding: '16px 20px', color: '#fda4af', marginBottom: 16 }}>
          <AlertCircle size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />
          {visibleError}
        </div>
      )}

      <div className="stress-scenarios" aria-busy={loading}>
        {loading && scenarios.length === 0 && (
          <div className="stress-card" style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
            <LoaderCircle size={22} className="spin" style={{ marginRight: 8, verticalAlign: 'middle' }} />
            Running authoritative stress scenarios…
          </div>
        )}
        {scenarios.map((crash) => {
          const isInflation = crash.impact_kind === 'inflation';
          const isPenalty = crash.impact_kind === 'penalty';
          const labelText = isInflation ? 'Purchasing Power Loss' : isPenalty ? 'Exit Penalty' : 'Max Drawdown';
          const labelColor = isInflation || isPenalty ? '#fb923c' : '#f43f5e';
          const isLoss = !isInflation;

          return (
            <div key={`${crash.name}-${crash.period}`} className="stress-card" style={{ padding: '0 0 16px' }}>
              <div className="stress-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className="stress-card-emoji">
                    {isLoss ? <TrendingDown size={18} /> : <AlertCircle size={18} color="#fb923c" />}
                  </div>
                  <div>
                    <div className="stress-card-name">{crash.name}</div>
                    <div className="stress-card-period">{crash.period}</div>
                  </div>
                </div>
                <div style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  fontSize: '0.62rem',
                  fontWeight: '850',
                  textTransform: 'uppercase',
                  color: labelColor,
                  letterSpacing: '0.5px',
                }}>
                  {crash.badge}
                </div>
              </div>

              <div className="stress-card-body">
                <div className="stress-card-cause" style={{ marginBottom: 20 }}>{crash.cause}</div>

                <div className="stress-drop-visual" style={{ marginBottom: 20 }}>
                  <div className="stress-drop-bar" style={{ background: 'rgba(255, 255, 255, 0.03)', height: '8px' }}>
                    <div
                      className="stress-drop-bar-fill"
                      style={{
                        width: `${Math.max(3, Math.min(crash.impact_magnitude_pct, 100))}%`,
                        background: isInflation || isPenalty
                          ? 'linear-gradient(90deg, #f59e0b, #fb923c)'
                          : 'linear-gradient(90deg, #f43f5e, #ef4444)',
                        boxShadow: isInflation || isPenalty
                          ? '0 0 8px rgba(245, 158, 11, 0.4)'
                          : '0 0 8px rgba(244, 63, 94, 0.4)',
                      }}
                    />
                  </div>
                  <div className="stress-drop-stats" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div className="stress-stat">
                      <span className="stress-stat-label">{labelText}</span>
                      <span className="stress-stat-value" style={{ color: labelColor }}>
                        {crash.impact_pct}%
                      </span>
                    </div>
                    <div className="stress-stat" style={{ textAlign: 'right' }}>
                      <span className="stress-stat-label">Recovery Period</span>
                      <span className="stress-stat-value stress-stat-value--recovery">{crash.recovery_period}</span>
                    </div>
                  </div>
                </div>

                <div className="stress-scenario-box">
                  <div className="stress-scenario-title" style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
                    Principal Value Impact Simulation
                  </div>
                  <div className="stress-scenario-flow">
                    <div className="stress-flow-item">
                      <span className="stress-flow-label">1. Starting Capital</span>
                      <span className="stress-flow-value" style={{ color: '#fff' }}>{formatINR(crash.starting_value)}</span>
                    </div>
                    <span className="stress-flow-arrow">→</span>
                    <div className="stress-flow-item stress-flow-item--drop">
                      <span className="stress-flow-label">2. Crash Bottom</span>
                      <span className="stress-flow-value">{formatINR(crash.bottom_value)}</span>
                    </div>
                    <span className="stress-flow-arrow">→</span>
                    <div className="stress-flow-item stress-flow-item--recover">
                      <span className="stress-flow-label">3. Post-Recovery</span>
                      <span className="stress-flow-value">{formatINR(crash.recovery_value)}</span>
                      {crash.recovery_delta !== 0 && (
                        <span style={{ fontSize: '0.62rem', color: crash.recovery_delta > 0 ? '#10b981' : '#ef4444', fontWeight: 900, marginTop: 1 }}>
                          {crash.recovery_delta > 0 ? 'Net Gain: +' : 'Net Loss: '}{formatINR(crash.recovery_delta)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {assetProfile.insight && (
        <div className="stress-insight">
          <div className="stress-insight-icon"><Info size={24} /></div>
          <div>
            <div className="stress-insight-title">The #1 Rule During Downturns</div>
            <div className="stress-insight-text">{assetProfile.insight}</div>
          </div>
        </div>
      )}

      <p style={{ color: 'var(--ddm-text-muted)', fontSize: '0.65rem', marginTop: 16, textAlign: 'center', fontStyle: 'italic', lineHeight: 1.5 }}>
        * {report?.disclosure || 'Scenario results load from the protected WealthGenie calculation service.'}
      </p>
    </div>
  );
};

export default StressTestTab;
