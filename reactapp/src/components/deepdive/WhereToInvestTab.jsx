import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building2, ExternalLink, LoaderCircle } from 'lucide-react';
import WHERE_TO_INVEST from '../../whereToInvest';
import * as api from '../../services/api';
import SebiDisclaimer from '../SebiDisclaimer';

const PRESENTATION_FIELDS = ['id', 'name', 'provider', 'platform', 'minInvestment', 'tenure', 'highlight', 'badge'];

function pickPresentation(candidate) {
  return Object.fromEntries(PRESENTATION_FIELDS
    .filter(key => candidate?.[key] !== undefined)
    .map(key => [key, candidate[key]]));
}

export default function WhereToInvestTab({ inv, userProfile }) {
  const profileId = userProfile?.profileId;
  const curated = WHERE_TO_INVEST[inv?.id] || null;
  const groups = curated?.sectors || curated?.subCategories || null;
  const groupKeys = useMemo(() => groups ? Object.keys(groups) : [], [groups]);
  const [activeGroup, setActiveGroup] = useState(groupKeys[0] || null);
  const [state, setState] = useState({ requestKey: null, products: [], error: '' });
  const candidates = useMemo(() => {
    const source = groups && activeGroup ? groups[activeGroup] : curated?.products;
    return Array.isArray(source) ? source.map(pickPresentation) : [];
  }, [activeGroup, curated, groups]);
  const requestKey = useMemo(
    () => JSON.stringify({ profileId, instrumentId: inv?.id, candidates }),
    [candidates, inv?.id, profileId],
  );

  useEffect(() => {
    if (!profileId || !inv?.id || candidates.length === 0) {
      return undefined;
    }
    const controller = new AbortController();
    api.rankInvestmentCandidates(profileId, inv.id, candidates, { signal: controller.signal })
      .then(result => setState({ requestKey, products: Array.isArray(result?.products) ? result.products : [], error: '' }))
      .catch(error => {
        if (error?.code !== 'REQUEST_ABORTED') {
          setState({ requestKey, products: [], error: 'Authoritative provider verification is unavailable. No provider ranking is shown.' });
        }
      });
    return () => controller.abort();
  }, [candidates, inv?.id, profileId, requestKey]);

  const missingPrerequisite = !profileId
    ? 'A saved Financial Profile is required for server-side suitability verification.'
    : (candidates.length === 0 ? 'No curated provider options are available for this catalog instrument.' : '');
  const loading = !missingPrerequisite && state.requestKey !== requestKey;
  const products = state.requestKey === requestKey ? state.products : [];
  const error = missingPrerequisite || (state.requestKey === requestKey ? state.error : '');

  return <section className="tab-fade-in" style={{ padding: 24 }}>
    <h3>Server-verified provider options</h3>
    <p style={{ color: '#94a3b8' }}>Provider order is curated presentation data. Eligibility, risk, horizon, and financial values are verified against the same server-side parent instrument used by the recommendation.</p>
    {groupKeys.length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>{groupKeys.map(key => <button type="button" key={key} onClick={() => setActiveGroup(key)} aria-pressed={activeGroup === key}>{key.replace(/_/g, ' ')}</button>)}</div>}
    {loading && <p role="status"><LoaderCircle size={16} /> Verifying with the recommendation boundary…</p>}
    {error && <p role="alert" style={{ color: '#fecaca' }}><AlertTriangle size={16} /> {error}</p>}
    <div className="wti-grid">{products.map((product, index) => <article className="wti-item" key={product.id || `${product.name}:${index}`}>
      <div className="wti-rank">{index + 1}</div>
      <div className="wti-card-body">
        <h4 className="wti-name">{product.name}</h4>
        {product.badge && <span className="wti-badge">{product.badge}</span>}
        <p>{product.highlight}</p>
        <p><Building2 size={13} /> {product.provider || product.platform || 'Provider details unavailable'}</p>
        <p><strong>Parent nominal assumption:</strong> {Number.isFinite(Number(product.nominalReturn)) ? `${product.nominalReturn}%` : 'Unavailable'} ({product.returnBasis || 'basis unavailable'})</p>
        <p><strong>Verified risk:</strong> {product.riskLevel || 'Unavailable'} · <strong>Suitability score:</strong> {Number.isFinite(Number(product.score)) ? product.score : 'Unavailable'}</p>
        {product.investmentRoute && <p><ExternalLink size={13} /> {product.investmentRoute}</p>}
      </div>
    </article>)}</div>
    <SebiDisclaimer />
  </section>;
}
