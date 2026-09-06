import { useMemo } from 'react';
import { HeartPulse, ShieldCheck } from 'lucide-react';
import { normalizeFinancialProfile } from './utils/financialProfile';
import './HealthScoreScreen.css';

const clamp = value => Math.max(0, Math.min(100, value));

export default function HealthScoreScreen({ profile: sourceProfile, recommendations = [], onNavigate }) {
  const profile = normalizeFinancialProfile(sourceProfile);
  const metrics = useMemo(() => {
    const takeHome = Number(profile.monthly_take_home);
    const savingsRate = Number(profile.monthly_savings) / takeHome;
    const liquidityMonths = Number(profile.liquid_savings) / takeHome;
    return [
      { label: 'Savings rate', value: clamp(savingsRate / 0.30 * 100), detail: `${(savingsRate * 100).toFixed(1)}% of monthly take-home`, weight: 30 },
      { label: 'Emergency-fund coverage', value: clamp(Number(profile.emergency_fund_months) / 6 * 100), detail: `${Number(profile.emergency_fund_months)} months reported`, weight: 25 },
      { label: 'EMI resilience', value: clamp(100 - Number(profile.emi_burden_pct)), detail: `${Number(profile.emi_burden_pct)}% EMI burden`, weight: 20 },
      { label: 'Liquid-savings coverage', value: clamp(liquidityMonths / 6 * 100), detail: `${liquidityMonths.toFixed(1)} months of take-home`, weight: 15 },
      { label: 'Authoritative portfolio ready', value: recommendations.length ? 100 : 0, detail: `${recommendations.length} server-approved instruments`, weight: 10 },
    ];
  }, [profile, recommendations]);
  const score = Math.round(metrics.reduce((sum, metric) => sum + metric.value * metric.weight / 100, 0));

  if (!sourceProfile) {
    return <div role="status" aria-label="Financial Profile required">Save a complete Financial Profile to calculate this wellness indicator.</div>;
  }

  return (
    <main className="health-page" style={{ padding: 28, maxWidth: 940, margin: '0 auto', color: '#f8fafc' }}>
      <header><p style={{ color: '#38bdf8' }}><HeartPulse size={16} /> Financial wellness</p><h1>{score}/100</h1><p style={{ color: '#94a3b8' }}>A transparent wellness indicator from canonical profile facts. It is not a second risk or suitability score.</p></header>
      <section style={{ display: 'grid', gap: 14, marginTop: 24 }}>{metrics.map(metric => <article key={metric.label} className="panel-card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>{metric.label}</strong><strong>{Math.round(metric.value)}/100</strong></div>
        <progress max="100" value={metric.value} style={{ width: '100%', margin: '10px 0' }} /><div style={{ color: '#94a3b8' }}>{metric.detail} · {metric.weight}% wellness weight</div>
      </article>)}</section>
      {!recommendations.length && <button type="button" onClick={() => onNavigate?.('dashboard')} className="btn-portal btn-portal-primary" style={{ marginTop: 18 }}><ShieldCheck size={16} /> Generate guarded portfolio</button>}
    </main>
  );
}
