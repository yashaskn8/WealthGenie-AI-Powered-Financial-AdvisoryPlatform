import {
  buildRecommendationProfileHash,
  RECOMMENDATION_POLICY_VERSION,
} from './recommendationProfile.js';
import {
  PROJECTION_ASSUMPTION_POLICY_HASH,
  PROJECTION_ASSUMPTION_SOURCE,
  PROJECTION_ASSUMPTION_VERSION,
} from './instrumentConstants.js';

export const RECOMMENDATION_FRESHNESS_REASON_CODES = Object.freeze({
  PROFILE_MISSING: 'PROFILE_MISSING',
  RECOMMENDATION_MISSING: 'RECOMMENDATION_MISSING',
  MODEL_VERSION_MISSING: 'MODEL_VERSION_MISSING',
  PROFILE_HASH_MISSING: 'PROFILE_HASH_MISSING',
  PROFILE_CHANGED: 'PROFILE_CHANGED',
  PROFILE_VERSION_MISSING: 'PROFILE_VERSION_MISSING',
  PROFILE_VERSION_CHANGED: 'PROFILE_VERSION_CHANGED',
  REGULATORY_VERSION_UNAVAILABLE: 'REGULATORY_VERSION_UNAVAILABLE',
  REGULATORY_POLICY_CHANGED: 'REGULATORY_POLICY_CHANGED',
  RECOMMENDATION_POLICY_MISSING: 'RECOMMENDATION_POLICY_MISSING',
  RECOMMENDATION_POLICY_CHANGED: 'RECOMMENDATION_POLICY_CHANGED',
  ALLOCATION_REVISION_MISSING: 'ALLOCATION_REVISION_MISSING',
  ALLOCATION_REVISION_INVALID: 'ALLOCATION_REVISION_INVALID',
  ALLOCATION_RECOMMENDATION_MISMATCH: 'ALLOCATION_RECOMMENDATION_MISMATCH',
  ALLOCATION_PROFILE_CHANGED: 'ALLOCATION_PROFILE_CHANGED',
  ALLOCATION_PROFILE_VERSION_MISSING: 'ALLOCATION_PROFILE_VERSION_MISSING',
  ALLOCATION_USER_MISMATCH: 'ALLOCATION_USER_MISMATCH',
  ALLOCATION_SOURCE_MISSING: 'ALLOCATION_SOURCE_MISSING',
  ASSUMPTION_VERSION_MISSING: 'ASSUMPTION_VERSION_MISSING',
  ASSUMPTION_VERSION_CHANGED: 'ASSUMPTION_VERSION_CHANGED',
  ASSUMPTION_SOURCE_MISSING: 'ASSUMPTION_SOURCE_MISSING',
  ASSUMPTION_SOURCE_CHANGED: 'ASSUMPTION_SOURCE_CHANGED',
  ASSUMPTION_HASH_MISSING: 'ASSUMPTION_HASH_MISSING',
  ASSUMPTION_HASH_CHANGED: 'ASSUMPTION_HASH_CHANGED',
  LEGACY_GENERATION_STATE_CONFLICT: 'LEGACY_GENERATION_STATE_CONFLICT',
});

