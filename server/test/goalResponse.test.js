import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCurrentGoalResponse, buildGoalAdvisoryMetadata } from '../services/goalResponse.js';
import { buildGoalCalculationInputFingerprint, GOAL_CALCULATION_POLICY_VERSION } from '../services/goalCalculationProvenance.js';

const source = {
  recommendation: {
    _id: 'recommendation-1',
    profileId: 'profile-1',
    profileInputHash: 'a'.repeat(64),
    modelVersion: 'model-1',
    recommendationPolicyVersion: 'policy-1',
    regulatoryRuleVersion: 'tax-policy-1',
  },
  allocationRevision: {
    _id: 'allocation-2',
    revision: 2,
    returnAssumptionVersion: 'assumptions-1',
    returnAssumptionHash: 'b'.repeat(64),
    returnAssumptionSource: 'WEALTHGENIE_MODEL_POLICY',
  },
  profileVersion: 4,
  recommendationFingerprint: 'c'.repeat(64),
  portfolioFingerprint: 'd'.repeat(64),
  freshness: { fresh: true, reasonCodes: [] },
};

function goal() {
  return {
    _id: 'goal-1',
    profileId: 'profile-1',
    target_amount: 1000000,
    target_date: new Date('2035-01-01T00:00:00.000Z'),
    current_savings: 100000,
    inflation_assumption: 0.05,
    sourceRecommendationId: 'recommendation-1',
    sourceAllocationRevision: 2,
    sourceAllocationRevisionId: 'allocation-2',
    sourceProfileInputHash: source.recommendation.profileInputHash,
    sourceProfileVersion: source.profileVersion,
    sourceModelVersion: source.recommendation.modelVersion,
    sourceRecommendationPolicyVersion: source.recommendation.recommendationPolicyVersion,
    sourceRegulatoryRuleVersion: source.recommendation.regulatoryRuleVersion,
    sourceReturnAssumptionVersion: source.allocationRevision.returnAssumptionVersion,
    sourceReturnAssumptionHash: source.allocationRevision.returnAssumptionHash,
    return_assumption_source: source.allocationRevision.returnAssumptionSource,
    sourceRecommendationFingerprint: source.recommendationFingerprint,
    sourcePortfolioFingerprint: source.portfolioFingerprint,
    sourceGoalCalculationInputFingerprint: null,
    sourceGoalCalculationPolicyVersion: GOAL_CALCULATION_POLICY_VERSION,
    recommended_sip: 5000,
    probability_of_success: 0.72,
    status: 'on_track',
    chart_data: [{ year: 1, p50: 100 }],
    gemini_advice: 'Keep the current contribution.',
  };
}

test('goal response suppresses derived values and advice when source freshness is missing', () => {
  const response = buildCurrentGoalResponse(goal());
  assert.equal(response.calculation_freshness.fresh, false);
  assert.equal(response.recommended_sip, null);
  assert.equal(response.probability_of_success, null);
  assert.deepEqual(response.chartData, []);
  assert.equal(response.gemini_advice, null);
  assert.equal(response.advisory_freshness.fresh, false);
});

test('goal advisory metadata is accepted only for the exact current source state', () => {
  const currentGoal = goal();
  currentGoal.sourceGoalCalculationInputFingerprint = buildGoalCalculationInputFingerprint(currentGoal);
  currentGoal.advisoryMetadata = buildGoalAdvisoryMetadata({ goal: currentGoal, state: source });
  const response = buildCurrentGoalResponse(currentGoal, { state: source });
  assert.equal(response.calculation_freshness.fresh, true);
  assert.equal(response.advisory_freshness.fresh, true);
  assert.equal(response.gemini_advice, currentGoal.gemini_advice);

  const stale = buildCurrentGoalResponse(currentGoal, {
    state: { ...source, allocationRevision: { ...source.allocationRevision, revision: 3 } },
  });
  assert.equal(stale.calculation_freshness.fresh, false);
  assert.equal(stale.recommended_sip, null);
  assert.equal(stale.gemini_advice, null);
});

test('goal advisory is stale when a displayed goal input changes without a matching recalculation', () => {
  const currentGoal = goal();
  currentGoal.sourceGoalCalculationInputFingerprint = buildGoalCalculationInputFingerprint(currentGoal);
  currentGoal.advisoryMetadata = buildGoalAdvisoryMetadata({ goal: currentGoal, state: source });
  const changed = buildCurrentGoalResponse({ ...currentGoal, target_amount: currentGoal.target_amount + 1 }, { state: source });
  assert.equal(changed.calculation_freshness.fresh, false);
  assert.ok(changed.calculation_freshness.reasonCodes.includes('STALE_GOAL_INPUTS'));
  assert.equal(changed.advisory_freshness.fresh, false);
  assert.equal(changed.gemini_advice, null);
});
