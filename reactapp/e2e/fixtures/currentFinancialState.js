import { createHash } from 'node:crypto';
import { getTaxPolicyCatalog } from '../../../server/services/taxEngine.js';

const digest = value => createHash('sha256').update(value).digest('hex');

/** A strict, internally consistent API fixture for the current recommendation resolver. */
export function currentFinancialState({
  profileId,
  profileVersion,
  recommendationId,
  instruments,
  monthlyAllocations = {},
  recommendationPolicyVersion = 'recommendation-policy-e2e-v1',
  regulatoryRuleVersion = 'regulatory-policy-e2e-v1',
}) {
  const allocationRevision = 1;
  const allocationRevisionId = '64b0000000000000000000a1';
  const stateId = '64b0000000000000000000a2';
  const profileInputHash = digest(`${profileId}:${profileVersion}:profile`);
  const portfolioFingerprint = digest(`${recommendationId}:portfolio`);
  const recommendationFingerprint = digest(`${recommendationId}:recommendation`);
  const returnAssumptionVersion = 'wealthgenie-projection-assumptions-1.0.0';
  const returnAssumptionSource = 'WEALTHGENIE_MODEL_POLICY';
  const returnAssumptionHash = digest(returnAssumptionVersion);
  const currentAllocationSource = 'ORIGINAL_RECOMMENDATION';

  const stateProvenance = {
    status: 'PERSISTED_REVISION',
    stateId,
    recommendationId,
    allocationSource: currentAllocationSource,
    allocationRevision,
    allocationRevisionId,
    profileVersion,
    profileInputHash,
    portfolioFingerprint,
    recommendationFingerprint,
    recommendationPolicyVersion,
    regulatoryRuleVersion,
    returnAssumptionVersion,
    returnAssumptionHash,
    returnAssumptionSource,
    previousAllocationRevision: null,
    previousAllocationRevisionId: null,
  };

  return {
    response_state: 'CURRENT',
    profileId,
    profile_version: profileVersion,
    profile_input_hash: profileInputHash,
    recommendationId,
    recommendation_id: recommendationId,
    recommendation_fingerprint: recommendationFingerprint,
    allocation_revision: allocationRevision,
    allocation_revision_id: allocationRevisionId,
    previous_allocation_revision: null,
    previous_allocation_revision_id: null,
    portfolio_fingerprint: portfolioFingerprint,
    current_allocation_source: currentAllocationSource,
    recommendation_policy_version: recommendationPolicyVersion,
    regulatory_rule_version: regulatoryRuleVersion,
    return_assumption_version: returnAssumptionVersion,
    return_assumption_hash: returnAssumptionHash,
    return_assumption_source: returnAssumptionSource,
    calculation_freshness: {
      fresh: true,
      reasonCodes: [],
      profilePresent: true,
      recommendationPresent: true,
      expectedProfileHash: profileInputHash,
      observedProfileHash: profileInputHash,
      expectedProfileVersion: profileVersion,
      observedProfileVersion: profileVersion,
      allocationRevision,
      currentAllocationSource,
      policyVersion: recommendationPolicyVersion,
      observedRecommendationPolicyVersion: recommendationPolicyVersion,
      observedRegulatoryVersion: regulatoryRuleVersion,
      currentRegulatoryVersion: regulatoryRuleVersion,
      assumptionVersion: returnAssumptionVersion,
      assumptionHash: returnAssumptionHash,
      assumptionSource: returnAssumptionSource,
    },
    state_provenance: stateProvenance,
    instruments,
    dashboard_projection: { instrument_monthly_allocations: monthlyAllocations },
    explanation: 'Fixture explanation from the current server-bound recommendation.',
    advisory_text: 'Your portfolio is ready.',
    advisory_explanation: { status: 'READY' },
    return_data_class: 'MODEL_ASSUMPTION',
    provider_forecast: false,
  };
}

export async function installUnexpectedApiGuard(page) {
  const unexpected = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    unexpected.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({
      status: 501,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'UNMOCKED_E2E_ENDPOINT' }),
    });
  });
  return unexpected;
}

export async function mockTaxPolicyCatalog(page) {
  await page.route('**/api/tax/policies', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(getTaxPolicyCatalog()),
    });
  });
}

export async function mockUnavailableSimulation(page, endpoint) {
  await page.route(`**/api/${endpoint}`, async route => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'TEST_SIMULATION_UNAVAILABLE',
        message: 'No projection result is supplied by this UI-only browser fixture.',
      }),
    });
  });
}