function asString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Shared read-only freshness gate for personalized financial consumers. */
export function assessRecommendationFreshness({
  profile,
  recommendation,
  currentRegulatoryRuleVersion,
  recommendationRegulatoryRuleVersion = recommendation?.regulatoryRuleVersion ?? null,
  policyVersion = RECOMMENDATION_POLICY_VERSION,
  allocationRevision = null,
  currentAllocation = allocationRevision,
  currentAllocationSource = recommendation?.currentAllocationSource ?? null,
  assumptionVersion = PROJECTION_ASSUMPTION_VERSION,
  assumptionHash = PROJECTION_ASSUMPTION_POLICY_HASH,
  assumptionSource = PROJECTION_ASSUMPTION_SOURCE,
  requirePolicyVersion = false,
  requireAllocationState = false,
  requireAssumptionProvenance = false,
} = {}) {
  const reasonCodes = [];
  const profilePresent = Boolean(profile);
  const recommendationPresent = Boolean(recommendation);
  const modelVersion = asString(recommendation?.modelVersion);
  const observedProfileHash = asString(recommendation?.profileInputHash);
  const expectedProfileVersion = profile?.version == null ? null : Number(profile.version);
  const observedProfileVersion = Number(recommendation?.profileVersion);
  const currentRegulatoryVersion = asString(currentRegulatoryRuleVersion);
  const observedRegulatoryVersion = asString(recommendationRegulatoryRuleVersion);
  const observedRecommendationPolicyVersion = asString(
    recommendation?.recommendationPolicyVersion
      ?? recommendation?.responseSnapshot?.recommendation?.recommendation_policy_version
      ?? recommendation?.responseSnapshot?.recommendation_policy_version,
  );
  let expectedProfileHash = null;

  if (!profilePresent) reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.PROFILE_MISSING);
  if (profilePresent && requireAllocationState
      && (!Number.isSafeInteger(expectedProfileVersion) || expectedProfileVersion < 1)) {
    reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.PROFILE_VERSION_MISSING);
  }
  if (!recommendationPresent) reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.RECOMMENDATION_MISSING);
  if (recommendationPresent && !modelVersion) reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.MODEL_VERSION_MISSING);
  if (recommendationPresent && !observedProfileHash) reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.PROFILE_HASH_MISSING);
  if (recommendationPresent && (!Number.isSafeInteger(observedProfileVersion) || observedProfileVersion < 1)) {
    reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.PROFILE_VERSION_MISSING);
  } else if (profilePresent && Number.isSafeInteger(expectedProfileVersion) && expectedProfileVersion > 0
      && observedProfileVersion !== expectedProfileVersion) {
    reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.PROFILE_VERSION_CHANGED);
  }

  if (recommendationPresent && !observedRecommendationPolicyVersion && requirePolicyVersion) {
    reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.RECOMMENDATION_POLICY_MISSING);
  } else if (recommendationPresent && observedRecommendationPolicyVersion && observedRecommendationPolicyVersion !== policyVersion) {
    reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.RECOMMENDATION_POLICY_CHANGED);
  }

  if (profilePresent && modelVersion) {
    try {
      expectedProfileHash = buildRecommendationProfileHash(profile, { modelVersion, policyVersion });
    } catch {
      reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.PROFILE_CHANGED);
    }
  }
  if (observedProfileHash && expectedProfileHash && observedProfileHash !== expectedProfileHash) {
    reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.PROFILE_CHANGED);
  }

  if (recommendationPresent && !currentRegulatoryVersion) {
    reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.REGULATORY_VERSION_UNAVAILABLE);
  } else if (recommendationPresent && currentRegulatoryVersion && observedRegulatoryVersion !== currentRegulatoryVersion) {
    reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.REGULATORY_POLICY_CHANGED);
  }

  const revision = allocationRevision;
  if (recommendationPresent && requireAllocationState && (!revision || !Number.isInteger(Number(revision.revision)) || Number(revision.revision) < 1)) {
    reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.ALLOCATION_REVISION_MISSING);
  }
  if (revision) {
    const recommendationId = String(recommendation?._id ?? recommendation?.id ?? '');
    if (String(revision.recommendationId ?? '') !== recommendationId) reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.ALLOCATION_RECOMMENDATION_MISMATCH);
    if (String(revision.profileId ?? '') !== String(recommendation?.profileId ?? '')) reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.ALLOCATION_PROFILE_CHANGED);
    if (String(revision.userId ?? '') !== String(recommendation?.userId ?? '')) reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.ALLOCATION_USER_MISMATCH);
    if (!asString(revision.source)) reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.ALLOCATION_SOURCE_MISSING);
    if (observedProfileHash && revision.profileInputHash && revision.profileInputHash !== observedProfileHash) reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.ALLOCATION_PROFILE_CHANGED);
    const revisionProfileVersion = Number(revision.profileVersion);
    if (!Number.isSafeInteger(revisionProfileVersion) || revisionProfileVersion < 1) {
      reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.ALLOCATION_PROFILE_VERSION_MISSING);
    } else if (Number.isSafeInteger(expectedProfileVersion) && expectedProfileVersion > 0
        && revisionProfileVersion !== expectedProfileVersion) {
      reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.PROFILE_VERSION_CHANGED);
    }
    if (!Array.isArray(revision.instruments) || revision.instruments.length === 0) reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.ALLOCATION_REVISION_INVALID);
  }

  const instruments = currentAllocation?.instruments || revision?.instruments || recommendation?.instruments || [];
  if (recommendationPresent && requireAssumptionProvenance) {
    if (!asString(assumptionVersion)) reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.ASSUMPTION_VERSION_MISSING);
    for (const instrument of instruments) {
      const version = asString(instrument?.returnAssumptionVersion);
      if (!version) reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.ASSUMPTION_VERSION_MISSING);
      else if (version !== assumptionVersion) reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.ASSUMPTION_VERSION_CHANGED);
      const source = asString(instrument?.returnSource);
      if (!source) reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.ASSUMPTION_SOURCE_MISSING);
      else if (source !== assumptionSource) reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.ASSUMPTION_SOURCE_CHANGED);
      const hash = asString(instrument?.returnAssumptionHash);
      if (!hash) reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.ASSUMPTION_HASH_MISSING);
      else if (hash !== assumptionHash) reasonCodes.push(RECOMMENDATION_FRESHNESS_REASON_CODES.ASSUMPTION_HASH_CHANGED);
    }
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
    observedProfileVersion: Number.isSafeInteger(observedProfileVersion) ? observedProfileVersion : null,
    expectedProfileVersion: profilePresent && Number.isSafeInteger(expectedProfileVersion) ? expectedProfileVersion : null,
    observedRegulatoryVersion,
    currentRegulatoryVersion,
    policyVersion,
    observedRecommendationPolicyVersion,
    allocationRevision: revision?.revision ?? null,
    currentAllocationSource,
    assumptionVersion,
    assumptionHash,
    assumptionSource,
  });
}
