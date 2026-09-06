import { useMemo, useState } from 'react';
import { BarChart3, Search, X } from 'lucide-react';
import { formatINR } from './utils/recommendationPresentation';
import './ComparisonTableModal.css';

export default function ComparisonTableModal({ isOpen, onClose, allInvestments = [], embedded = false }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [selectedIds, setSelectedIds] = useState([]);
  const categories = useMemo(() => ['All', ...new Set(allInvestments.map(item => item.cat || item.category).filter(Boolean))], [allInvestments]);
  const rows = useMemo(() => allInvestments.filter(item => {
    const itemCategory = item.cat || item.category || 'Unclassified';
    const text = `${item.name || ''} ${item.abbr || ''} ${itemCategory}`.toLowerCase();
    return (category === 'All' || itemCategory === category) && text.includes(query.trim().toLowerCase());
  }), [allInvestments, category, query]);

  if (!isOpen) return null;
  return (
    <div className={embedded ? 'comparison-embedded' : 'comparison-modal-overlay'} onClick={embedded ? undefined : onClose}>
      <section className={embedded ? 'comparison-embedded-container' : 'comparison-modal-container'} onClick={event => event.stopPropagation()}>
        <header className="modal-header">
          <div><h2><BarChart3 size={18} /> Investment catalogue</h2><p>Non-recommendation comparison. A catalogue row is not a suitability endorsement.</p></div>
          {!embedded && <button type="button" onClick={onClose} aria-label="Close comparison"><X /></button>}
        </header>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '18px 0' }}>
          <label style={{ flex: 1, minWidth: 220 }}><Search size={15} /> <input aria-label="Search catalogue" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by name or category" /></label>
          <select aria-label="Filter category" value={category} onChange={event => setCategory(event.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select>
        </div>
        <div className="table-scroll">
          <table className="comparison-grid-table">
            <thead><tr><th>Instrument</th><th>Category</th><th>Catalogue nominal return</th><th>Risk classification</th><th>Lock-in</th><th>Minimum investment</th><th>Compare</th></tr></thead>
            <tbody>{rows.map(item => {
              const id = item.id;
              const nominal = item.nominalReturn ?? item.expectedReturn ?? item.rate;
              const lockIn = item.lockIn ?? item.lock_in_years;
              const minimum = item.minMonthlyInvestment ?? item.min_investment_inr;
              return <tr key={id}>
                <td><strong>{item.abbr || item.name}</strong></td>
                <td>{item.cat || item.category || 'Unclassified'}</td>
                <td>{Number.isFinite(Number(nominal)) ? `${Number(nominal).toFixed(2)}% (pre-tax nominal)` : 'Not established'}</td>
                <td>{item.riskLabel || item.risk_level || 'Not established'}</td>
                <td>{Number.isFinite(Number(lockIn)) ? (Number(lockIn) === 0 ? 'None' : `${lockIn} years`) : 'Not established'}</td>
                <td>{Number.isFinite(Number(minimum)) ? formatINR(Number(minimum)) : 'Not established'}</td>
                <td><input type="checkbox" aria-label={`Compare ${item.name}`} checked={selectedIds.includes(id)} onChange={() => setSelectedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])} /></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <p style={{ color: '#94a3b8' }}>{selectedIds.length} selected. Personalized selections and weights are available only from the authoritative recommendation and guarded rebalancer flows.</p>
      </section>
    </div>
  );
}
