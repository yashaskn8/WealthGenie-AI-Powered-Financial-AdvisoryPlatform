import {
  buildRecommendationProfileHash,
  RECOMMENDATION_POLICY_VERSION,
} from './recommendationProfile.js';

export const RECOMMENDATION_FRESHNESS_REASON_CODES = Object.freeze({
  PROFILE_MISSING: 'PROFILE_MISSING',
  RECOMMENDATION_MISSING: 'RECOMMENDATION_MISSING',
  MODEL_VERSION_MISSING: 'MODEL_VERSION_MISSING',
  PROFILE_HASH_MISSING: 'PROFILE_HASH_MISSING',
  PROFILE_CHANGED: 'PROFILE_CHANGED',
  REGULATORY_VERSION_UNAVAILABLE: 'REGULATORY_VERSION_UNAVAILABLE',
  REGULATORY_POLICY_CHANGED: 'REGULATORY_POLICY_CHANGED',
});

function asString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
/**
 * Read-only assessment shared by dashboard restore and Plan Review.
 * It deliberately does not repair, recompute, or persist anything.
 */
export function assessRecommendationFreshness({
  profile,
  recommendation,
  currentRegulatoryRuleVersion,
  recommendationRegulatoryRuleVersion = recommendation?.regulatoryRuleVersion ?? null,
  policyVersion = RECOMMENDATION_POLICY_VERSION,
} = {}) {
  const reasonCodes = [];
  const profilePresent = Boolean(profile);
  const recommendationPresent = Boolean(recommendation);
  const modelVersion = asString(recommendation?.modelVersion);
  const observedProfileHash = asString(recommendation?.profileInputHash);
  const currentRegulatoryVersion = asString(currentRegulatoryRuleVersion);
  const observedRegulatoryVersion = asString(recommendationRegulatoryRuleVersion);
  let expectedProfileHash = null;

  if (!profilePresent) reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.PROFILE_MISSING);
  if (!recommendationPresent) reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.RECOMMENDATION_MISSING);

  if (recommendationPresent && !modelVersion) {
    reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.MODEL_VERSION_MISSING);
  }
  if (recommendationPresent && !observedProfileHash) {
    reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.PROFILE_HASH_MISSING);
  }

  if (profilePresent && modelVersion) {
    try {
      expectedProfileHash = buildRecommendationProfileHash(profile, {
        modelVersion,
        policyVersion,
      });
    } catch {
      reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.PROFILE_CHANGED);
    }
  }
  if (observedProfileHash && expectedProfileHash && observedProfileHash !== expectedProfileHash) {
    reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.PROFILE_CHANGED);
  }

  if (recommendationPresent && !currentRegulatoryVersion) {
    reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.REGULATORY_VERSION_UNAVAILABLE);
  } else if (
    recommendationPresent
    && currentRegulatoryVersion
    && observedRegulatoryVersion
    && observedRegulatoryVersion !== currentRegulatoryVersion
  ) {
    reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.REGULATORY_POLICY_CHANGED);
  }

  const uniqueReasonCodes = [...new Set(reasonCodes)];
  return Object.freeze({
    fresh: uniqueReasonCodes.length === 0,
    reasonCodes: uniqueReasonCodes,
    profilePresent,
    recommendationPresent,
    modelVersion,
    observedProfileHash,
    expectedProfileHash,
    observedRegulatoryVersion,
    currentRegulatoryVersion,
    policyVersion,
  });
}
