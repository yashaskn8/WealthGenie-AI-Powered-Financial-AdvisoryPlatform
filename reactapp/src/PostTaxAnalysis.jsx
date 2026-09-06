import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { computePostTaxReturnBatch } from './services/api';
import { normalizeFinancialProfile } from './utils/financialProfile';
import './PostTaxAnalysis.css';

export default function PostTaxAnalysis({ profile, recommendations = [] }) {
  const financialProfile = normalizeFinancialProfile(profile);
  const [grossAnnualIncome, setGrossAnnualIncome] = useState('');
  const [regime, setRegime] = useState('');
  const [incomeSource, setIncomeSource] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const calculate = async event => {
    event.preventDefault();
    const income = Number(grossAnnualIncome);
    if (!(income >= 0) || !regime || !incomeSource) {
      setError('Enter gross annual income, income source, and tax regime. These values are not inferred from the Financial Profile.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const instruments = recommendations.map(instrument => ({
        instrumentType: instrument.type,
        nominalRate: Number(instrument.nominalReturn) / 100,
        holdingYears: Number(financialProfile.investment_horizon_years),
        monthlySIP: Number(instrument.monthly_allocation),
      }));
      const response = await computePostTaxReturnBatch(
        instruments, income, regime, Number(financialProfile.age), incomeSource,
      );
      setResults(response.results || []);
    } catch (requestError) {
      setError(requestError.message);
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="post-tax-page" style={{ padding: 28, maxWidth: 1000, margin: '0 auto', color: '#f8fafc' }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}><ShieldCheck color="#38bdf8" /> Separate Tax What-If</h1>
        <p style={{ color: '#94a3b8', lineHeight: 1.6 }}>
          Tax data is deliberately separate from your Financial Profile. Enter genuine gross annual taxable income; WealthGenie never converts monthly take-home into gross income.
        </p>
      </header>
      <form onSubmit={calculate} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14, padding: 20, background: 'rgba(15,23,42,.6)', borderRadius: 14 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          Gross annual taxable income (₹)
          <input type="number" min="0" value={grossAnnualIncome} onChange={event => setGrossAnnualIncome(event.target.value)} style={{ padding: 11, borderRadius: 8 }} />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          Income source
          <select value={incomeSource} onChange={event => setIncomeSource(event.target.value)} style={{ padding: 11, borderRadius: 8 }}>
            <option value="">Choose explicitly</option><option value="salary">Salary</option><option value="pension">Pension</option><option value="family_pension">Family pension</option><option value="business">Business</option><option value="other">Other</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          Tax regime
          <select value={regime} onChange={event => setRegime(event.target.value)} style={{ padding: 11, borderRadius: 8 }}>
            <option value="">Choose explicitly</option>
            <option value="new">New regime</option>
            <option value="old">Old regime</option>
          </select>
        </label>
        <button type="submit" className="hud-profile-btn" disabled={loading}>{loading ? 'Calculating…' : 'Calculate explicit tax what-if'}</button>
      </form>
      {error && <p role="alert" style={{ color: '#fda4af' }}>{error}</p>}
      {results && (
        <section style={{ marginTop: 24, display: 'grid', gap: 10 }}>
          <h2>Estimated instrument impact</h2>
          {recommendations.map((instrument, index) => {
            const result = results[index];
            return (
              <article key={instrument.id} style={{ padding: 16, border: '1px solid rgba(148,163,184,.2)', borderRadius: 12 }}>
                <strong>{instrument.name}</strong>
                <div style={{ color: '#94a3b8', marginTop: 6 }}>
                  Nominal: {Number(instrument.nominalReturn).toFixed(2)}% · Estimated post-tax: {result?.error ? 'Unavailable' : `${(Number(result?.postTaxReturn) * 100).toFixed(2)}%`}
                </div>
              </article>
            );
          })}
          <small style={{ color: '#64748b' }}>Classification: SEPARATE_TAX_WHAT_IF. This does not modify investment suitability or stored recommendations.</small>
        </section>
      )}
    </main>
  );
}
