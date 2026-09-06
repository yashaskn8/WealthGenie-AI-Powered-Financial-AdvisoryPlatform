import { useState } from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import * as api from './services/api';
import FinancialProfileForm from './components/FinancialProfileForm';
import { normalizeFinancialProfile } from './utils/financialProfile';

export default function ProfileEditor({ userProfile, onProfileUpdate }) {
  const profile = normalizeFinancialProfile(userProfile);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const save = async draft => {
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const response = profile.profileId
        ? await api.updateProfile(profile.profileId, { ...draft, version: profile.version })
        : await api.buildProfile(draft);
      onProfileUpdate(normalizeFinancialProfile(response));
      setSaved(true);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const savingsRate = Number(profile.monthly_take_home) > 0
    ? (Number(profile.monthly_savings) / Number(profile.monthly_take_home) * 100).toFixed(1)
    : '—';

  return (
    <main style={{ padding: '36px 28px', maxWidth: 1000, margin: '0 auto', color: '#f8fafc' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <ShieldCheck color="#38bdf8" />
        <div>
          <h1 style={{ margin: 0 }}>Financial Profile</h1>
          <p style={{ color: '#94a3b8' }}>The frozen source of truth for suitability, recommendations, projections, and Genie.</p>
        </div>
      </div>
      <div className="profile-summary-bar" style={{ margin: '18px 0' }}>
        <div className="profile-summary-item"><div className="summary-number">₹{Number(profile.monthly_take_home).toLocaleString('en-IN')}</div><div className="summary-label">Monthly take-home</div></div>
        <div className="profile-summary-item"><div className="summary-number">₹{Number(profile.monthly_savings).toLocaleString('en-IN')}</div><div className="summary-label">Monthly savings</div></div>
        <div className="profile-summary-item"><div className="summary-number">{savingsRate}%</div><div className="summary-label">Savings rate</div></div>
        <div className="profile-summary-item"><div className="summary-number">{profile.investment_horizon_years} years</div><div className="summary-label">Horizon</div></div>
      </div>
      {saved && <div role="status" style={{ color: '#34d399', marginBottom: 12 }}><Check size={16} /> Profile saved. Personalized outputs will refresh.</div>}
      {error && <div role="alert" style={{ color: '#fecdd3', marginBottom: 12 }}>{error}</div>}
      <section className="hud-profile-card" style={{ padding: 24 }}>
        <FinancialProfileForm key={`${profile.profileId}:${profile.version}`} initialProfile={profile} onSubmit={save} busy={saving} submitLabel="Save Changes" />
      </section>
    </main>
  );
}
