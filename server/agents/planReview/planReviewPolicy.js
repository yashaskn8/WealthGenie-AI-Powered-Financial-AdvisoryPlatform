import { isGroundingBoundaryAttack } from '../../services/groundedExplanationService.js';
import { validatePlanReviewResponse, PLAN_REVIEW_ACTIONS, PLAN_REVIEW_VERSION, PLAN_REVIEW_POLICY_VERSION } from './planReviewSchemas.js';

const UNSAFE_REVIEW_LANGUAGE = /guarantee|risk[- ]free|no risk|certain return|will earn|execute|rebalanced|changed your plan|updated your plan|new allocation|new weight/i;

function evidenceContainsBoundaryAttack(entries) {
  return (entries || []).some(entry => {
    const text = [entry?.displayValue, entry?.value && JSON.stringify(entry.value)]
      .filter(Boolean)
      .join(' ');
    return isGroundingBoundaryAttack(text)
      || /ignore\s+(?:previous|the evidence|wealthgenie)|reveal\s+(?:the system prompt|a secret|an api key)|override\s+(?:the|your)\s+(?:policy|instructions)|call\s+https?:\/\//i.test(text);
  });
}

const FINDING_COPY = Object.freeze({
  PROFILE_MISSING: ['PROFILE_REQUIRED', 'BLOCKED', 'Profile required', 'Complete a financial profile before reviewing a plan.'],
  RECOMMENDATION_MISSING: ['RECOMMENDATION_MISSING', 'BLOCKED', 'Recommendation unavailable', 'A current recommendation is not available for review.'],
  PROFILE_CHANGED: ['PROFILE_CHANGED', 'ATTENTION', 'Profile changed', 'The saved recommendation does not match the current profile.'],
  MODEL_VERSION_MISSING: ['MODEL_VERSION_MISSING', 'ATTENTION', 'Model metadata unavailable', 'The recommendation is missing model version metadata.'],
  PROFILE_HASH_MISSING: ['PROFILE_HASH_MISSING', 'ATTENTION', 'Profile fingerprint unavailable', 'The recommendation is missing the profile fingerprint needed for a freshness check.'],
  REGULATORY_POLICY_CHANGED: ['REGULATORY_POLICY_CHANGED', 'ATTENTION', 'Policy version changed', 'The recommendation was generated under an older regulatory policy version.'],
  REGULATORY_VERSION_UNAVAILABLE: ['REGULATORY_VERSION_UNAVAILABLE', 'BLOCKED', 'Policy evidence unavailable', 'The current verified regulatory policy version is unavailable.'],
  RECOMMENDATION_SNAPSHOT_UNAVAILABLE: ['RECOMMENDATION_SNAPSHOT_UNAVAILABLE', 'BLOCKED', 'Recommendation evidence unavailable', 'The saved recommendation evidence snapshot is unavailable.'],
  EVIDENCE_UNAVAILABLE: ['EVIDENCE_UNAVAILABLE', 'BLOCKED', 'Evidence unavailable', 'The plan could not be reviewed because its evidence snapshot is unavailable.'],
  GOALS_UNAVAILABLE: ['GOALS_UNAVAILABLE', 'ATTENTION', 'Goals unavailable', 'Goal status could not be loaded for this profile.'],
});

function hasReason(reasons, code) {
  return Array.isArray(reasons) && reasons.includes(code);
}

export function deriveRecommendedAction({ profile, freshness, goalSummary, evidenceStatus }) {
  if (!profile) return 'REVIEW_PROFILE';
  if (hasReason(freshness?.reasonCodes, 'RECOMMENDATION_MISSING')
      || hasReason(freshness?.reasonCodes, 'PROFILE_CHANGED')
      || hasReason(freshness?.reasonCodes, 'REGULATORY_POLICY_CHANGED')
      || hasReason(freshness?.reasonCodes, 'MODEL_VERSION_MISSING')
      || hasReason(freshness?.reasonCodes, 'PROFILE_HASH_MISSING')) return 'RECOMPUTE_PLAN';
  if (hasReason(freshness?.reasonCodes, 'REGULATORY_VERSION_UNAVAILABLE')
      || evidenceStatus === 'UNAVAILABLE') return 'INSUFFICIENT_EVIDENCE';
  if (goalSummary?.status === 'UNAVAILABLE') return 'REVIEW_GOALS';
  return 'NONE';
}

export function deriveFindings({ profile, freshness, goalSummary, evidenceStatus }) {
  const reasons = [...new Set(freshness?.reasonCodes || [])];
  if (evidenceStatus === 'UNAVAILABLE') reasons.push('EVIDENCE_UNAVAILABLE');
  if (goalSummary?.status === 'UNAVAILABLE') reasons.push('GOALS_UNAVAILABLE');
  if (reasons.length === 0 && profile) {
    return [{
      code: 'PLAN_CURRENT',
      severity: 'INFO',
      title: 'Plan evidence is current',
      detail: 'The available profile, recommendation, and policy metadata are aligned for review.',
      evidenceIds: ['E_RECOMMENDATION_FRESHNESS'],
    }];
  }
  return [...new Set(reasons)].map(reason => {
    const [code, severity, title, detail] = FINDING_COPY[reason]
      || [reason, 'ATTENTION', 'Review attention needed', 'The plan review returned a condition that needs attention.'];
    return { code, severity, title, detail, evidenceIds: [] };
  });
}

