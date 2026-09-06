import { useEffect, useState } from 'react';
import { Info, MapPin, X } from 'lucide-react';
import WhereToInvestTab from './deepdive/WhereToInvestTab';
import './DeepDiveModal.css';

function displayNumber(value, suffix = '') {
  const number = Number(value);
  return Number.isFinite(number) ? `${number}${suffix}` : 'Unavailable';
}

export default function DeepDiveModal({ isOpen, onClose, investment, userProfile }) {
  const [tab, setTab] = useState('details');

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = event => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !investment) return null;

  return <div className="modal-overlay" onClick={onClose}>
    <div className="ddm-content" role="dialog" aria-modal="true" aria-labelledby="deepdive-modal-title" onClick={event => event.stopPropagation()}>
      <div className="ddm-sticky-header">
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>
        <div className="ddm-header-top">
          <span className="premium-badge">{investment.assetClass || investment.category || 'Catalog instrument'}</span>
          <h2 id="deepdive-modal-title" className="ddm-title">{investment.name}</h2>
          <p style={{ color: '#94a3b8', margin: '8px 0 0' }}>Financial values shown here come from the authoritative recommendation and catalog. This modal does not recalculate suitability.</p>
        </div>
        <div className="ddm-quick-metrics">
          <div className="metric-item"><span className="metric-label">Suitability risk</span><span className="metric-value">{investment.riskLabel || 'Unavailable'}</span></div>
          <div className="metric-item"><span className="metric-label">Nominal return assumption</span><span className="metric-value">{displayNumber(investment.nominalReturn, '%')}</span></div>
          <div className="metric-item"><span className="metric-label">Return basis</span><span className="metric-value">{investment.returnBasis || 'Unavailable'}</span></div>
          <div className="metric-item"><span className="metric-label">Lock-in</span><span className="metric-value">{Number.isFinite(Number(investment.lockIn)) ? `${investment.lockIn} years` : 'Unavailable'}</span></div>
        </div>
        <div className="ddm-tabs-nav">
          <button type="button" className={`ddm-tab-btn ${tab === 'details' ? 'ddm-tab-btn--active' : ''}`} onClick={() => setTab('details')}><Info size={16} /> Details</button>
          <button type="button" className={`ddm-tab-btn ${tab === 'wti' ? 'ddm-tab-btn--active' : ''}`} onClick={() => setTab('wti')}><MapPin size={16} /> Where to invest</button>
        </div>
      </div>
      <div className="ddm-scroll-container">
        {tab === 'details' ? <section className="tab-fade-in" style={{ padding: 24 }}>
          <h3>Authoritative instrument details</h3>
          <p style={{ color: '#cbd5e1', lineHeight: 1.7 }}>{investment.description || investment.desc || 'No catalog description is available.'}</p>
          {Array.isArray(investment.goalTags) && investment.goalTags.length > 0 && <p><strong>Catalog goal tags:</strong> {investment.goalTags.join(', ')}</p>}
          {Array.isArray(investment.pros) && investment.pros.length > 0 && <div><h4>Catalog advantages</h4><ul>{investment.pros.map(item => <li key={item}>{item}</li>)}</ul></div>}
          {Array.isArray(investment.cons) && investment.cons.length > 0 && <div><h4>Catalog limitations</h4><ul>{investment.cons.map(item => <li key={item}>{item}</li>)}</ul></div>}
          <p style={{ color: '#94a3b8' }}>Tax treatment is general catalog information only. Personalized post-tax results require explicit gross-income and deduction inputs in the isolated tax calculator.</p>
        </section> : <WhereToInvestTab inv={investment} userProfile={userProfile} />}
      </div>
    </div>
  </div>;
}
