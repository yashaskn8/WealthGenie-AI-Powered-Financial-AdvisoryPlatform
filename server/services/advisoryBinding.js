const SUCCESS_STATUSES = new Set([
  'READY',
  'GROUNDED_EXPLANATION_AVAILABLE',
  'GROUNDED_EXPLANATION_FALLBACK',
]);

/** Verify that advisory text was generated for the exact persisted financial state. */
export function assessAdvisoryStateBinding(metadata, state) {
  const required = [
    'recommendationId',
    'profileId',
    'allocationRevision',
    'allocationRevisionId',
    'portfolioFingerprint',
    'profileInputHash',
    'recommendationFingerprint',
    'recommendationPolicyVersion',
    'regulatoryRuleVersion',
    'returnAssumptionHash',
    'profileVersion',
  ];
  if (!metadata || required.some(field => metadata[field] === null
      || metadata[field] === undefined || metadata[field] === '')) {
    return { fresh: false, reason: 'ADVISORY_PROVENANCE_MISSING' };
  }

  const recommendation = state?.recommendation;
  const revision = state?.allocationRevision;
  const matches = String(metadata.recommendationId) === String(recommendation?._id)
    && String(metadata.profileId) === String(recommendation?.profileId)
    && Number(metadata.allocationRevision) === Number(revision?.revision)
    && String(metadata.allocationRevisionId) === String(revision?._id)
    && metadata.portfolioFingerprint === state?.portfolioFingerprint
    && metadata.profileInputHash === recommendation?.profileInputHash
    && metadata.recommendationFingerprint === state?.recommendationFingerprint
    && metadata.recommendationPolicyVersion === recommendation?.recommendationPolicyVersion
    && metadata.regulatoryRuleVersion === recommendation?.regulatoryRuleVersion
    && metadata.returnAssumptionHash === revision?.returnAssumptionHash
    && Number(metadata.profileVersion) === Number(state?.profileVersion)
    && (!SUCCESS_STATUSES.has(metadata.status) || Boolean(metadata.generatedAt));

  return matches ? { fresh: true, reason: null } : { fresh: false, reason: 'ADVISORY_SOURCE_STATE_CHANGED' };
}
