import { ShieldCheck, Wallet, Target, Info } from 'lucide-react';
import { normalizeFinancialProfile } from './utils/financialProfile';
import './InsightsScreen.css';

export default function InsightsScreen({ profile: sourceProfile, recommendations = [] }) {
  const profile = normalizeFinancialProfile(sourceProfile);
  const savingsRate = Number(profile.monthly_savings) / Number(profile.monthly_take_home) * 100;
  const allocated = recommendations.reduce((sum, item) => sum + Number(item.monthly_allocation || 0), 0);
  const cards = [
    { icon: Wallet, title: 'Declared savings capacity', body: `₹${Number(profile.monthly_savings).toLocaleString('en-IN')} per month (${savingsRate.toFixed(1)}% of take-home). No income was inferred.` },
    { icon: ShieldCheck, title: 'Suitability authority', body: `${recommendations.length} instruments passed the server-owned risk, eligibility, horizon, liquidity, and concentration checks.` },
    { icon: Target, title: 'Core goals', body: profile.investment_goals.join(', ') },
    { icon: Info, title: 'Capital separation', body: `Recurring allocation: ₹${allocated.toLocaleString('en-IN')}/month. Initial capital: ${profile.has_lump_sum ? `₹${Number(profile.lump_sum_amount).toLocaleString('en-IN')}` : 'none declared'}. Sold-property proceeds are excluded.` },
  ];
  return <main className="insights-page"><header className="insights-header"><h1>Profile-grounded insights</h1><p>Facts below come from the canonical Financial Profile and authoritative recommendation response; no live-market or tax claim is invented.</p></header><section className="insights-grid">{cards.map(({ icon: Icon, title, body }) => <article className="insight-card" key={title}><Icon color="#38bdf8" /><h2>{title}</h2><p>{body}</p></article>)}</section></main>;
}
