import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Banknote, Wallet, Scale, Target, Telescope, Save, Pencil, X, Check, Users, CreditCard, ShieldCheck, PiggyBank } from 'lucide-react';
import * as api from './services/api';
import { normalizeFinancialProfile, validateFinancialProfile } from './utils/financialProfile';

const GOALS_OPTIONS = ['Retirement', 'Wealth Growth', 'Tax Saving', 'Emergency Fund'];


const ProfileEditor = ({ userProfile, onProfileUpdate }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);

  const safeProfile = React.useMemo(() => normalizeFinancialProfile(userProfile || {}), [userProfile]);

  const [draft, setDraft] = useState(safeProfile);

  React.useEffect(() => {
    setDraft(safeProfile);
  }, [safeProfile]);

  const savingsRate = Number(draft.monthly_take_home) > 0
    ? ((Number(draft.monthly_savings) / Number(draft.monthly_take_home)) * 100).toFixed(0)
    : 0;

  const profileFields = [
    { key: 'age', label: 'Age', icon: <Clock size={20} color="#94a3b8" />, type: 'number', min: 18, max: 80, help: 'Whole years, used as an explicit suitability constraint.' },
    { key: 'monthly_take_home', label: 'Monthly Take-Home', icon: <Banknote size={20} color="#34d399" />, type: 'currency', min: 0.01, max: 100000000, help: 'Net monthly amount received—never CTC or gross salary.' },
    { key: 'monthly_savings', label: 'Monthly Savings Capacity', icon: <Wallet size={20} color="#38bdf8" />, type: 'currency', min: 0.01, max: 100000000, help: 'Maximum recurring amount available to invest monthly.' },
    { key: 'risk_tolerance', label: 'Risk Tolerance', icon: <Scale size={20} color="#fbbf24" />, type: 'tolerance', help: 'Your comfort with short-term market ups and downs. This drives investment mix.' },
    { key: 'investment_goals', label: 'Investment Goals', icon: <Target size={20} color="#fb7185" />, type: 'goals', help: 'The main reasons why you are building wealth.' },
    { key: 'investment_horizon_years', label: 'Investment Horizon', icon: <Telescope size={20} color="#a78bfa" />, type: 'slider', min: 1, max: 30, suffix: ' years', help: 'Maximum horizon for personalized projections.' },
    { key: 'sold_property_proceeds', label: 'Sold Property Proceeds', icon: <Banknote size={20} color="#a78bfa" />, type: 'currency', min: 0, max: 10000000000, help: 'Context only—never added to deployable capital.' },
    { key: 'has_lump_sum', label: 'Deployable Lump Sum', icon: <Wallet size={20} color="#a78bfa" />, type: 'lump-sum', help: 'Only an explicitly declared amount is treated as one-time investment capital.' },
    { key: 'liquid_savings', label: 'Liquid Savings', icon: <PiggyBank size={20} color="#34d399" />, type: 'currency', min: 0, max: 1000000000, help: 'Savings held in liquid accounts or bank balances.' },
    { key: 'emi_burden_pct', label: 'Monthly EMI Burden (%)', icon: <CreditCard size={20} color="#f87171" />, type: 'number', min: 0, max: 100, suffix: '%', help: 'Total monthly loan EMIs divided by monthly take-home, multiplied by 100.' },
    { key: 'financial_dependents', label: 'Financial Dependents', icon: <Users size={20} color="#fbbf24" />, type: 'number', min: 0, max: 15, help: 'People financially dependent on this income.' },
    { key: 'emergency_fund_months', label: 'Emergency Fund Coverage', icon: <ShieldCheck size={20} color="#38bdf8" />, type: 'number', min: 0, max: 120, suffix: ' months', help: 'Actual months covered; blank remains unknown.' },
  ];

  const handleEdit = () => {
    setDraft(safeProfile);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setDraft(safeProfile);
    setIsEditing(false);
  };

  const handleSave = async () => {
    const validation = validateFinancialProfile(draft);
    if (!validation.valid) {
      alert(validation.errors.join('\n'));
      return;
    }

    setIsSaving(true);
    try {
      const profileId = userProfile?._id || userProfile?.profileId || draft.profileId || draft._id;
      let response;
      const payload = { ...validation.profile, version: draft.version };

      if (profileId) {
        response = await api.updateProfile(profileId, payload);
      } else {
        response = await api.buildProfile(payload);
      }
      onProfileUpdate(normalizeFinancialProfile({
        ...response,
        profileId: response?.profileId || profileId || null,
        version: response?.version || draft.version,
      }));
      setIsEditing(false);
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2500);
    } catch (err) {
      alert("Error updating profile: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleGoal = (goal) => {
    setDraft(prev => {
      const currentGoals = Array.isArray(prev?.investment_goals) ? prev.investment_goals : [];
      return {
        ...prev,
        investment_goals: currentGoals.includes(goal)
          ? currentGoals.filter(g => g !== goal)
          : [...currentGoals, goal]
      };
    });
  };

  const renderValue = (field) => {
    const val = draft[field.key];
    if (field.type === 'currency') return val === '' || val === null ? 'Not provided' : `₹${Number(val).toLocaleString('en-IN')}`;
    if (field.type === 'goals') return Array.isArray(val) && val.length ? val.join(', ') : 'Not provided';
    if (field.type === 'slider') return val === '' || val === null ? 'Not provided' : `${val}${field.suffix || ''}`;
    if (field.type === 'lump-sum') return val === true ? `Yes — ₹${Number(draft.lump_sum_amount || 0).toLocaleString('en-IN')}` : val === false ? 'No' : 'Not provided';
    return val === '' || val === null ? 'Not provided' : val;
  };

  const renderEditField = (field) => {
    const val = draft[field.key];

    if (field.type === 'number' || field.type === 'currency') {
      return (
        <input
          data-testid={`profile-input-${field.key}`}
          type="number"
          value={val ?? ''}
          min={field.min}
          max={field.max}
          onChange={e => {
            let raw = e.target.value.replace(/^0+/, '');
            let num = raw === '' ? '' : Number(raw);
            // Clamp to max if defined
            if (field.max !== undefined && num !== '' && num > field.max) num = field.max;
            setDraft(prev => ({ ...prev, [field.key]: num }));
          }}
          style={{
            background: 'rgba(15, 23, 42, 0.6)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: 10,
            padding: '10px 14px',
            color: '#f8fafc',
            fontSize: '1.05rem',
            fontWeight: 600,
            fontFamily: 'inherit',
            outline: 'none',
            width: '100%',
            boxSizing: 'border-box',
            transition: 'border-color 0.2s',
          }}
          onFocus={e => e.target.style.borderColor = '#38bdf8'}
          onBlur={e => e.target.style.borderColor = 'rgba(56, 189, 248, 0.3)'}
        />
      );
    }




    if (field.type === 'tolerance') {
      const options = ['Conservative', 'Moderate', 'Aggressive'];
      return (
        <div style={{ display: 'flex', gap: 8 }}>
          {options.map(o => (
            <button
              key={o}
              onClick={() => setDraft(prev => ({ ...prev, risk_tolerance: o }))}
              style={{
                flex: 1,
                padding: '9px 14px',
                borderRadius: 10,
                border: val === o ? '1.5px solid #38bdf8' : '1px solid rgba(255,255,255,0.08)',
                background: val === o ? 'linear-gradient(135deg, rgba(56,189,248,0.15), rgba(139,92,246,0.1))' : 'rgba(15,23,42,0.4)',
                color: val === o ? '#38bdf8' : '#94a3b8',
                fontWeight: val === o ? 700 : 500,
                fontSize: '0.85rem',
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.2s',
              }}
            >
              {o}
            </button>
          ))}
        </div>
      );
    }

    if (field.type === 'lump-sum') {
      return (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: draft.has_lump_sum === true ? 8 : 0 }}>
            {[[false, 'No'], [true, 'Yes'], [null, 'Skip']].map(([choice, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setDraft(prev => ({
                  ...prev,
                  has_lump_sum: choice,
                  lump_sum_amount: choice === true ? prev.lump_sum_amount : choice === false ? 0 : '',
                }))}
                style={{
                  flex: 1, padding: '9px 14px', borderRadius: 10,
                  border: val === choice ? '1.5px solid #a78bfa' : '1px solid rgba(255,255,255,0.08)',
                  background: val === choice ? 'rgba(167,139,250,0.15)' : 'rgba(15,23,42,0.4)',
                  color: val === choice ? '#a78bfa' : '#94a3b8', fontWeight: val === choice ? 700 : 500,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >{label}</button>
            ))}
          </div>
          {draft.has_lump_sum === true && (
            <input
              data-testid="profile-input-lump_sum_amount"
              type="number"
              min="1"
              max="10000000000"
              value={draft.lump_sum_amount ?? ''}
              onChange={e => setDraft(prev => ({ ...prev, lump_sum_amount: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="Deployable amount"
              style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: 10, padding: '10px 14px', color: '#f8fafc', fontSize: '1.05rem', fontWeight: 600, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }}
            />
          )}
        </div>
      );
    }
    if (field.type === 'goals') {
      const goalsArray = Array.isArray(val) ? val : [];
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {GOALS_OPTIONS.map(g => {
            const active = goalsArray.includes(g);
            return (
              <button
                key={g}
                onClick={() => toggleGoal(g)}
                style={{
                  padding: '7px 14px',
                  borderRadius: 10,
                  border: active ? '1.5px solid #fb7185' : '1px solid rgba(255,255,255,0.08)',
                  background: active ? 'rgba(251,113,133,0.12)' : 'rgba(15,23,42,0.4)',
                  color: active ? '#fb7185' : '#94a3b8',
                  fontWeight: active ? 700 : 500,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.2s',
                }}
              >
                {active && <Check size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />}
                {g}
              </button>
            );
          })}
        </div>
      );
    }

    if (field.type === 'slider') {
      const sliderValue = Number(val) || field.min;
      const pct = ((sliderValue - field.min) / (field.max - field.min)) * 100;
      const unitLabel = field.suffix ? (val === 1 ? field.suffix.replace(/s$/, '') : field.suffix) : '';
      return (
        <div>
          <input
            type="range"
            min={field.min}
            max={field.max}
            value={sliderValue}
            onChange={e => setDraft(prev => ({ ...prev, [field.key]: Number(e.target.value) }))}
            style={{
              width: '100%',
              accentColor: '#38bdf8',
              background: `linear-gradient(to right, #38bdf8 0%, #38bdf8 ${pct}%, rgba(255,255,255,0.08) ${pct}%, rgba(255,255,255,0.08) 100%)`,
              borderRadius: 6,
              height: 6,
              cursor: 'pointer',
            }}
            className="tax-slider"
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748b', marginTop: 6, marginBottom: 0 }}>
            <span>{field.min}</span>
            <span style={{ color: '#38bdf8', fontWeight: 700 }}>{val || '—'}{unitLabel}</span>
            <span>{field.max}</span>
          </div>
        </div>
      );
    }


    return <span style={{ color: '#f8fafc', fontWeight: 600 }}>{val}</span>;
  };

  const basicFields = profileFields.filter(f => ['age', 'monthly_take_home', 'monthly_savings', 'investment_goals'].includes(f.key));
  const advancedFields = profileFields.filter(f => !basicFields.includes(f));

  return (
    <div style={{ padding: '40px 28px', maxWidth: 960, margin: '0 auto', color: '#fff', position: 'relative' }}>
      <div className="profile-mesh-bg" />

      {/* Header */}
      <motion.div
        style={{ position: 'relative', zIndex: 2, marginBottom: 12 }}
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', color: '#38bdf8', marginBottom: 8, opacity: 0.9 }}>
          FINANCIAL COMMAND CENTER
        </div>
        <h1 className="page-title" style={{ fontSize: '2.4rem', marginBottom: 6 }}>
          My <span style={{
            background: 'linear-gradient(135deg, #38bdf8, #a78bfa)',
            WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent'
          }}>Profile</span>
        </h1>
        <p className="page-title-sub" style={{ marginBottom: 0, fontSize: '0.95rem' }}>
          Your personalized wealth parameters driving AI recommendations
        </p>
      </motion.div>

      {/* Summary Stats Bar */}
      <motion.div
        className="profile-summary-bar"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.5 }}
      >
        <div className="profile-summary-item">
          <div className="summary-number" style={{ color: '#f43f5e' }}>₹{Number(draft.monthly_take_home || 0).toLocaleString('en-IN')}</div>
          <div className="summary-label">Monthly Take-Home</div>
        </div>
        <div className="profile-summary-item">
          <div className="summary-number" style={{ color: '#34d399' }}>{savingsRate}%</div>
          <div className="summary-label">Savings Rate</div>
        </div>
        <div className="profile-summary-item">
          <div className="summary-number" style={{ color: '#38bdf8' }}>₹{Number(draft.monthly_savings).toLocaleString('en-IN')}</div>
          <div className="summary-label">Monthly SIP Budget</div>
        </div>
        <div className="profile-summary-item">
          <div className="summary-number" style={{ color: '#a78bfa', textTransform: 'capitalize' }}>{draft.investment_horizon_years || '—'}y</div>
          <div className="summary-label">Investment Horizon</div>
        </div>
      </motion.div>

      {/* Saved toast */}
      <AnimatePresence>
        {showSaved && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            style={{
              position: 'relative', zIndex: 10, marginBottom: 16,
              background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(52, 211, 153, 0.3)',
              borderRadius: 14, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10,
              color: '#34d399', fontWeight: 600, fontSize: '0.9rem',
            }}
          >
            <Check size={18} /> Profile updated successfully! Recommendations will recalculate.
          </motion.div>
        )}
      </AnimatePresence>

      {/* Profile Card */}
      <motion.div
        className="hud-profile-card"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.35, type: "spring", stiffness: 100 }}
        style={{ maxWidth: '100%' }}
      >
        <div className="profile-section-group">
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#38bdf8', marginBottom: 14, letterSpacing: '0.5px', textTransform: 'uppercase', opacity: 0.9 }}>
            Basic Information
          </h3>
          <div className="hud-profile-grid" style={{ marginBottom: 28 }}>
            {basicFields.map((field, index) => (
              <motion.div
                key={field.key}
                className="hud-stat-box"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + (index * 0.06) }}
                style={isEditing ? { padding: '18px 20px' } : {}}
              >
                <div className="hud-stat-icon">{field.icon}</div>
                <div className="hud-stat-content" style={{ flex: 1, minWidth: 0 }}>
                  <span className="hud-stat-label">{field.label}</span>
                  {isEditing ? (
                    <>
                      {renderEditField(field)}
                      <span style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 4, display: 'block', lineHeight: 1.3 }}>{field.help}</span>
                    </>
                  ) : (
                    <>
                      <span className="hud-stat-value">{renderValue(field)}</span>
                      <span style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 4, display: 'block', lineHeight: 1.3 }}>{field.help}</span>
                    </>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="profile-section-group" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 24, marginTop: 12 }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#a78bfa', marginBottom: 14, letterSpacing: '0.5px', textTransform: 'uppercase', opacity: 0.9 }}>
            Advanced Preferences
          </h3>
          <div className="hud-profile-grid">
            {advancedFields.map((field, index) => (
              <motion.div
                key={field.key}
                className="hud-stat-box"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 + (index * 0.06) }}
                style={isEditing ? { padding: '18px 20px' } : {}}
              >
                <div className="hud-stat-icon">{field.icon}</div>
                <div className="hud-stat-content" style={{ flex: 1, minWidth: 0 }}>
                  <span className="hud-stat-label">{field.label}</span>
                  {isEditing ? (
                    <>
                      {renderEditField(field)}
                      <span style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 4, display: 'block', lineHeight: 1.3 }}>{field.help}</span>
                    </>
                  ) : (
                    <>
                      <span className="hud-stat-value">{renderValue(field)}</span>
                      <span style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 4, display: 'block', lineHeight: 1.3 }}>{field.help}</span>
                    </>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <motion.div
          style={{ display: 'flex', gap: 12, marginTop: 8 }}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.0 }}
        >
          {isEditing ? (
            <>
              <button
                data-testid="profile-save"
                className="hud-profile-btn"
                onClick={handleSave}
                disabled={isSaving}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                <Save size={16} />
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                className="hud-profile-btn"
                onClick={handleCancel}
                style={{
                  flex: 0.5,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                }}
              >
                <X size={16} /> Cancel
              </button>
            </>
          ) : (
            <button
              data-testid="profile-edit"
              className="hud-profile-btn"
              onClick={handleEdit}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <Pencil size={16} /> Edit Profile
            </button>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
};


export default ProfileEditor;