function safeSummary(action, findings) {
  if (action === 'REVIEW_PROFILE') return 'Complete your financial profile before requesting a plan review.';
  if (action === 'RECOMPUTE_PLAN') return 'Your saved plan needs a fresh authoritative recommendation before it can be reviewed as current.';
  if (action === 'REVIEW_GOALS') return 'The recommendation can be reviewed, but goal status evidence is currently unavailable.';
  if (action === 'INSUFFICIENT_EVIDENCE') return 'The review is limited because verified plan evidence is unavailable right now.';
  return findings.some(item => item.code === 'PLAN_CURRENT')
    ? 'The available evidence is aligned with your current saved plan. No plan changes were made.'
    : 'The plan review completed with the evidence and limitations shown below.';
}

export function buildSafeReview({ runId, profile, freshness, goalSummary, evidence, provider = null, status = 'COMPLETED', stepCount = 0, toolCallCount = 0 }) {
  const evidenceStatus = evidence?.status || 'UNAVAILABLE';
  const recommendedAction = deriveRecommendedAction({ profile, freshness, goalSummary, evidenceStatus });
  const findings = deriveFindings({ profile, freshness, goalSummary, evidenceStatus });
  return {
    version: PLAN_REVIEW_VERSION,
    runId,
    status,
    recommendedAction,
    summary: safeSummary(recommendedAction, findings),
    findings,
    freshness: {
      fresh: Boolean(freshness?.fresh),
      reasonCodes: [...new Set(freshness?.reasonCodes || [])],
    },
    goals: {
      status: goalSummary?.status || 'UNAVAILABLE',
      items: Array.isArray(goalSummary?.items) ? goalSummary.items : [],
    },
    evidence: {
      status: evidenceStatus,
      entries: Array.isArray(evidence?.entries) ? evidence.entries : [],
      unavailableFacts: [...new Set(evidence?.unavailableFacts || [])],
    },
    provider: {
      name: provider?.provider || provider?.name || 'DETERMINISTIC_FALLBACK',
      model: provider?.model || null,
      fallback: provider?.fallback !== false,
    },
    execution: { stepCount, toolCallCount },
  };
}

export function policyGuardReview(review, evidencePacket, explanation = null) {
  const errors = [];
  if (!review || !PLAN_REVIEW_ACTIONS.includes(review.recommendedAction)) errors.push('UNSUPPORTED_ACTION');
  if (UNSAFE_REVIEW_LANGUAGE.test(review?.summary || '')) errors.push('UNSAFE_REVIEW_LANGUAGE');
  for (const finding of review?.findings || []) {
    if (UNSAFE_REVIEW_LANGUAGE.test(`${finding.title} ${finding.detail}`)) errors.push('UNSAFE_FINDING_LANGUAGE');
  }
  const knownEvidenceIds = new Set((evidencePacket?.entries || []).map(item => item.id));
  const allEvidenceIds = [
    ...(review?.evidence?.entries || []).map(item => item?.id),
    ...(review?.findings || []).flatMap(item => item?.evidenceIds || []),
    ...(explanation?.evidenceIdsUsed || []),
  ].filter(Boolean);
  if (allEvidenceIds.some(id => !knownEvidenceIds.has(id))) errors.push('UNKNOWN_EVIDENCE_ID');
  if (evidenceContainsBoundaryAttack(evidencePacket?.entries || [])) errors.push('PROMPT_INJECTION_IN_EVIDENCE');
  const validation = validatePlanReviewResponse(review);
  if (validation.error) errors.push(...validation.error.details.map(detail => detail.type));
  return { allowed: errors.length === 0, reasonCodes: [...new Set(errors)], validation };
}

export function safeFallbackAfterPolicyRejection({ runId, profile, freshness, goalSummary, evidence, provider, reasonCodes, stepCount, toolCallCount }) {
  const safe = buildSafeReview({ runId, profile, freshness, goalSummary, evidence, provider: { ...provider, fallback: true }, stepCount, toolCallCount });
  return {
    ...safe,
    recommendedAction: 'INSUFFICIENT_EVIDENCE',
    summary: 'The review was limited because its generated response did not pass the safety checks. No plan changes were made.',
    findings: [
      ...safe.findings,
      { code: 'POLICY_GUARD_REJECTED', severity: 'BLOCKED', title: 'Review response withheld', detail: 'The generated response was not used because it did not pass evidence and policy checks.', evidenceIds: [] },
    ],
    provider: { ...safe.provider, fallback: true },
    policyReasonCodes: [...new Set(reasonCodes || [])],
  };
}

export { PLAN_REVIEW_POLICY_VERSION };
