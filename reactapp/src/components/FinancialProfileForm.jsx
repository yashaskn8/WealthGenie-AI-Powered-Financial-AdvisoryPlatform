import { useEffect, useState } from 'react';
import {
  EMPTY_FINANCIAL_PROFILE,
  INVESTMENT_GOALS,
  RISK_TOLERANCES,
  normalizeFinancialProfile,
  validateFinancialProfile,
} from '../utils/financialProfile';

const integerFields = new Set(['age', 'financial_dependents', 'investment_horizon_years']);

function NumericInput({ field, value, onChange, min, max, placeholder, prefix = false, testId }) {
  const input = (
    <input
      data-testid={testId || `profile-input-${field}`}
      type="number"
      min={min}
      max={max}
      step={integerFields.has(field) ? 1 : 'any'}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={event => onChange(field, event.target.value)}
    />
  );
  return prefix ? <div className="pf-input-prefix"><span className="prefix-symbol">₹</span>{input}</div> : input;
}

export default function FinancialProfileForm({
  initialProfile,
  onSubmit,
  onDraftChange,
  submitLabel = 'Save Financial Profile',
  busy = false,
}) {
  const [draft, setDraft] = useState(() => normalizeFinancialProfile(initialProfile || EMPTY_FINANCIAL_PROFILE));
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  const setField = (key, value) => setDraft(previous => ({ ...previous, [key]: value }));
  const toggleGoal = goal => setDraft(previous => ({
    ...previous,
    investment_goals: previous.investment_goals.includes(goal)
      ? previous.investment_goals.filter(item => item !== goal)
      : [...previous.investment_goals, goal],
  }));

  const submit = async event => {
    event.preventDefault();
    const validation = validateFinancialProfile(draft);
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }
    setErrors([]);
    await onSubmit(normalizeFinancialProfile(draft));
  };

  return (
    <form id="profile-form" onSubmit={submit} noValidate>
      {errors.length > 0 && (
        <div role="alert" className="profile-validation-alert">
          {errors.map(error => <div key={error}>{error}</div>)}
        </div>
      )}

      <div className="pf-grid-2">
        <div className="pf-field">
          <label>Monthly Take-Home (₹) <span className="required-mark">Required</span></label>
          <NumericInput field="monthly_take_home" value={draft.monthly_take_home} onChange={setField} min="0.01" max="100000000" placeholder="65000" prefix />
          <small className="pf-help">Net monthly amount—never CTC or gross salary.</small>
        </div>
        <div className="pf-field">
          <label>Monthly Savings Capacity (₹) <span className="required-mark">Required</span></label>
          <NumericInput field="monthly_savings" value={draft.monthly_savings} onChange={setField} min="0.01" max="100000000" placeholder="12000" prefix />
          <small className="pf-help">Maximum recurring amount available to invest.</small>
        </div>
      </div>

      <div className="pf-grid-2">
        <div className="pf-field">
          <label>Age <span className="required-mark">Required</span></label>
          <NumericInput field="age" value={draft.age} onChange={setField} min="18" max="80" placeholder="32" />
        </div>
        <div className="pf-field">
          <label>Risk Tolerance <span className="required-mark">Required</span></label>
          <div className="risk-toggle-group">
            {RISK_TOLERANCES.map(level => (
              <button key={level} type="button" className={`risk-toggle-btn ${draft.risk_tolerance === level ? 'active' : ''}`}
                aria-pressed={draft.risk_tolerance === level} onClick={() => setField('risk_tolerance', level)}>
                {level}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="pf-grid-2">
        <div className="pf-field">
          <label>Sold Property Proceeds (₹) <span className="optional-mark">Optional</span></label>
          <NumericInput field="sold_property_proceeds" value={draft.sold_property_proceeds} onChange={setField} min="0" max="10000000000" placeholder="Leave blank" prefix />
          <small className="pf-help">Context only—never added to deployable capital.</small>
        </div>
        <div className="pf-field">
          <label>Has Lump Sum to Invest? <span className="optional-mark">Optional</span></label>
          <div className="risk-toggle-group">
            {[[false, 'No'], [true, 'Yes'], [null, 'Skip']].map(([value, label]) => (
              <button key={label} data-testid={`profile-lump-sum-${label.toLowerCase()}`} type="button"
                className={`risk-toggle-btn ${draft.has_lump_sum === value ? 'active' : ''}`}
                aria-pressed={draft.has_lump_sum === value}
                onClick={() => setDraft(previous => ({
                  ...previous,
                  has_lump_sum: value,
                  lump_sum_amount: value === true ? '' : value === false ? '0' : null,
                }))}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="pf-grid-2">
        <div className="pf-field">
          <label>Liquid Savings (₹) <span className="optional-mark">Optional</span></label>
          <NumericInput field="liquid_savings" value={draft.liquid_savings} onChange={setField} min="0" max="1000000000" placeholder="Leave blank" prefix />
        </div>
        <div className="pf-field">
          <label>EMI Burden (% of Take-Home) <span className="optional-mark">Optional</span></label>
          <NumericInput field="emi_burden_pct" value={draft.emi_burden_pct} onChange={setField} min="0" max="100" placeholder="Leave blank" />
        </div>
      </div>

      <div className="pf-grid-2">
        <div className="pf-field">
          <label>Financial Dependents <span className="optional-mark">Optional</span></label>
          <NumericInput field="financial_dependents" value={draft.financial_dependents} onChange={setField} min="0" max="15" placeholder="Leave blank" />
        </div>
        <div className="pf-field">
          <label>Emergency Fund (Months) <span className="optional-mark">Optional</span></label>
          <NumericInput field="emergency_fund_months" value={draft.emergency_fund_months} onChange={setField} min="0" max="120" placeholder="Leave blank" />
        </div>
      </div>

      {draft.has_lump_sum === true && (
        <div className="pf-field pf-field-full">
          <label>Deployable Lump Sum Amount (₹) <span className="required-mark">Required when Yes</span></label>
          <NumericInput field="lump_sum_amount" testId="profile-input-lump_sum_amount" value={draft.lump_sum_amount} onChange={setField} min="1" max="10000000000" placeholder="200000" prefix />
        </div>
      )}

      <div className="pf-field pf-field-full">
        <label>Investment Goals <span className="required-mark">Required</span></label>
        <div className="goal-checkbox-group">
          {INVESTMENT_GOALS.map(goal => (
            <label key={goal} className="goal-checkbox">
              <input type="checkbox" checked={draft.investment_goals.includes(goal)} onChange={() => toggleGoal(goal)} />
              <span className="goal-checkmark" />
              <span className="goal-label-text">{goal}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="pf-field pf-field-full">
        <label>Investment Horizon <span className="required-mark">Required</span></label>
        <div className="horizon-slider-container">
          <input data-testid="profile-input-investment_horizon_years" type="range" min="1" max="30"
            value={draft.investment_horizon_years || 1}
            onChange={event => setField('investment_horizon_years', event.target.value)}
            className="horizon-slider"
            style={{ '--slider-pct': `${((Number(draft.investment_horizon_years || 1) - 1) / 29) * 100}%` }} />
          <div className="horizon-labels"><span>1</span><span className="horizon-value">{draft.investment_horizon_years || '—'} Years</span><span>30</span></div>
        </div>
      </div>

      <div className="profile-submit-row">
        <button data-testid="profile-save" disabled={busy} type="submit" className="btn-save-continue">
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
