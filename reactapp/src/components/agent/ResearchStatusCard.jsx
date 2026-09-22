import React from 'react';
import { ExternalLink, SearchCheck } from 'lucide-react';

function statusLabel(entry) {
  return entry?.value?.supportStatus || 'UNVERIFIED';
}

export default function ResearchStatusCard({ evidenceEntries = [] }) {
  const researchEntries = evidenceEntries.filter(entry => String(entry?.id || '').startsWith('E_RESEARCH_'));
  if (researchEntries.length === 0) return null;
  const hasConflict = researchEntries.some(entry => ['CONTRADICTED', 'CONFLICTING'].includes(statusLabel(entry)));
  const heading = hasConflict ? 'Conflicting public evidence' : 'Verified public research';
  return (
    <section className="ap-research-card" aria-labelledby="research-status-title">
      <div className="ap-research-card-heading">
        <div className="ap-research-card-icon" aria-hidden="true"><SearchCheck size={17} /></div>
        <div>
          <span className="ap-eyebrow">RESEARCHMESH · READ-ONLY</span>
          <h3 id="research-status-title">{heading}</h3>
        </div>
        <span className={`ap-research-status ${hasConflict ? 'is-conflict' : 'is-supported'}`}>
          {hasConflict ? 'CONFLICTING' : 'SUPPORTED'}
        </span>
      </div>
      <p className="ap-research-card-copy">Public evidence is shown with its claim and source binding. It does not change your allocation, suitability result, or saved plan.</p>
      <div className="ap-research-claims">
        {researchEntries.slice(0, 4).map(entry => (
          <article className="ap-research-claim" key={entry.id}>
            <div className="ap-research-claim-meta">
              <span>{statusLabel(entry)}</span>
              <code>{entry.value?.claimId || entry.id}</code>
            </div>
            <p>{entry.displayValue || 'Research claim unavailable.'}</p>
            {entry.source?.url && (
              <a href={entry.source.url} target="_blank" rel="noreferrer" className="ap-research-source">
                {entry.source.provider || 'Source'}{entry.source.publicationDate ? ` · ${new Date(entry.source.publicationDate).toLocaleDateString('en-IN')}` : ''}
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
