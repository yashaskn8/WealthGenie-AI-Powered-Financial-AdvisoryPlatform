const INJECTION_PATTERN = /(ignore\s+(all|previous)|system\s+prompt|reveal\s+instructions|developer\s+message)/i;

export function verifyEvidencePacket({ review = null, evidencePacket = { entries: [] } } = {}) {
  const entries = Array.isArray(evidencePacket?.entries) ? evidencePacket.entries : [];
  const ids = new Set(entries.map(entry => entry?.id).filter(Boolean));
  const referenced = [
    ...(review?.evidence?.entries || []).map(entry => entry?.id),
    ...(review?.evidenceIds || []),
  ].filter(Boolean);
  const unknownEvidenceIds = referenced.filter(id => !ids.has(id));
  const injectionDetected = entries.some(entry => INJECTION_PATTERN.test(String(entry?.displayValue || entry?.text || '')));
  return {
    agent: 'EvidenceVerifierAgent',
    valid: unknownEvidenceIds.length === 0 && !injectionDetected,
    unknownEvidenceIds,
    injectionDetected,
    checkedEvidenceIds: [...ids],
    financialAuthorityDelta: 0,
  };
}
