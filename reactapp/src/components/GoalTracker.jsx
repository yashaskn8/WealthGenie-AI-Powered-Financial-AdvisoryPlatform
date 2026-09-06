import { useCallback, useEffect, useState } from 'react';
import { Plus, Target, Trash2 } from 'lucide-react';
import * as api from '../services/api';
import { normalizeFinancialProfile } from '../utils/financialProfile';
import { submitGoal } from '../utils/goalSubmission';
import { GoalForm } from './GoalForm';
import { formatINR } from '../utils/indianNumberFormat';
import './GoalTracker.css';

export default function GoalTracker({ profile: sourceProfile }) {
  const profile = normalizeFinancialProfile(sourceProfile);
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const hasProfile = Boolean(profile.profileId);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.getGoals();
      setGoals(response.goals || []);
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async form => {
    setSaving(true);
    const result = await submitGoal(api, { ...form, profileId: profile.profileId });
    if (result.success) {
      setGoals(current => [...current, result.goal]);
      setShowForm(false);
      setError('');
    } else setError(result.error);
    setSaving(false);
  };

  const remove = async goalId => {
    try {
      await api.deleteGoal(goalId);
      setGoals(current => current.filter(goal => (goal._id || goal.goalId) !== goalId));
    } catch (requestError) { setError(requestError.message); }
  };

  return <main className="goal-tracker-container" style={{ padding: 28, maxWidth: 1000, margin: '0 auto', color: '#f8fafc' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}><div><p style={{ color: '#38bdf8' }}><Target size={16} /> Separate goal-planning workspace</p><h1>Goal Tracker</h1><p style={{ color: '#94a3b8' }}>Custom names, targets, dates, and current savings affect only feasibility calculations. They never overwrite the four core Financial Profile goals.</p></div><button type="button" disabled={!hasProfile} onClick={() => setShowForm(value => !value)} className="btn-portal btn-portal-primary"><Plus /> Add custom goal</button></header>
    {!hasProfile && <div role="alert" style={{ color: '#fecdd3', margin: '14px 0' }}>Save a complete Financial Profile before creating a custom goal.</div>}
    {error && <div role="alert" style={{ color: '#fecdd3', margin: '14px 0' }}>{error}</div>}
    {showForm && <GoalForm onSubmitGoal={create} onCancel={() => setShowForm(false)} loading={saving} />}
    {loading ? <div role="status">Loading goals…</div> : <section style={{ display: 'grid', gap: 14, marginTop: 20 }}>{goals.map(goal => {
      const id = goal._id || goal.goalId;
      const p50 = goal.monte_carlo_summary?.p50;
      return <article key={id} className="panel-card" style={{ padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><div><h2>{goal.goal_name}</h2><p>{goal.priority} priority · target {new Date(goal.target_date).toLocaleDateString('en-IN')}</p></div><button type="button" onClick={() => remove(id)} aria-label={`Delete ${goal.goal_name}`}><Trash2 /></button></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}><div>Target<br /><strong>{formatINR(goal.target_amount)}</strong></div><div>Inflation-adjusted target<br /><strong>{formatINR(goal.inflation_adjusted_target)}</strong></div><div>Required monthly SIP<br /><strong>{formatINR(goal.recommended_sip)}</strong></div><div>Median simulation<br /><strong>{Number.isFinite(Number(p50)) ? formatINR(p50) : 'Unavailable'}</strong></div></div>
        <p style={{ color: '#94a3b8' }}>Classification: {goal.simulation_classification} · return basis: {goal.return_basis} · inflation assumption: {(Number(goal.inflation_assumption) * 100).toFixed(1)}%</p>
        {goal.gemini_advice && <p>{goal.gemini_advice}</p>}
      </article>;
    })}{!goals.length && <p>No custom goals yet.</p>}</section>}
  </main>;
}
