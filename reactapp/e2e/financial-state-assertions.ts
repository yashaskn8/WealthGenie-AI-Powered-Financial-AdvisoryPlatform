import { expect } from '@playwright/test';

type JsonRecord = Record<string, unknown>;

/** Assert that an API response can safely be consumed as canonical current state. */
export function expectCurrentFinancialBinding(
  state: JsonRecord,
  { profileId, profileVersion }: { profileId: string; profileVersion: number },
) {
  const freshness = state.calculation_freshness as JsonRecord | undefined;
  const provenance = state.state_provenance as JsonRecord | undefined;
  const recommendationId = String(state.recommendationId ?? '');
  const allocationRevisionId = String(state.allocation_revision_id ?? '');
  const portfolioFingerprint = String(state.portfolio_fingerprint ?? '');
  const recommendationFingerprint = String(state.recommendation_fingerprint ?? '');
  const profileInputHash = String(state.profile_input_hash ?? '');

  expect(state.response_state).toBe('CURRENT');
  expect(state.profileId).toBe(profileId);
  expect(Number(state.profile_version)).toBe(profileVersion);
  expect(recommendationId).toMatch(/^[a-f\d]{24}$/i);
  expect(Number(state.allocation_revision)).toBeGreaterThanOrEqual(1);
  expect(allocationRevisionId).toMatch(/^[a-f\d]{24}$/i);
  expect(portfolioFingerprint).toMatch(/^[a-f\d]{64}$/i);
  expect(recommendationFingerprint).toMatch(/^[a-f\d]{64}$/i);
  expect(profileInputHash).toMatch(/^[a-f\d]{64}$/i);
  expect(freshness).toMatchObject({
    fresh: true,
    reasonCodes: [],
    profilePresent: true,
    recommendationPresent: true,
    expectedProfileHash: profileInputHash,
    observedProfileHash: profileInputHash,
    expectedProfileVersion: profileVersion,
    observedProfileVersion: profileVersion,
    allocationRevision: state.allocation_revision,
    currentAllocationSource: state.current_allocation_source,
    policyVersion: state.recommendation_policy_version,
    observedRecommendationPolicyVersion: state.recommendation_policy_version,
    observedRegulatoryVersion: state.regulatory_rule_version,
    currentRegulatoryVersion: state.regulatory_rule_version,
    assumptionHash: state.return_assumption_hash,
  });
  expect(provenance).toMatchObject({
    status: 'PERSISTED_REVISION',
    recommendationId,
    allocationRevision: state.allocation_revision,
    allocationRevisionId,
    profileVersion,
    profileInputHash,
    portfolioFingerprint,
    recommendationFingerprint,
    recommendationPolicyVersion: state.recommendation_policy_version,
    regulatoryRuleVersion: state.regulatory_rule_version,
    returnAssumptionHash: state.return_assumption_hash,
    allocationSource: state.current_allocation_source,
  });
}
