import crypto from 'node:crypto';
import { verifyArtifactContentHash } from './researchArtifact.js';
import { validateResearchArtifact } from './researchSchemas.js';
import { isSourceTierAtLeast } from './sourceTrust.js';

const UNSAFE_LANGUAGE = /\b(?:guaranteed?|risk[- ]free|certain(?:ly)?|will earn|buy|sell|rebalance|allocation|new weight|execute|transfer|trade|payment)\b/i;

function tokens(value) {
  return new Set(String(value || '').toLowerCase().split(/[^a-z0-9%]+/).filter(token => token.length > 2));
}

function overlap(left, right) {
  const source = tokens(left);
  const target = tokens(right);
  if (!source.size || !target.size) return 0;
  let matches = 0;
  for (const token of source) if (target.has(token)) matches += 1;
  return matches / source.size;
}

function numericValues(value) {
  return String(value || '').match(/\b\d+(?:\.\d+)?%?\b/g) || [];
}

export function detectResearchContradictions(claims = [], evidenceUnits = []) {
  const evidenceById = new Map(evidenceUnits.map(item => [item.evidenceId, item]));
  const contradictions = [];
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const left = claims[i];
      const right = claims[j];
      if (left.claimType !== right.claimType || left.text === right.text) continue;
      const leftNumbers = numericValues(left.text);
      const rightNumbers = numericValues(right.text);
      const materiallyDifferent = leftNumbers.length > 0 && rightNumbers.length > 0
        && leftNumbers.some(value => !rightNumbers.includes(value));
      const opposing = /\b(?:not|decrease|decreased|lower|falls?)\b/i.test(left.text)
        !== /\b(?:not|decrease|decreased|lower|falls?)\b/i.test(right.text);
      if (!materiallyDifferent && !opposing) continue;
      contradictions.push({
        contradictionId: `CONFLICT_${left.claimId}_${right.claimId}`,
        claimIds: [left.claimId, right.claimId],
        variants: [left.text, right.text],
        sourceIds: [left, right].flatMap(claim => claim.supportingEvidenceIds.map(id => evidenceById.get(id)?.sourceId).filter(Boolean)),
        resolution: 'CONFLICTING_EVIDENCE',
      });
    }
  }
  return contradictions;
}

export function buildClaimAudit({ claimId, verifierDecision, reasonCodes = [], submittedEvidenceIds = [], replacementEvidenceIds = [], finalDecision }) {
  return Object.freeze({
    claimId,
    verifierDecision,
    reasonCodes: [...new Set(reasonCodes)],
    submittedEvidenceIds: [...new Set(submittedEvidenceIds)],
    replacementEvidenceIds: [...new Set(replacementEvidenceIds)],
    finalDecision,
  });
}

export function verifyResearchArtifact(artifact, { brief = null, now = new Date() } = {}) {
  const errors = [];
  const audits = [];
  const schema = validateResearchArtifact(artifact);
  if (schema.error) errors.push(...schema.error.details.map(detail => `SCHEMA_${detail.type}`));
  if (!verifyArtifactContentHash(artifact)) errors.push('ARTIFACT_HASH_MISMATCH');
  if (artifact?.financialAuthorityDelta !== 0) errors.push('FINANCIAL_AUTHORITY_DELTA_NONZERO');
  if (brief && artifact?.researchBriefId !== brief.researchBriefId) errors.push('RESEARCH_BRIEF_BINDING_MISMATCH');
  const evidenceById = new Map((artifact?.evidenceUnits || []).map(item => [item.evidenceId, item]));
  const sourceById = new Map((artifact?.sources || []).map(item => [item.sourceId, item]));
  const contradictedClaimIds = new Set((artifact?.contradictions || []).flatMap(item => item.claimIds || []));

  for (const evidence of artifact?.evidenceUnits || []) {
    const source = sourceById.get(evidence.sourceId);
    if (!source || source.canonicalUrl !== evidence.canonicalUrl || source.documentHash !== evidence.documentHash) errors.push(`EVIDENCE_SOURCE_BINDING_${evidence.evidenceId}`);
    if (evidence.supportingExcerptHash !== hashExcerpt(evidence.supportingExcerpt)) errors.push(`EVIDENCE_EXCERPT_HASH_${evidence.evidenceId}`);
  }

  for (const claim of artifact?.claims || []) {
    const claimErrors = [];
    const evidence = claim.supportingEvidenceIds.map(evidenceId => evidenceById.get(evidenceId)).filter(Boolean);
    if (claim.supportingEvidenceIds.length === 0 && claim.supportStatus === 'SUPPORTED') claimErrors.push('SUPPORTED_CLAIM_WITHOUT_EVIDENCE');
    if (evidence.length !== claim.supportingEvidenceIds.length) claimErrors.push('CLAIM_EVIDENCE_MISSING');
    if (UNSAFE_LANGUAGE.test(claim.text)) claimErrors.push('UNSAFE_CLAIM_LANGUAGE');
    if (numericValues(claim.text).some(number => !evidence.some(item => item.supportingExcerpt.includes(number)))) claimErrors.push('CLAIM_NUMBER_NOT_IN_EVIDENCE');
    if (evidence.length > 0 && Math.max(...evidence.map(item => overlap(claim.text, item.supportingExcerpt))) < 0.35) claimErrors.push('CLAIM_NOT_ENTAILED_BY_EVIDENCE');
    if (claim.supportStatus === 'SUPPORTED' && contradictedClaimIds.has(claim.claimId)) claimErrors.push('CONTRADICTED_CLAIM_MARKED_SUPPORTED');
    if (brief && claim.sourceTrustTier !== 'UNVERIFIED' && !isSourceTierAtLeast(claim.sourceTrustTier, brief.freshnessRequirement.requiredSourceTier)) claimErrors.push('SOURCE_TIER_BELOW_REQUIREMENT');
    if (claimErrors.length) {
      errors.push(...claimErrors.map(code => `${code}_${claim.claimId}`));
      audits.push(buildClaimAudit({ claimId: claim.claimId, verifierDecision: 'REJECT', reasonCodes: claimErrors, submittedEvidenceIds: claim.supportingEvidenceIds, finalDecision: 'UNVERIFIED' }));
    } else {
      audits.push(buildClaimAudit({ claimId: claim.claimId, verifierDecision: 'ACCEPT', submittedEvidenceIds: claim.supportingEvidenceIds, finalDecision: claim.supportStatus }));
    }
  }

  const ageLimit = Number(brief?.freshnessRequirement?.maxAgeHours);
  if (Number.isFinite(ageLimit)) {
    for (const claim of artifact?.claims || []) {
      const source = claim.supportingEvidenceIds.map(id => evidenceById.get(id)).find(Boolean);
      if (!source?.publicationDate) continue;
      const ageHours = (now.getTime() - new Date(source.publicationDate).getTime()) / 3600000;
      if (ageHours > ageLimit && claim.supportStatus === 'SUPPORTED') errors.push(`STALE_SUPPORTED_CLAIM_${claim.claimId}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    claimAudits: audits,
    verifiedClaims: (artifact?.claims || []).filter(claim => claim.supportStatus === 'SUPPORTED' && !audits.find(audit => audit.claimId === claim.claimId && audit.finalDecision === 'UNVERIFIED')),
    financialAuthorityDelta: 0,
  };
}

function hashExcerpt(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}
