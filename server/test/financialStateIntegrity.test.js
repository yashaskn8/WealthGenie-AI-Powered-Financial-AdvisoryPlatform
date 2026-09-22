import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPortfolioFingerprint, buildRecommendationFingerprint } from '../services/recommendationFingerprint.js';
import { assessRecommendationFreshness } from '../services/recommendationFreshness.js';
import { assessGoalCalculationFreshness } from '../services/recommendationState.js';
import { buildRecommendationProfileHash } from '../services/recommendationProfile.js';

const profile = {
  monthlyTakeHome: 100000,
  monthlySavings: 30000,
  age: 32,
  riskTolerance: 'Moderate',
  soldPropertyProceeds: null,
  hasLumpSum: false,
  lumpSumAmount: 0,
  liquidSavings: 100000,
  emiBurdenPct: null,
  financialDependents: 1,
  emergencyFundMonths: 6,
  investmentGoals: ['Wealth Growth'],
  investmentHorizonYears: 10,
};

const instruments = [
  {
    id: 'FD', allocationWeight: 0.6, nominalReturn: 7.5, riskScore: 1,
    returnAssumptionVersion: 'wealthgenie-projection-assumptions-1.0.0',
    returnAssumptionHash: 'a'.repeat(64), returnSource: 'WEALTHGENIE_MODEL_POLICY',
  },
  {
    id: 'ETF', allocationWeight: 0.4, nominalReturn: 14.5, riskScore: 3,
    returnAssumptionVersion: 'wealthgenie-projection-assumptions-1.0.0',
    returnAssumptionHash: 'a'.repeat(64), returnSource: 'WEALTHGENIE_MODEL_POLICY',
  },
];

function state() {
  const recommendation = {
    _id: '64b000000000000000000002', userId: '64b000000000000000000003', profileId: '64b000000000000000000004',
    modelVersion: 'model-1.0.0', regulatoryRuleVersion: 'tax-policy-FY2026-27-v2',
    recommendationPolicyVersion: 'suitability-freeze-1.1.0',
    profileInputHash: buildRecommendationProfileHash(profile, { modelVersion: 'model-1.0.0' }),
  };
  const allocationRevision = {
    _id: '64b000000000000000000005', recommendationId: recommendation._id,
    profileId: recommendation.profileId, userId: recommendation.userId, revision: 2,
    source: 'USER_REBALANCED', instruments, profileInputHash: recommendation.profileInputHash,
    returnAssumptionVersion: 'wealthgenie-projection-assumptions-1.0.0',
  };
  const portfolioFingerprint = buildPortfolioFingerprint(instruments);
  return { recommendation, allocationRevision, portfolioFingerprint, freshness: { fresh: true, reasonCodes: [] } };
}

test('portfolio fingerprints are deterministic and independent of instrument order', () => {
  assert.equal(buildPortfolioFingerprint(instruments), buildPortfolioFingerprint([...instruments].reverse()));
  assert.notEqual(buildPortfolioFingerprint(instruments), buildPortfolioFingerprint([{ ...instruments[0], allocationWeight: 0.5 }, instruments[1]]));
});

test('recommendation fingerprint includes allocation revision identity', () => {
  const current = state();
  const base = {
    recommendationId: current.recommendation._id,
    profileInputHash: current.recommendation.profileInputHash,
    modelVersion: current.recommendation.modelVersion,
    recommendationPolicyVersion: current.recommendation.recommendationPolicyVersion,
    regulatoryRuleVersion: current.recommendation.regulatoryRuleVersion,
    returnAssumptionVersion: current.allocationRevision.returnAssumptionVersion,
    instruments,
  };
  assert.notEqual(buildRecommendationFingerprint({ ...base, allocationRevision: 1 }), buildRecommendationFingerprint({ ...base, allocationRevision: 2 }));
});

test('strict freshness rejects a missing or mismatched allocation provenance', () => {
  const current = state();
  const fresh = assessRecommendationFreshness({
    profile, recommendation: current.recommendation,
    currentRegulatoryRuleVersion: current.recommendation.regulatoryRuleVersion,
    allocationRevision: current.allocationRevision,
    requirePolicyVersion: true, requireAllocationState: true, requireAssumptionProvenance: true,
  });
  assert.equal(fresh.fresh, true);
  const stale = assessRecommendationFreshness({
    profile, recommendation: current.recommendation,
    currentRegulatoryRuleVersion: current.recommendation.regulatoryRuleVersion,
    allocationRevision: { ...current.allocationRevision, revision: 0 },
    requirePolicyVersion: true, requireAllocationState: true, requireAssumptionProvenance: true,
  });
  assert.ok(stale.reasonCodes.includes('ALLOCATION_REVISION_MISSING'));
});

test('goal freshness identifies allocation and source-state changes', () => {
  const current = state();
  const goal = {
    sourceRecommendationId: current.recommendation._id,
    sourceAllocationRevision: 2,
    sourceProfileInputHash: current.recommendation.profileInputHash,
    sourceModelVersion: current.recommendation.modelVersion,
    sourceRecommendationPolicyVersion: current.recommendation.recommendationPolicyVersion,
    sourceRegulatoryRuleVersion: current.recommendation.regulatoryRuleVersion,
    sourceReturnAssumptionVersion: current.allocationRevision.returnAssumptionVersion,
    sourcePortfolioFingerprint: current.portfolioFingerprint,
  };
  assert.equal(assessGoalCalculationFreshness(goal, current).fresh, true);
  const stale = assessGoalCalculationFreshness({ ...goal, sourceAllocationRevision: 1 }, current);
  assert.ok(stale.reasonCodes.includes('STALE_ALLOCATION'));
});
