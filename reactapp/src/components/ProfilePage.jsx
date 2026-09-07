import React, { useState, useMemo, useCallback, useEffect } from 'react';
import profileImg from '../assets/gen_4k_nobull.png';
import * as api from '../services/api';
import { normalizeFinancialProfile, validateFinancialProfile } from '../utils/financialProfile';
import '../App.css';

const ProfilePage = ({ onCompleteProfile: _onCompleteProfile, children }) => {
  // Sensitive profile data is restored from the authenticated backend and held in memory only.
  const savedProfile = null;

  const [isComplete, setIsComplete] = useState(false);
  const [isRestoringProfile, setIsRestoringProfile] = useState(true);
  const [age, setAge] = useState(savedProfile?.age ?? '');
  const [monthlySavings, setMonthlySavings] = useState(savedProfile?.monthly_savings ?? '');
  const [investmentGoals, setInvestmentGoals] = useState(savedProfile?.investment_goals || []);
  const [horizon, setHorizon] = useState(savedProfile?.investment_horizon_years ?? '');
  const [profileId, setProfileId] = useState(savedProfile?.profileId || null);
  const [version, setVersion] = useState(savedProfile?.version || null);

  // Canonical Financial Profile facts. Empty optional values remain unknown.
  const [monthlyTakeHome, setMonthlyTakeHome] = useState(savedProfile?.monthly_take_home ?? '');
  const [soldPropertyAmount, setSoldPropertyAmount] = useState(savedProfile?.sold_property_proceeds ?? '');
  const [hasLumpSum, setHasLumpSum] = useState(savedProfile?.has_lump_sum ?? null);
  const [lumpSumAmount, setLumpSumAmount] = useState(savedProfile?.lump_sum_amount ?? '');

  const [liquidSavings, setLiquidSavings] = useState(savedProfile?.liquid_savings ?? '');
  const [existingDebt, setExistingDebt] = useState(savedProfile?.emi_burden_pct ?? '');
  const [dependents, setDependents] = useState(savedProfile?.financial_dependents ?? '');
  const [emergencyFundMonths, setEmergencyFundMonths] = useState(savedProfile?.emergency_fund_months ?? '');
  const [riskTolerance, setRiskTolerance] = useState(savedProfile?.risk_tolerance || '');

  const toggleGoal = (goal) => {
    setInvestmentGoals((prev) =>
      prev.includes(goal) ? prev.filter((g) => g !== goal) : [...prev, goal]
    );
  };

  const userProfilePayload = useMemo(() => ({
    age,
    monthly_take_home: monthlyTakeHome,
    monthly_savings: monthlySavings,
    investment_goals: investmentGoals,
    investment_horizon_years: horizon,
    profileId,
    version,
    liquid_savings: liquidSavings,
    emi_burden_pct: existingDebt,
    financial_dependents: dependents,
    emergency_fund_months: emergencyFundMonths,
    risk_tolerance: riskTolerance,
    sold_property_proceeds: soldPropertyAmount,
    has_lump_sum: hasLumpSum,
    lump_sum_amount: hasLumpSum === true ? lumpSumAmount : hasLumpSum === false ? 0 : '',
  }), [
    age, monthlySavings, investmentGoals, horizon, profileId, version,
    liquidSavings, existingDebt, dependents, emergencyFundMonths, riskTolerance,
    monthlyTakeHome, soldPropertyAmount, hasLumpSum, lumpSumAmount,
  ]);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    const validation = validateFinancialProfile(userProfilePayload);
    if (!validation.valid) {
      alert(validation.errors.join('\n'));
      return;
    }

    try {
      const response = await api.buildProfile(validation.profile);
      const nextProfileId = response.profileId || null;
      setProfileId(nextProfileId);
      const nextVersion = response.version || null;
      setVersion(nextVersion);
      const profileWithUser = normalizeFinancialProfile({ ...response, profileId: nextProfileId, version: nextVersion });
      handleProfileUpdate(profileWithUser);
      setIsComplete(true);
    } catch (err) {
      alert("Error saving profile: " + err.message);
    }
  };

  // Called from DashboardShell when profile is updated inline
  const handleProfileUpdate = useCallback((updatedProfile) => {
    const profile = normalizeFinancialProfile(updatedProfile);
    setAge(profile.age);
    setMonthlyTakeHome(profile.monthly_take_home);
    setMonthlySavings(profile.monthly_savings);
    setInvestmentGoals(profile.investment_goals);
    setHorizon(profile.investment_horizon_years);
    setLiquidSavings(profile.liquid_savings);
    setExistingDebt(profile.emi_burden_pct);
    setDependents(profile.financial_dependents);
    setEmergencyFundMonths(profile.emergency_fund_months);
    setRiskTolerance(profile.risk_tolerance);
    setSoldPropertyAmount(profile.sold_property_proceeds);
    setHasLumpSum(profile.has_lump_sum);
    setLumpSumAmount(profile.lump_sum_amount);
    setVersion(profile.version);
    if (profile.profileId) setProfileId(profile.profileId);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api.getCurrentProfile({ signal: controller.signal })
      .then(restoredProfile => {
        handleProfileUpdate(restoredProfile);
        setIsComplete(true);
      })
      .catch(error => {
        if (error?.status !== 404 && error?.code !== 'REQUEST_ABORTED') {
          console.warn('[Profile] Secure profile restore failed:', error.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsRestoringProfile(false);
      });
    return () => controller.abort();
  }, [handleProfileUpdate]);

  if (isRestoringProfile) {
    return <div role="status" aria-live="polite" className="route-loading">Loading your secure financial profile...</div>;
  }

  if (isComplete) {
    return React.cloneElement(children, {
      userProfile: userProfilePayload,
      onProfileUpdate: handleProfileUpdate
    });
  }

  return (
    <main
      className="profile-page"
      style={{
        height: '100vh',
        width: '100vw',
        maxHeight: '100vh',
        overflow: 'hidden',
        display: 'flex',
        background: '#020617',
        position: 'relative',
      }}
    >
      {/* Form content on the left */}
      <div
        className="profile-content"
        role="region"
        aria-label="Financial profile form"
        tabIndex={0}
        style={{
          height: '100vh',
          maxHeight: '100vh',
          width: '45%',
          padding: '20px 28px 20px 32px',
          boxSizing: 'border-box',
          position: 'relative',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <h1 className="profile-page-title" style={{ marginBottom: '14px', textAlign: 'center', fontSize: '1.85rem' }}>
          Create Your <span className="gradient-text">Financial Profile</span>
        </h1>
        <div
          className="profile-form-card"
          data-testid="profile-form-card"
          style={{
            flex: 1,
            overflowY: 'auto',
            maxHeight: 'calc(100vh - 100px)',
            padding: '16px 20px 24px 20px',
            marginBottom: '10px',
            scrollbarWidth: 'thin',
            scrollbarColor: '#38bdf8 rgba(15,23,42,0.8)',
          }}
        >
          {/* Profile Summary Quick Badge */}
          <div className="profile-summary-badge">
            <div>
              <span className="summary-label">Take-Home</span>
              <strong className="summary-value take-home">₹{Number(monthlyTakeHome || 0).toLocaleString('en-IN')}/mo</strong>
            </div>
            <div>
              <span className="summary-label">Emergency Fund</span>
              <strong className="summary-value ef">
                {emergencyFundMonths === '' || emergencyFundMonths === null ? 'Not provided' : `${emergencyFundMonths} Months`}
              </strong>
            </div>
            <div>
              <span className="summary-label">Lump Sum Deployment</span>
              <strong className={`summary-value ${hasLumpSum ? 'lump-active' : 'lump-none'}`}>
                {hasLumpSum === true ? `₹${Number(lumpSumAmount || 0).toLocaleString('en-IN')}` : hasLumpSum === false ? 'None' : 'Not provided'}
              </strong>
            </div>
          </div>

          <form id="profile-form" onSubmit={handleSaveProfile}>
            {/* Income & Take Home */}
            <div className="pf-grid-2">
              <div className="pf-field">
                <label>Monthly Take-Home (₹)</label>
                <div className="pf-input-prefix">
                  <span className="prefix-symbol">₹</span>
                  <input 
                    type="number" 
                    placeholder="65000" 
                    value={monthlyTakeHome ?? ''} 
                    onChange={e => {
                      let val = e.target.value.replace(/^0+/, '');
                      let num = val === '' ? '' : Number(val);
                      setMonthlyTakeHome(num);
                    }} 
                  />
                </div>
              </div>
              <div className="pf-field">
                <label>Monthly Savings Capacity (₹)</label>
                <div className="pf-input-prefix">
                  <span className="prefix-symbol">₹</span>
                  <input 
                    type="number" 
                    placeholder="12000" 
                    value={monthlySavings ?? ''} 
                    onChange={e => {
                      let val = e.target.value.replace(/^0+/, '');
                      if (val === '') {
                        setMonthlySavings('');
                      } else {
                        let num = Number(val);
                        if (num > 100000000) num = 100000000;
                        setMonthlySavings(num);
                      }
                    }} 
                  />
                </div>
              </div>
            </div>

            {/* Age & Risk Appetite */}
            <div className="pf-grid-2">
              <div className="pf-field">
                <label>Age</label>
                <input 
                  type="number" 
                  placeholder="32" 
                  value={age ?? ''} 
                  onChange={e => {
                    let val = e.target.value.replace(/^0+/, '');
                    setAge(val === '' ? '' : Number(val));
                  }} 
                  min="18" 
                  max="80" 
                />
              </div>
              <div className="pf-field">
                <label>Risk Tolerance</label>
                <div className="risk-toggle-group">
                  {['Conservative', 'Moderate', 'Aggressive'].map((level) => (
                    <button
                      key={level}
                      type="button"
                      className={`risk-toggle-btn ${riskTolerance === level ? 'active' : ''}`}
                      onClick={() => setRiskTolerance(level)}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* One-Time Capital & Liquidity */}
            <div className="pf-grid-2">
              <div className="pf-field">
                <label>Sold Property Proceeds (₹)</label>
                <div className="pf-input-prefix">
                  <span className="prefix-symbol">₹</span>
                  <input 
                    type="number" 
                    placeholder="2000000" 
                    value={soldPropertyAmount ?? ''} 
                    onChange={e => {
                      let val = e.target.value.replace(/^0+/, '');
                      setSoldPropertyAmount(val === '' ? '' : Number(val));
                    }} 
                  />
                </div>
              </div>
              <div className="pf-field">
                <label>Has Lump Sum to Invest?</label>
                <div className="risk-toggle-group">
                  <button
                    type="button"
                    className={`risk-toggle-btn ${hasLumpSum === false ? 'active' : ''}`}
                    onClick={() => {
                      setHasLumpSum(false);
                      setLumpSumAmount(0);
                    }}
                  >
                    No
                  </button>
                  <button
                    type="button"
                    className={`risk-toggle-btn ${hasLumpSum === true ? 'active' : ''}`}
                    onClick={() => setHasLumpSum(true)}
                  >
                    Yes
                  </button>
                </div>
              </div>
            </div>

            {/* Liquid Savings & Debt EMI % */}
            <div className="pf-grid-2">
              <div className="pf-field">
                <label>Liquid Savings (₹)</label>
                <div className="pf-input-prefix">
                  <span className="prefix-symbol">₹</span>
                  <input 
                    type="number" 
                    placeholder="50000" 
                    value={liquidSavings ?? ''} 
                    onChange={e => {
                      let val = e.target.value.replace(/^0+/, '');
                      setLiquidSavings(val === '' ? '' : Number(val));
                    }} 
                  />
                </div>
              </div>
              <div className="pf-field">
                <label>Monthly EMI Burden (%)</label>
                <input 
                  type="number" 
                  placeholder="0" 
                  value={existingDebt ?? ''} 
                  onChange={e => {
                    let val = e.target.value.replace(/^0+/, '');
                    let num = val === '' ? '' : Number(val);
                    if (num > 100) num = 100;
                    setExistingDebt(num);
                  }} 
                  min="0"
                  max="100"
                />
              </div>
            </div>

            {/* Dependents & Emergency Fund Months */}
            <div className="pf-grid-2">
              <div className="pf-field">
                <label>Financial Dependents</label>
                <input 
                  type="number" 
                  placeholder="0" 
                  value={dependents ?? ''} 
                  onChange={e => {
                    let val = e.target.value.replace(/^0+/, '');
                    setDependents(val === '' ? '' : Number(val));
                  }} 
                  min="0"
                  max="20"
                />
              </div>
              <div className="pf-field">
                <label>Emergency Fund (Months)</label>
                <input 
                  type="number" 
                  placeholder="6" 
                  value={emergencyFundMonths ?? ''} 
                  onChange={e => {
                    let val = e.target.value.replace(/^0+/, '');
                    setEmergencyFundMonths(val === '' ? '' : Number(val));
                  }} 
                  min="0"
                  max="60"
                />
              </div>
            </div>

            {/* Conditional Lump Sum Amount & Action button */}
            {hasLumpSum && (
              <div className="pf-field pf-field-full" style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                  <label>Lump Sum Investment Amount (₹)</label>
                </div>
                <div className="pf-input-prefix">
                  <span className="prefix-symbol">₹</span>
                  <input 
                    type="number" 
                    placeholder="2000000" 
                    value={lumpSumAmount ?? ''} 
                    onChange={e => {
                      let val = e.target.value.replace(/^0+/, '');
                      setLumpSumAmount(val === '' ? '' : Number(val));
                    }} 
                  />
                </div>
              </div>
            )}

            {/* Row 3: Goal Checkboxes */}
            <div className="pf-field pf-field-full">
              <label>Investment Goal</label>
              <div className="goal-checkbox-group">
                {['Retirement', 'Wealth Growth', 'Tax Saving', 'Emergency Fund'].map((goal) => (
                  <label key={goal} className="goal-checkbox">
                    <input
                      type="checkbox"
                      checked={investmentGoals.includes(goal)}
                      onChange={() => toggleGoal(goal)}
                    />
                    <span className="goal-checkmark"></span>
                    <span className="goal-label-text">{goal}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Row 4: Horizon Slider */}
            <div className="pf-field pf-field-full">
              <label>Investment Horizon</label>
              <div className="horizon-slider-container">
                <input
                  type="range"
                  min="1"
                  max="30"
                  value={horizon || 1}
                  onChange={(e) => setHorizon(Number(e.target.value))}
                  className="horizon-slider"
                  style={{ '--slider-pct': `${(((Number(horizon) || 1) - 1) / 29) * 100}%` }}
                />
                <div className="horizon-labels">
                  <span>1</span>
                  <span className="horizon-value">{horizon || '—'} {horizon === 1 ? 'Year' : 'Years'}</span>
                  <span>30</span>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '24px', marginBottom: '8px' }}>
              <button
                data-testid="profile-save"
                type="submit"
                className="btn-save-continue"
                style={{
                  padding: '14px',
                  fontSize: '0.98rem',
                  fontWeight: '700',
                  cursor: 'pointer',
                  display: 'block',
                  width: '100%',
                  margin: 0,
                }}
              >
                Save and Continue
              </button>
            </div>
          </form>
        </div>
      </div>
      
      {/* Right image pane */}
      <div
        className="profile-side-image"
        style={{
          width: '55%',
          height: '100vh',
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <img src={profileImg} alt="Financial Profile" className="profile-img-element" />
        <div className="profile-img-overlay"></div>
      </div>

    </main>
  );
};

export default ProfilePage;
