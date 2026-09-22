import crypto from 'node:crypto';
import { RESEARCH_MESH_VERSION, RESEARCH_POLICY_VERSION } from './researchConstants.js';

function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
}

export function hashResearchArtifact(value) {
  return crypto.createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

export function hashResearchDocument(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

export function buildResearchArtifact({
  brief,
  taskId = null,
  artifactId = crypto.randomUUID(),
  createdAt = new Date().toISOString(),
  status = 'COMPLETED',
  claims = [],
  evidenceUnits = [],
  sources = [],
  contradictions = [],
  unresolvedGaps = [],
  researchBudgetUsed = {},
  queryCount = 0,
  documentCount = sources.length,
  modelCalls = 0,
  tokenUsage = 0,
  durationMs = 0,
  parentArtifactId = null,
} = {}) {
  const artifact = {
    artifactId,
    version: '1.0.0',
    researchBriefId: brief.researchBriefId,
    taskId,
    agentVersion: RESEARCH_MESH_VERSION,
    researchPolicyVersion: RESEARCH_POLICY_VERSION,
    createdAt,
    asOf: brief.asOf,
    status,
    claims,
    evidenceUnits,
    sources,
    contradictions,
    unresolvedGaps,
    researchBudgetUsed,
    queryCount,
    documentCount,
    modelCalls,
    tokenUsage,
    durationMs,
    parentArtifactId,
    financialAuthorityDelta: 0,
  };
  return Object.freeze({ ...artifact, contentHash: hashResearchArtifact(artifact) });
}

export function verifyArtifactContentHash(artifact) {
  if (!artifact?.contentHash) return false;
  const { contentHash: _contentHash, ...withoutHash } = artifact;
  return hashResearchArtifact(withoutHash) === artifact.contentHash;
}

export function researchArtifactToEvidenceEntries(artifact) {
  const evidenceById = new Map((artifact?.evidenceUnits || []).map(item => [item.evidenceId, item]));
  return (artifact?.claims || [])
    .filter(claim => claim.supportStatus === 'SUPPORTED')
    .map(claim => {
      const evidence = evidenceById.get(claim.supportingEvidenceIds[0]);
      return {
        id: `E_RESEARCH_${claim.claimId}`,
        kind: 'PUBLIC_RESEARCH_CLAIM',
        value: {
          claimId: claim.claimId,
          text: claim.text,
          claimType: claim.claimType,
          supportStatus: claim.supportStatus,
          freshnessStatus: claim.freshnessStatus,
          sourceTrustTier: claim.sourceTrustTier,
          supportingEvidenceIds: claim.supportingEvidenceIds,
          artifactId: artifact.artifactId,
          contentHash: artifact.contentHash,
        },
        displayValue: claim.text,
        dataClass: 'VERIFIED_PUBLIC_RESEARCH',
        source: evidence ? {
          provider: evidence.publisher,
          url: evidence.canonicalUrl,
          publicationDate: evidence.publicationDate,
        } : null,
        observedAt: evidence?.retrievedAt || null,
        freshness: claim.freshnessStatus,
        authority: 'VERIFIED_PUBLIC_RESEARCH',
      };
    });
}

export { canonicalStringify };
