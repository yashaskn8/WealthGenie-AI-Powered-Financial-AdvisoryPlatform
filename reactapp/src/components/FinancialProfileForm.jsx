import { useState } from 'react';
import {
  EMPTY_FINANCIAL_PROFILE,
  INVESTMENT_GOALS,
  RISK_TOLERANCES,
  normalizeFinancialProfile,
  validateFinancialProfile,
} from '../utils/financialProfile';

const fieldStyle = {
  display: 'grid', gap: 6, color: '#cbd5e1', fontSize: '0.84rem', fontWeight: 600,
};
const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10,
  border: '1px solid rgba(148,163,184,.28)', background: 'rgba(15,23,42,.72)',
  color: '#f8fafc', font: 'inherit', outline: 'none',
};

const numericFields = [
  ['monthly_take_home', 'Monthly take-home (₹)', 1000, 100000000, 'Net amount received each month. Do not enter CTC or gross salary.'],
  ['monthly_savings', 'Monthly savings capacity (₹)', 500, 100000000, 'Maximum recurring amount available for investing.'],
  ['age', 'Age', 18, 80, 'Whole years.'],
  ['sold_property_proceeds', 'Sold-property proceeds (₹)', 0, 10000000000, 'Context only. This is never added to deployable capital.'],
  ['liquid_savings', 'Liquid savings (₹)', 0, 1000000000, 'Cash and immediately accessible savings.'],
  ['emi_burden_pct', 'EMI burden (% of take-home)', 0, 100, 'All monthly EMIs as a percentage of take-home.'],
  ['financial_dependents', 'Financial dependents', 0, 15, 'People financially dependent on this income.'],
  ['emergency_fund_months', 'Emergency-fund coverage (months)', 0, 120, 'Actual months covered; no assumed value is inserted.'],
  ['investment_horizon_years', 'Investment horizon (years)', 1, 30, 'Maximum horizon for personalized projections.'],
];

export default function FinancialProfileForm({ initialProfile, onSubmit, submitLabel = 'Save Financial Profile', busy = false }) {
  const [draft, setDraft] = useState(() => normalizeFinancialProfile(initialProfile || EMPTY_FINANCIAL_PROFILE));
  const [errors, setErrors] = useState([]);

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
    <form onSubmit={submit} noValidate style={{ display: 'grid', gap: 18 }}>
      {errors.length > 0 && (
        <div role="alert" style={{ padding: 12, borderRadius: 10, border: '1px solid #fb7185', color: '#fecdd3', background: 'rgba(190,24,93,.12)' }}>
          {errors.map(error => <div key={error}>{error}</div>)}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 14 }}>
        {numericFields.map(([key, label, min, max, help]) => (
          <label key={key} style={fieldStyle}>
            <span>{label}</span>
            <input
              data-testid={`profile-input-${key}`}
              style={inputStyle}
              type="number"
              min={min}
              max={max}
              step={['age', 'financial_dependents', 'investment_horizon_years'].includes(key) ? 1 : 'any'}
              value={draft[key]}
              onChange={event => setField(key, event.target.value)}
            />
            <small style={{ color: '#64748b', fontWeight: 400 }}>{help}</small>
          </label>
        ))}
      </div>

      <fieldset style={{ border: '1px solid rgba(148,163,184,.2)', borderRadius: 12, padding: 14 }}>
        <legend style={{ color: '#cbd5e1', padding: '0 6px' }}>Risk tolerance</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9 }}>
          {RISK_TOLERANCES.map(risk => (
            <button key={risk} type="button" onClick={() => setField('risk_tolerance', risk)}
              aria-pressed={draft.risk_tolerance === risk}
              style={{ ...inputStyle, width: 'auto', cursor: 'pointer', borderColor: draft.risk_tolerance === risk ? '#38bdf8' : inputStyle.border.split(' ').at(-1), color: draft.risk_tolerance === risk ? '#38bdf8' : '#cbd5e1' }}>
              {risk}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset style={{ border: '1px solid rgba(148,163,184,.2)', borderRadius: 12, padding: 14 }}>
        <legend style={{ color: '#cbd5e1', padding: '0 6px' }}>Investment goals</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9 }}>
          {INVESTMENT_GOALS.map(goal => (
            <button key={goal} type="button" onClick={() => toggleGoal(goal)}
              aria-pressed={draft.investment_goals.includes(goal)}
              style={{ ...inputStyle, width: 'auto', cursor: 'pointer', borderColor: draft.investment_goals.includes(goal) ? '#a78bfa' : inputStyle.border.split(' ').at(-1), color: draft.investment_goals.includes(goal) ? '#c4b5fd' : '#cbd5e1' }}>
              {goal}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset style={{ border: '1px solid rgba(148,163,184,.2)', borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
        <legend style={{ color: '#cbd5e1', padding: '0 6px' }}>One-time capital</legend>
        <label style={{ ...fieldStyle, display: 'flex', alignItems: 'center', flexDirection: 'row' }}>
          <input type="checkbox" checked={draft.has_lump_sum} onChange={event => {
            setDraft(previous => ({
              ...previous,
              has_lump_sum: event.target.checked,
              lump_sum_amount: event.target.checked ? '' : '0',
            }));
          }} />
          I have a separate lump sum available to invest
        </label>
        {draft.has_lump_sum && (
          <label style={fieldStyle}>
            <span>Deployable lump sum amount (₹)</span>
            <input data-testid="profile-input-lump_sum_amount" style={inputStyle} type="number" min="1" max="10000000000"
              value={draft.lump_sum_amount} onChange={event => setField('lump_sum_amount', event.target.value)} />
          </label>
        )}
      </fieldset>

      <button data-testid="profile-save" disabled={busy} type="submit" className="hud-profile-btn"
        style={{ width: '100%', padding: 13, cursor: busy ? 'wait' : 'pointer' }}>
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
