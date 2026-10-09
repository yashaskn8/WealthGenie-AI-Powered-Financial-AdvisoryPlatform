import crypto from 'node:crypto';
import { RESEARCH_MESH_VERSION, RESEARCH_POLICY_VERSION } from './researchConstants.js';

const SAFE_EXECUTION_BINDING_ALPHABET = 'bcdfghijklmnopqr';
export const EXECUTION_BINDING_HASH_PATTERN = /^(?:[a-f0-9]{64}|[bcdfghijklmnopqr]{64})$/i;

function encodeExecutionBindingDigest(hexDigest) {
  return hexDigest.replace(/[0-9a-f]/gi, nibble => SAFE_EXECUTION_BINDING_ALPHABET[Number.parseInt(nibble, 16)]);
}

function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
}

export function hashResearchArtifact(value) {
  return crypto.createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

export function hashResearchBrief(value) {
  return crypto.createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

export function hashResearchDocument(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

export function hashResearchExecutionBinding({ runId, executionGeneration, traceId } = {}) {
  if (typeof runId !== 'string' || runId.trim().length < 1 || runId.length > 160
      || !Number.isSafeInteger(Number(executionGeneration)) || Number(executionGeneration) < 1
      || typeof traceId !== 'string' || traceId.trim().length < 1 || traceId.length > 160) {
    throw new TypeError('A complete PlanReview execution binding is required.');
  }
  const digest = crypto.createHash('sha256').update(canonicalStringify({
    schemaVersion: 'plan-review-research-execution-binding/v1',
    runId,
    executionGeneration: Number(executionGeneration),
    traceId,
  })).digest('hex');
  // Keep the full 256-bit digest while avoiding accidental matches with the
  // ResearchBrief's financial-identifier privacy patterns.
  return encodeExecutionBindingDigest(digest);
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
  const frozenClaims = freezeTree(claims);
  const frozenEvidence = freezeTree(evidenceUnits);
  const frozenSources = freezeTree(sources.map(item => ({ ...item, fetchAttestation: item.fetchAttestation ?? null })));
  const frozenContradictions = freezeTree(contradictions);
  const frozenGaps = freezeTree(unresolvedGaps);
  const frozenBudget = freezeTree(researchBudgetUsed);
  const artifact = {
    artifactId,
    version: '1.3.0',
    researchBriefId: brief.researchBriefId,
    researchBriefHash: hashResearchBrief(brief),
    taskId,
    agentVersion: RESEARCH_MESH_VERSION,
    researchPolicyVersion: RESEARCH_POLICY_VERSION,
    createdAt,
    asOf: brief.asOf,
    status,
    claims: frozenClaims,
    evidenceUnits: frozenEvidence,
    sources: frozenSources,
    contradictions: frozenContradictions,
    unresolvedGaps: frozenGaps,
    researchBudgetUsed: frozenBudget,
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

function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

export function verifyArtifactContentHash(artifact) {
  if (!artifact?.contentHash) return false;
  const { contentHash: _contentHash, ...withoutHash } = artifact;
  return hashResearchArtifact(withoutHash) === artifact.contentHash;
}

export function researchArtifactToEvidenceEntries(artifact) {
  const evidenceById = new Map((artifact?.evidenceUnits || []).map(item => [item.evidenceId, item]));
  const sourceById = new Map((artifact?.sources || []).map(item => [item.sourceId, item]));
  return (artifact?.claims || [])
    .filter(claim => claim.supportStatus === 'SUPPORTED')
    .map(claim => {
      const evidence = evidenceById.get(claim.supportingEvidenceIds[0]);
      const source = evidence ? sourceById.get(evidence.sourceId) : null;
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
          taskId: artifact.taskId,
          researchBriefHash: artifact.researchBriefHash,
        },
        displayValue: claim.text,
        dataClass: 'VERIFIED_PUBLIC_RESEARCH',
        source: evidence ? {
          provider: evidence.publisher,
          url: evidence.canonicalUrl,
          publicationDate: evidence.publicationDate,
          jurisdiction: source?.fetchAttestation?.jurisdiction || null,
          retrievedAt: evidence.retrievedAt,
          documentHash: evidence.documentHash,
          sourceTrustTier: evidence.sourceTrustTier,
          fetchAttestation: source?.fetchAttestation || null,
          evidenceBinding: { evidenceId: evidence.evidenceId, supportingExcerptHash: evidence.supportingExcerptHash },
        } : null,
        observedAt: evidence?.retrievedAt || null,
        freshness: claim.freshnessStatus,
        authority: 'VERIFIED_PUBLIC_RESEARCH',
      };
    });
}

export { canonicalStringify };
