import { buildGroundedEvidencePacket, makeEvidenceEntry } from './groundedEvidence.js';
import { generateGroundedExplanation } from './groundedExplanationService.js';

const ADVISORY_PROFILE_KEYS = Object.freeze([
  'monthlyTakeHome', 'monthlySavings', 'savingsRate', 'age', 'riskTolerance',
  'suitabilityRisk', 'liquidSavings', 'emiBurdenPct', 'financialDependents',
  'emergencyFundMonths', 'investmentGoals', 'investmentHorizonYears',
  'deployableLumpSum', 'suitabilityReasonCodes', 'taxEligibilityStatus',
]);

export async function generateAdvisory(userContext) {
  const { profile, instruments, shapExplanation, modelVersion, policyVersion } = userContext;

  if (!profile || !Number.isFinite(profile.monthlyTakeHome) || !Number.isFinite(profile.monthlySavings)) {
    throw new TypeError('generateAdvisory requires canonical Financial Profile context');
  }
  const profileKeys = Object.keys(profile).sort();
  if (profileKeys.length !== ADVISORY_PROFILE_KEYS.length
      || ADVISORY_PROFILE_KEYS.some(key => !Object.hasOwn(profile, key))) {
    throw new TypeError('generateAdvisory requires the exact allowlisted LLM Financial Profile context');
  }
  if (typeof modelVersion !== 'string' || !modelVersion.trim()
      || typeof policyVersion !== 'string' || !policyVersion.trim()) {
    throw new TypeError('generateAdvisory requires explicit model and policy versions');
  }
  const additionalEntries = [];
  if (shapExplanation?.top_reason) {
    additionalEntries.push(makeEvidenceEntry('E_REC_EXPLANATION', 'RECOMMENDATION', {
      topReason: shapExplanation.top_reason,
      featureContributions: shapExplanation.feature_contributions || [],
    }, {
      dataClass: 'AUTHORITATIVE_BACKEND_RESULT',
      displayValue: String(shapExplanation.top_reason),
    }));
  }
  additionalEntries.push(makeEvidenceEntry('E_REC_VERSIONS', 'RECOMMENDATION', {
    modelVersion,
    policyVersion,
  }, {
    dataClass: 'REFERENCE_METADATA',
    displayValue: `Recommendation model ${modelVersion}; policy ${policyVersion}`,
  }));
  const evidencePacket = buildGroundedEvidencePacket({
    question: 'Explain why the authoritative recommendation suits this Financial Profile.',
    profile,
    recommendation: { instruments, modelVersion, profileInputHash: null },
    additionalEntries,
    purpose: 'RECOMMENDATION_EXPLANATION',
  });
  const result = await generateGroundedExplanation({
    question: 'Explain why the authoritative recommendation suits this Financial Profile.',
    evidencePacket,
  });
  return { ...result, modelUsed: result.model, cited_chunks: result.evidenceIdsUsed };
}

export async function getGoalAdvisory(message, profileContext, goalEvidence = null) {
  const entries = goalEvidence ? [makeEvidenceEntry('E_GOAL_PLAN', 'GOAL_PLAN', goalEvidence, {
    dataClass: 'AUTHORITATIVE_BACKEND_RESULT',
    displayValue: `Goal status ${goalEvidence.status}; required monthly SIP INR ${goalEvidence.recommendedSip}; profile savings capacity INR ${profileContext.monthlySavings}`,
  })] : [];
  const evidencePacket = buildGroundedEvidencePacket({
    question: message,
    profile: profileContext,
    additionalEntries: entries,
    unavailableFacts: goalEvidence ? [] : ['GOAL_PLAN_EVIDENCE_UNAVAILABLE'],
    purpose: 'GOAL_PLAN_EXPLANATION',
  });
  const result = await generateGroundedExplanation({ question: message, evidencePacket });
  return result.text;
}
