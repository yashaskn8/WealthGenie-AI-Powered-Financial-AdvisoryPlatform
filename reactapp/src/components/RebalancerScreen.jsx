import { useMemo, useState } from 'react';
import { CheckCircle2, Scale, ShieldCheck } from 'lucide-react';
import { normalizeFinancialProfile } from '../utils/financialProfile';
import './RebalancerScreen.css';

function initialWeights(recommendations) {
  const rows = (recommendations || []).filter(item => Number(item.monthly_allocation) > 0);
  const supplied = rows.map(item => Number(item.allocationWeight));
  const suppliedTotal = supplied.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  return Object.fromEntries(rows.map((item, index) => [
    item.id,
    suppliedTotal > 0 ? supplied[index] / suppliedTotal * 100 : Number(item.monthly_allocation),
  ]));
}

function rebalanceOtherWeights(current, changedId, requestedPct) {
  const ids = Object.keys(current);
  const nextValue = Math.max(0, Math.min(100, requestedPct));
  const otherIds = ids.filter(id => id !== changedId);
  const remaining = 100 - nextValue;
  const otherTotal = otherIds.reduce((sum, id) => sum + current[id], 0);
  const next = { ...current, [changedId]: nextValue };
  otherIds.forEach(id => {
    next[id] = otherTotal > 0 ? current[id] / otherTotal * remaining : remaining / otherIds.length;
  });
  return next;
}

export default function RebalancerScreen({ profile: sourceProfile, recommendations = [], onSave }) {
  const profile = normalizeFinancialProfile(sourceProfile);
  const active = useMemo(
    () => recommendations.filter(item => item.id && Number(item.monthly_allocation) > 0),
    [recommendations],
  );
  const [weights, setWeights] = useState(() => initialWeights(recommendations));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);

  const save = async () => {
    if (Math.abs(total - 100) > 0.01) {
      setError('Portfolio weights must total exactly 100%.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(active.map(item => ({
        ...item,
        allocationWeight: weights[item.id] / 100,
        monthly_allocation: Math.round(Number(profile.monthly_savings) * weights[item.id] / 100),
      })));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  if (!active.length) {
    return <main className="rebalancer-page"><h1>No authoritative portfolio to rebalance</h1><p>Generate a suitable portfolio first.</p></main>;
  }

  return (
    <main className="rebalancer-page" style={{ padding: 28, maxWidth: 960, margin: '0 auto', color: '#f8fafc' }}>
      <header style={{ marginBottom: 24 }}>
        <p style={{ color: '#38bdf8', textTransform: 'uppercase', letterSpacing: 2 }}><Scale size={15} /> Guarded rebalancer</p>
        <h1>Adjust existing suitable instruments</h1>
        <p style={{ color: '#94a3b8' }}>Only instruments already approved by the server can be weighted here. The server rechecks eligibility, risk ceiling, horizon, liquidity, and concentration caps before saving.</p>
      </header>
      {error && <div role="alert" style={{ color: '#fecdd3', marginBottom: 14 }}>{error}</div>}
      <section style={{ display: 'grid', gap: 14 }}>
        {active.map(item => {
          const weight = weights[item.id] ?? 0;
          return (
            <article key={item.id} className="panel-card" style={{ padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                <div><strong>{item.name}</strong><div style={{ color: '#94a3b8' }}>{item.riskLabel} risk · {item.returnBasis === 'PRE_TAX_NOMINAL' ? 'pre-tax nominal' : 'return basis unavailable'}</div></div>
                <strong>{weight.toFixed(1)}% · ₹{Math.round(Number(profile.monthly_savings) * weight / 100).toLocaleString('en-IN')}/mo</strong>
              </div>
              <input aria-label={`${item.name} weight`} type="range" min="0" max="100" step="0.5" value={weight}
                onChange={event => setWeights(current => rebalanceOtherWeights(current, item.id, Number(event.target.value)))} style={{ width: '100%', marginTop: 12 }} />
            </article>
          );
        })}
      </section>
      <footer style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: Math.abs(total - 100) <= 0.01 ? '#4ade80' : '#fb7185' }}><ShieldCheck size={16} /> Total {total.toFixed(2)}%</span>
        <button type="button" className="btn-portal btn-portal-primary" disabled={saving} onClick={save}><CheckCircle2 size={16} /> {saving ? 'Validating…' : 'Validate and save'}</button>
      </footer>
    </main>
  );
}
