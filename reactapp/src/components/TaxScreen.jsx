import { useMemo, useState } from 'react';
import { Calculator, Info, Receipt } from 'lucide-react';
import * as api from '../services/api';
import { investmentDatabase } from '../investmentDatabase';
import { normalizeFinancialProfile } from '../utils/financialProfile';
import { formatINR } from '../utils/indianNumberFormat';
import './TaxScreen.css';

const deductionFields = [
  ['section80C', 'Section 80C already claimed'],
  ['nps80CCD1B', 'NPS 80CCD(1B) already claimed'],
  ['section80D_self', 'Section 80D — self/family'],
  ['section80D_parents', 'Section 80D — parents'],
  ['hra', 'Eligible HRA exemption'],
  ['homeLoanInterest', 'Eligible home-loan interest'],
  ['other', 'Other eligible deductions'],
];

export default function TaxScreen({ profile: sourceProfile, onLearnMore }) {
  const profile = normalizeFinancialProfile(sourceProfile);
  const [grossAnnualIncome, setGrossAnnualIncome] = useState('');
  const [incomeSource, setIncomeSource] = useState('salary');
  const [deductions, setDeductions] = useState(() => Object.fromEntries(deductionFields.map(([key]) => [key, ''])));
  const [parentsSenior, setParentsSenior] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const calculate = async event => {
    event.preventDefault();
    const income = Number(grossAnnualIncome);
    if (!(income > 0)) {
      setError('Enter actual gross annual taxable income. It is not inferred from monthly take-home.');
      return;
    }
    const payload = Object.fromEntries(Object.entries(deductions).map(([key, value]) => [key, value === '' ? 0 : Number(value)]));
    if (Object.values(payload).some(value => !Number.isFinite(value) || value < 0)) {
      setError('Deduction values must be non-negative numbers.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      setResult(await api.compareTax(income, {
        ...payload,
        incomeSource,
        parents_senior: parentsSenior,
        age: Number(profile.age),
      }));
    } catch (requestError) {
      setResult(null);
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const taxReferences = useMemo(() => investmentDatabase.filter(item => ['eee', 'elss', 'nps'].includes(item.taxType)), []);

  return <main className="tax-screen" style={{ padding: 28, maxWidth: 1000, margin: '0 auto', color: '#f8fafc' }}>
    <header><p style={{ color: '#38bdf8' }}><Calculator size={16} /> Isolated tax calculator</p><h1>Compare tax regimes</h1><p style={{ color: '#94a3b8' }}>Tax facts are entered here for this calculation only. They are not stored in or fed back into the Financial Profile, risk engine, ranking, portfolio, or projection paths.</p></header>
    <form onSubmit={calculate} style={{ display: 'grid', gap: 14, marginTop: 22 }}>
      <label>Gross annual taxable income (₹)<input aria-label="Gross annual taxable income" type="number" min="1" value={grossAnnualIncome} onChange={event => setGrossAnnualIncome(event.target.value)} /></label>
      <label>Income source<select aria-label="Income source" value={incomeSource} onChange={event => setIncomeSource(event.target.value)}><option value="salary">Salary</option><option value="pension">Pension</option><option value="family_pension">Family pension</option><option value="business">Business</option><option value="other">Other</option></select></label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12 }}>{deductionFields.map(([key, label]) => <label key={key}>{label} (₹)<input type="number" min="0" value={deductions[key]} onChange={event => setDeductions(current => ({ ...current, [key]: event.target.value }))} /></label>)}</div>
      <label><input type="checkbox" checked={parentsSenior} onChange={event => setParentsSenior(event.target.checked)} /> Parents are senior citizens for Section 80D limits</label>
      {error && <div role="alert" style={{ color: '#fecdd3' }}>{error}</div>}
      <button type="submit" disabled={loading} className="btn-portal btn-portal-primary">{loading ? 'Calculating…' : 'Calculate from explicit tax facts'}</button>
    </form>
    {result && <section style={{ marginTop: 24 }}><h2><Receipt size={18} /> Server calculation</h2><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
      <article className="panel-card"><h3>Old regime</h3><p>Tax: {formatINR(result.old_regime.tax)}</p><p>Taxable income: {formatINR(result.old_regime.taxable_income)}</p></article>
      <article className="panel-card"><h3>New regime</h3><p>Tax: {formatINR(result.new_regime.tax)}</p><p>Taxable income: {formatINR(result.new_regime.taxable_income)}</p></article>
      <article className="panel-card"><h3>Lower calculated tax</h3><p>{result.recommended_regime === 'old' ? 'Old regime' : 'New regime'}</p><p>Difference: {formatINR(result.saving)}</p></article>
    </div></section>}
    <section style={{ marginTop: 26 }}><h2><Info size={18} /> Generic tax-product characteristics</h2><p style={{ color: '#94a3b8' }}>These catalogue references are not personalized product endorsements. Use the authoritative portfolio flow for suitability.</p><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>{taxReferences.map(item => <article key={item.id} className="panel-card"><h3>{item.name}</h3><p>{item.desc}</p>{onLearnMore && <button type="button" onClick={() => onLearnMore(item)}>View catalogue details</button>}</article>)}</div></section>
  </main>;
}
