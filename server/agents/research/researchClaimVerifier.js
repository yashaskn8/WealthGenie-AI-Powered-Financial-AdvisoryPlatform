import crypto from 'node:crypto';
import { hashResearchBrief, verifyArtifactContentHash } from './researchArtifact.js';
import {
  normalizeResearchFacts,
  orderedLexicalTokens,
  researchFactsMatch,
  researchNegatedPhraseOverlapsClaim,
  textHasNegation,
} from './researchFactNormalization.js';
import { validateResearchArtifact } from './researchSchemas.js';
import { classifyResearchSource, isSourceTierAtLeast } from './sourceTrust.js';
import { normalizeSourceEvidenceBindings, verifyResearchSourceAttestation } from './researchSourceAttestation.js';
import { RESEARCH_POLICY_VERSION } from './researchConstants.js';

const UNSAFE_LANGUAGE = /\b(?:guaranteed?|risk[- ]free|certain(?:ly)?|will earn)\b/i;
const PRESCRIPTIVE_SUBJECT = '(?:you|your|everyone|anyone|all\\s+investors?|investors?|readers?|users?|customers?|people|individuals?|savers?|borrowers?|traders?|households?|one)';
const ACTION_VERB = '(?:invest|buy|sell|choose|avoid|switch|allocate|rebalance|trade|purchase|exit|execute|transfer|pay)';
const MODAL_PRESCRIPTIVE_ADVICE = new RegExp(`\\b${PRESCRIPTIVE_SUBJECT}\\s+(?:should|ought\\s+to|must|need\\s+to|have\\s+to|may want to|might want to|are advised to|are recommended to)\\s+${ACTION_VERB}\\b`, 'i');
const ATTRIBUTED_PRESCRIPTIVE_ADVICE = /\b(?:recommend(?:s|ed)?|advise(?:s|d)?|suggest(?:s|ed)?)\s+(?:(?:that)\s+)?(?:(?:all\s+)?(?:you|your|everyone|anyone|investors?|readers?|users?|customers?|people|individuals?|savers?|borrowers?|traders?|households?)\s+)?(?:(?:should|ought\s+to|must|need\s+to|have\s+to|may want to|might want to|are advised to|are recommended to|to)\s+)?(?:invest|buy|sell|choose|avoid|switch|allocate|rebalance|trade|purchase|exit|execute|transfer|pay|consider)\b/i;
const DIRECT_PRESCRIPTIVE_ADVICE = /(?:^|[.!?;:]\s*|["'“”‘’]\s*)(?:please\s+)?(?:invest|buy|sell|choose|avoid|switch|allocate|rebalance|trade|purchase|exit|execute|transfer|pay)\b\s+(?:your\b|my\b|our\b|their\b|this\b|that\b|(?:in|into|to|from|between|among|for)\s+\w|(?:risky|unsafe|high[- ]risk|unsuitable)\s+|(?:the|a|an)\s+(?:fund|stock|share|bond|unit|portfolio|position|product|scheme|investment|trade|transaction|savings|money|index)\b|(?:₹|INR\b|Rs\.?\s*)\s*\d|\d)/i;
const DIRECT_NAMED_PRODUCT_ADVICE = /(?:^|[.!?;:]\s*|["'“”‘’]\s*)(?:[Pp]lease\s+)?(?:[Ii]nvest|[Bb]uy|[Ss]ell|[Cc]hoose|[Aa]void|[Ss]witch|[Aa]llocate|[Rr]ebalance|[Tt]rade|[Pp]urchase|[Ee]xit|[Ee]xecute|[Tt]ransfer|[Pp]ay)\s+(?:(?:the|a|an)\s+)?(?:[A-Z]{2,}|[A-Z][A-Za-z0-9._-]*\s+(?:\d{1,2}\s+)?(?:fund|stock|share|bond|unit|portfolio|position|product|scheme|investment|index))\b/;
const CONSIDER_INVESTMENT_ADVICE = /(?:^|[.!?;:]\s*|["'“”‘’]\s*)(?:please\s+)?consider\s+(?:investing|buying|selling|choosing|avoiding|switching|allocating|rebalancing|trading|purchasing|exiting|executing|transferring|paying)\b/i;
const FIRST_PERSON_PRESCRIPTIVE_ADVICE = /\b(?:we|i)\s+(?:recommend|advise|suggest)(?:s|ed)?\b/i;

function containsPrescriptiveAdvice(text) {
  return MODAL_PRESCRIPTIVE_ADVICE.test(text)
    || ATTRIBUTED_PRESCRIPTIVE_ADVICE.test(text)
    || DIRECT_PRESCRIPTIVE_ADVICE.test(text)
    || DIRECT_NAMED_PRODUCT_ADVICE.test(text)
    || CONSIDER_INVESTMENT_ADVICE.test(text)
    || FIRST_PERSON_PRESCRIPTIVE_ADVICE.test(text);
}

export function detectResearchContradictions(claims = [], evidenceUnits = []) {
  const evidenceById = new Map(evidenceUnits.map(item => [item.evidenceId, item]));
  const contradictions = [];
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const left = claims[i];
      const right = claims[j];
      if (left.claimType !== right.claimType || left.text === right.text) continue;
      const leftFacts = normalizeResearchFacts(left.text);
      const rightFacts = normalizeResearchFacts(right.text);
      const materiallyDifferent = leftFacts.length > 0 && rightFacts.length > 0
        && leftFacts.some(fact => !rightFacts.some(other => researchFactsMatch(fact, other)));
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

export function verifyResearchArtifact(artifact, {
  brief = null,
  now = new Date(),
  requireIndependentSourceMetadata = false,
  requireSourceAttestation = false,
  requireFreshSourceFetch = false,
  trustedSourceAttestationJwk = null,
  expectedTaskId = null,
} = {}) {
  const errors = [];
  const audits = [];
  const schema = validateResearchArtifact(artifact);
  if (schema.error) errors.push(...schema.error.details.map(detail => `SCHEMA_${detail.type}`));
  if (!verifyArtifactContentHash(artifact)) errors.push('ARTIFACT_HASH_MISMATCH');
  if (artifact?.financialAuthorityDelta !== 0) errors.push('FINANCIAL_AUTHORITY_DELTA_NONZERO');
  if (brief && artifact?.researchBriefId !== brief.researchBriefId) errors.push('RESEARCH_BRIEF_BINDING_MISMATCH');
  if (brief && artifact?.researchBriefHash !== hashResearchBrief(brief)) errors.push('RESEARCH_BRIEF_HASH_MISMATCH');
  if (expectedTaskId !== null && artifact?.taskId !== expectedTaskId) errors.push('RESEARCH_TASK_BINDING_MISMATCH');
  if (requireSourceAttestation && !brief?.executionBindingHash) errors.push('RESEARCH_EXECUTION_BINDING_REQUIRED');
  if (brief && artifact?.taskId !== null && (typeof artifact?.taskId !== 'string' || artifact.taskId.length > 160)) errors.push('RESEARCH_TASK_BINDING_INVALID');
  const uniqueIds = (entries, key, label) => {
    const ids = entries.map(item => item?.[key]).filter(Boolean);
    if (new Set(ids).size !== ids.length) errors.push(`DUPLICATE_${label}_ID`);
  };
  uniqueIds(artifact?.sources || [], 'sourceId', 'SOURCE');
  uniqueIds(artifact?.evidenceUnits || [], 'evidenceId', 'EVIDENCE');
  uniqueIds(artifact?.claims || [], 'claimId', 'CLAIM');
  const evidenceById = new Map((artifact?.evidenceUnits || []).map(item => [item.evidenceId, item]));
  const sourceById = new Map((artifact?.sources || []).map(item => [item.sourceId, item]));
  const contradictedClaimIds = new Set((artifact?.contradictions || []).flatMap(item => item.claimIds || []));

  for (const evidence of artifact?.evidenceUnits || []) {
    const source = sourceById.get(evidence.sourceId);
    if (!source || source.canonicalUrl !== evidence.canonicalUrl || source.documentHash !== evidence.documentHash) errors.push(`EVIDENCE_SOURCE_BINDING_${evidence.evidenceId}`);
    const derivedTier = classifyResearchSource({ url: evidence.canonicalUrl });
    if (evidence.sourceTrustTier !== derivedTier || source?.sourceTrustTier !== derivedTier) errors.push(`SOURCE_TIER_PROVENANCE_${evidence.evidenceId}`);
    if (source && (source.publicationDate !== evidence.publicationDate
        || source.retrievedAt !== evidence.retrievedAt
        || source.publisher !== evidence.publisher)) errors.push(`EVIDENCE_SOURCE_METADATA_${evidence.evidenceId}`);
    if (evidence.supportingExcerptHash !== hashExcerpt(evidence.supportingExcerpt)) errors.push(`EVIDENCE_EXCERPT_HASH_${evidence.evidenceId}`);
    if (!evidence.supportingExcerpt.includes(evidence.claimCandidate)) errors.push(`EVIDENCE_CANDIDATE_NOT_IN_EXCERPT_${evidence.evidenceId}`);
    if (brief && !brief.requestedFactTypes.includes(evidence.factType)) errors.push(`UNREQUESTED_FACT_TYPE_${evidence.evidenceId}`);
    const parsedUrl = safeHttpsUrl(evidence.canonicalUrl);
    if (!parsedUrl) errors.push(`SOURCE_URL_NOT_HTTPS_${evidence.evidenceId}`);
    if (requireIndependentSourceMetadata && parsedUrl) {
      // Remote artifact metadata is self-asserted. Until the caller independently
      // parses publisher/date evidence from the fetched document, only the URL
      // host is defensible and publication time must remain unknown.
      if (evidence.publisher !== parsedUrl.hostname.toLowerCase()) {
        errors.push(`SOURCE_PUBLISHER_NOT_URL_DERIVED_${evidence.evidenceId}`);
      }
      if (evidence.publicationDate !== null) {
        errors.push(`SOURCE_PUBLICATION_DATE_NOT_INDEPENDENT_${evidence.evidenceId}`);
      }
    }
    const derivedFreshness = deriveFreshness(evidence.publicationDate, brief, now);
    if (evidence.freshnessStatus !== derivedFreshness) errors.push(`FRESHNESS_PROVENANCE_${evidence.evidenceId}`);
  }

  for (const source of artifact?.sources || []) {
    if (requireSourceAttestation && !source.fetchAttestation) {
      errors.push(`SOURCE_FETCH_ATTESTATION_MISSING_${source.sourceId}`);
      continue;
    }
    if (!source.fetchAttestation) continue;
    if (!trustedSourceAttestationJwk && !requireSourceAttestation) continue;
    const attestation = verifyResearchSourceAttestation(source.fetchAttestation, {
      publicJwk: trustedSourceAttestationJwk,
      expectedSource: {
        canonicalUrl: source.canonicalUrl,
        retrievedAt: source.retrievedAt,
        documentHash: source.documentHash,
        evidenceBindings: normalizeSourceEvidenceBindings((artifact?.evidenceUnits || [])
          .filter(item => item.sourceId === source.sourceId)
          .map(item => ({ evidenceId: item.evidenceId, supportingExcerptHash: item.supportingExcerptHash }))),
      },
      expectedTaskId: expectedTaskId ?? artifact?.taskId ?? null,
      expectedResearchBriefHash: artifact?.researchBriefHash ?? null,
      expectedExecutionBindingHash: brief?.executionBindingHash ?? null,
      expectedResearchPolicyVersion: RESEARCH_POLICY_VERSION,
      expectedJurisdiction: brief?.jurisdiction || null,
      expectedFreshnessMaxAgeHours: brief?.freshnessRequirement?.maxAgeHours ?? null,
      now,
      requireFreshFetch: requireFreshSourceFetch,
    });
    if (!attestation.valid) errors.push(`SOURCE_FETCH_ATTESTATION_${attestation.reason}_${source.sourceId}`);
  }

  for (const claim of artifact?.claims || []) {
    const claimErrors = [];
    const evidence = claim.supportingEvidenceIds.map(evidenceId => evidenceById.get(evidenceId)).filter(Boolean);
    if (claim.supportingEvidenceIds.length === 0 && claim.supportStatus === 'SUPPORTED') claimErrors.push('SUPPORTED_CLAIM_WITHOUT_EVIDENCE');
    if (evidence.length !== claim.supportingEvidenceIds.length) claimErrors.push('CLAIM_EVIDENCE_MISSING');
    if (UNSAFE_LANGUAGE.test(claim.text) || containsPrescriptiveAdvice(claim.text)) claimErrors.push('UNSAFE_CLAIM_LANGUAGE');
    const claimFacts = normalizeResearchFacts(claim.text);
    const claimTokens = orderedLexicalTokens(claim.text);
    const evidenceChecks = evidence.map(item => {
      const evidenceFacts = normalizeResearchFacts(item.supportingExcerpt);
      const evidenceTokens = orderedLexicalTokens(item.supportingExcerpt);
      const factSupport = claimFacts.length === evidenceFacts.length
        && claimFacts.every((fact, index) => researchFactsMatch(fact, evidenceFacts[index]));
      // Without a qualified semantic entailment model, only accept the same
      // ordered substantive wording and the same ordered typed facts. Set-based
      // token overlap accepts subject/object reversals such as "bank lends RBI"
      // when the source says "RBI lends bank".
      const lexicalSupport = claimTokens.length > 0
        && claimTokens.length === evidenceTokens.length
        && claimTokens.every((token, index) => token === evidenceTokens[index]);
      const negationConflict = textHasNegation(claim.text) !== textHasNegation(item.supportingExcerpt)
        || researchNegatedPhraseOverlapsClaim(claim.text, item.supportingExcerpt);
      return { factSupport, lexicalSupport, negationConflict };
    });
    const unsupportedFact = claimFacts.length > 0 && !evidenceChecks.some(item => item.factSupport);
    if (unsupportedFact) claimErrors.push('CLAIM_FACT_NOT_IN_EVIDENCE');
    if (evidence.length > 0 && !evidenceChecks.some(item => item.lexicalSupport)) claimErrors.push('CLAIM_NOT_ENTAILED_BY_EVIDENCE');
    const negationConflict = evidenceChecks.some(item => item.negationConflict);
    if (negationConflict) claimErrors.push('CLAIM_NEGATION_CONFLICT');
    if (evidence.some(item => item.factType !== claim.claimType)) claimErrors.push('CLAIM_FACT_TYPE_MISMATCH');
    if (evidence.some(item => classifyResearchSource({ url: item.canonicalUrl }) !== claim.sourceTrustTier)) claimErrors.push('CLAIM_SOURCE_TIER_MISMATCH');
    if (evidence.some(item => item.freshnessStatus !== claim.freshnessStatus)) claimErrors.push('CLAIM_FRESHNESS_MISMATCH');
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
      if (source?.freshnessStatus !== 'FRESH' && claim.supportStatus === 'SUPPORTED') errors.push(`NONFRESH_SUPPORTED_CLAIM_${claim.claimId}`);
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

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url : null;
  } catch { return null; }
}

function deriveFreshness(publicationDate, brief, now) {
  if (!publicationDate || !brief?.freshnessRequirement?.maxAgeHours) return 'UNKNOWN';
  const publishedAt = new Date(publicationDate);
  if (!Number.isFinite(publishedAt.getTime()) || publishedAt > now) return 'UNKNOWN';
  const ageHours = (now.getTime() - publishedAt.getTime()) / 3600000;
  return ageHours <= brief.freshnessRequirement.maxAgeHours ? 'FRESH' : 'STALE';
}

function hashExcerpt(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}
