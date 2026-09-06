import React, { useCallback, useEffect, useState } from 'react';
import profileImg from '../assets/gen_4k_nobull.png';
import * as api from '../services/api';
import FinancialProfileForm from './FinancialProfileForm';
import { normalizeFinancialProfile } from '../utils/financialProfile';
import '../App.css';

export default function ProfilePage({ children }) {
  const [profile, setProfile] = useState(null);
  const [restoring, setRestoring] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleProfileUpdate = useCallback(updated => {
    setProfile(normalizeFinancialProfile(updated));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api.getCurrentProfile({ signal: controller.signal })
      .then(handleProfileUpdate)
      .catch(requestError => {
        if (requestError?.status !== 404 && requestError?.code !== 'REQUEST_ABORTED') setError(requestError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRestoring(false);
      });
    return () => controller.abort();
  }, [handleProfileUpdate]);

  const createProfile = async draft => {
    setSaving(true);
    setError('');
    try {
      handleProfileUpdate(await api.buildProfile(draft));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  if (restoring) return <div role="status" className="route-loading">Loading your secure financial profile…</div>;
  if (profile?.profileId) {
    return React.cloneElement(children, { userProfile: profile, onProfileUpdate: handleProfileUpdate });
  }

  return (
    <main className="profile-page" style={{ minHeight: '100vh', display: 'flex', background: '#020617' }}>
      <section className="profile-content" style={{ width: 'min(720px,100%)', padding: '28px', overflowY: 'auto', zIndex: 2 }}>
        <h1 className="profile-page-title">Create Your <span className="gradient-text">Financial Profile</span></h1>
        <p style={{ color: '#94a3b8', lineHeight: 1.6 }}>
          These are the only facts WealthGenie uses for suitability and investment personalization. Tax details remain a separate explicit calculation.
        </p>
        {error && <div role="alert" style={{ color: '#fecdd3', marginBottom: 12 }}>{error}</div>}
        <div className="profile-form-card" style={{ padding: 22 }}>
          <FinancialProfileForm onSubmit={createProfile} busy={saving} submitLabel="Save and Continue" />
        </div>
      </section>
      <aside className="profile-side-image" style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
        <img src={profileImg} alt="Abstract financial planning illustration" className="profile-img-element" />
        <div className="profile-img-overlay" />
      </aside>
    </main>
  );
}
