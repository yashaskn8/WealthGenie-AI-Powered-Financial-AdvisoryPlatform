import { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { AlertCircle, BarChart3, ChevronDown, ChevronRight, Info, ShieldCheck, Wallet, Zap } from 'lucide-react';
import { CHART_COLORS, RISK_COLORS } from './investmentDatabase';
import { getWhy } from './utils/recommendationPresentation';
import { normalizeFinancialProfile } from './utils/financialProfile';
import SebiDisclaimer from './components/SebiDisclaimer';
import './Dashboard.css';

function LoadingState() {
  return <div role="status" className="route-loading">Loading authoritative recommendations…</div>;
}

function EmptyState({ notice }) {
  return (
    <section style={{ padding: 28, border: '1px solid rgba(251,113,133,.25)', borderRadius: 16, color: '#cbd5e1' }}>
      <AlertCircle color="#fb7185" />
      <h2>No personalized recommendation is being shown</h2>
      <p>{notice?.message || 'The authoritative backend did not return a suitable portfolio.'}</p>
      {notice?.detail && <small>{notice.detail}</small>}
    </section>
  );
}

export default function RecommendationDashboard({
  userProfile,
  recommendations: suppliedRecommendations,
  onExploreAll,
  onRebalance,
  onLearnMore,
  isLoading,
  fallbackNotice,
  onDismissFallbackNotice,
}) {
  const profile = normalizeFinancialProfile(userProfile);
  const recommendations = useMemo(() => suppliedRecommendations || [], [suppliedRecommendations]);
  const [expanded, setExpanded] = useState({});
  const allocation = recommendations.map((instrument, index) => ({
    name: instrument.abbr || instrument.name,
    value: Number(instrument.monthly_allocation),
    color: instrument.color || CHART_COLORS[index % CHART_COLORS.length],
  })).filter(item => item.value > 0);
  const allocated = allocation.reduce((sum, item) => sum + item.value, 0);

  if (isLoading) return <LoadingState />;

  return (
    <main className="dashboard-layout" style={{ padding: 24, color: '#f8fafc' }}>
      <header style={{ marginBottom: 20 }}>
        <p style={{ color: '#38bdf8', textTransform: 'uppercase', letterSpacing: 2, fontSize: '.72rem', fontWeight: 800 }}>Authoritative suitability portfolio</p>
        <h1 style={{ marginBottom: 8 }}>Your Financial Command Center</h1>
        <p style={{ color: '#94a3b8' }}>All instruments, ranking, and weights below came from the server-owned Financial Profile boundary.</p>
      </header>

      {fallbackNotice && (
        <div role="alert" style={{ padding: 14, background: 'rgba(190,24,93,.12)', border: '1px solid rgba(251,113,133,.3)', borderRadius: 12, marginBottom: 16 }}>
          <strong>{fallbackNotice.message}</strong>{fallbackNotice.detail ? ` — ${fallbackNotice.detail}` : ''}
          {onDismissFallbackNotice && <button type="button" onClick={onDismissFallbackNotice} style={{ float: 'right' }}>Dismiss</button>}
        </div>
      )}

      <section className="profile-summary-bar" style={{ marginBottom: 22 }}>
        <div className="profile-summary-item"><div className="summary-number">₹{Number(profile.monthly_take_home).toLocaleString('en-IN')}</div><div className="summary-label">Monthly take-home</div></div>
        <div className="profile-summary-item"><div className="summary-number">₹{Number(profile.monthly_savings).toLocaleString('en-IN')}</div><div className="summary-label">Savings capacity</div></div>
        <div className="profile-summary-item"><div className="summary-number">{profile.risk_tolerance}</div><div className="summary-label">Risk preference</div></div>
        <div className="profile-summary-item"><div className="summary-number">{profile.investment_horizon_years} years</div><div className="summary-label">Horizon</div></div>
      </section>

      {!recommendations.length ? <EmptyState notice={fallbackNotice} /> : (
        <>
          <section style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,.75fr) minmax(360px,1.25fr)', gap: 18, marginBottom: 24 }}>
            <article className="panel-card" style={{ minHeight: 340 }}>
              <h2 className="panel-title">Monthly allocation</h2>
              <div style={{ height: 250 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={allocation} dataKey="value" nameKey="name" innerRadius={58} outerRadius={94} paddingAngle={2}>
                      {allocation.map(item => <Cell key={item.name} fill={item.color} />)}
                    </Pie>
                    <Tooltip formatter={value => `₹${Number(value).toLocaleString('en-IN')}/month`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ textAlign: 'center', color: allocated === Number(profile.monthly_savings) ? '#4ade80' : '#fbbf24' }}>
                ₹{allocated.toLocaleString('en-IN')} of ₹{Number(profile.monthly_savings).toLocaleString('en-IN')} allocated
              </div>
            </article>
            <article className="panel-card">
              <h2 className="panel-title">Architecture guarantees</h2>
              <div style={{ display: 'grid', gap: 13, color: '#cbd5e1', lineHeight: 1.55 }}>
                <div><ShieldCheck size={17} color="#4ade80" /> Final suitability never exceeds your stated risk preference.</div>
                <div><Wallet size={17} color="#38bdf8" /> Monthly allocations stay within the declared monthly savings capacity.</div>
                <div><Info size={17} color="#a78bfa" /> Returns are pre-tax nominal estimates. Gross income and tax data were not inferred.</div>
                <div><Zap size={17} color="#fbbf24" /> Sold-property proceeds are not treated as investable capital.</div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                <button type="button" className="btn-portal btn-portal-primary" onClick={onRebalance}><Zap size={15} /> Rebalance</button>
                <button type="button" className="btn-portal btn-portal-secondary" onClick={onExploreAll}><BarChart3 size={15} /> Compare</button>
              </div>
            </article>
          </section>

          <section>
            <h2>Ranked recommendations</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16 }}>
              {recommendations.map((instrument, index) => {
                const reasons = getWhy(instrument);
                const open = expanded[instrument.id];
                return (
                  <article id={`rec-card-${instrument.id}`} key={instrument.id} className="rec-card" style={{ padding: 20, borderTop: `2px solid ${instrument.color || '#38bdf8'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div><small style={{ color: '#64748b' }}>Rank #{index + 1}</small><h3>{instrument.name}</h3></div>
                      <span style={{ color: RISK_COLORS[instrument.riskLabel] || '#fbbf24' }}>{instrument.riskLabel}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div className="stat-box"><small>Pre-tax nominal</small><div>{Number(instrument.nominalReturn).toFixed(2)}%</div></div>
                      <div className="stat-box"><small>Monthly allocation</small><div>₹{Number(instrument.monthly_allocation).toLocaleString('en-IN')}</div></div>
                      <div className="stat-box"><small>Portfolio weight</small><div>{(Number(instrument.allocationWeight) * 100).toFixed(1)}%</div></div>
                      <div className="stat-box"><small>Lock-in</small><div>{Number(instrument.lockIn) ? `${instrument.lockIn} years` : 'None'}</div></div>
                    </div>
                    <button type="button" onClick={() => setExpanded(previous => ({ ...previous, [instrument.id]: !open }))} style={{ marginTop: 14, background: 'none', border: 0, color: '#38bdf8', cursor: 'pointer' }}>
                      {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Why this passed
                    </button>
                    {open && <ol style={{ color: '#94a3b8' }}>{reasons.map(reason => <li key={reason}>{reason}</li>)}</ol>}
                    {onLearnMore && <button type="button" onClick={() => onLearnMore(instrument)} className="btn-portal btn-portal-secondary">View details</button>}
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}
      <SebiDisclaimer />
    </main>
  );
}
