import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecommendationProfileHash } from '../services/recommendationProfile.js';
import { assessRecommendationFreshness } from '../services/recommendationFreshness.js';

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

function recommendation(overrides = {}) {
  const modelVersion = overrides.modelVersion || 'model-1.0.0';
  return {
    _id: '64b000000000000000000002',
    modelVersion,
    profileVersion: overrides.profileVersion ?? 1,
    profileInputHash: overrides.profileInputHash
      || buildRecommendationProfileHash(profile, { modelVersion }),
    regulatoryRuleVersion: overrides.regulatoryRuleVersion || 'FY2025-26',
    ...overrides,
  };
}

test('current profile and recommendation are fresh', () => {
  const result = assessRecommendationFreshness({
    profile,
    recommendation: recommendation(),
    currentRegulatoryRuleVersion: 'FY2025-26',
  });
  assert.equal(result.fresh, true);
  assert.deepEqual(result.reasonCodes, []);
});
test('missing recommendation is explicitly actionable', () => {
  const result = assessRecommendationFreshness({ profile, recommendation: null, currentRegulatoryRuleVersion: 'FY2025-26' });
  assert.equal(result.fresh, false);
  assert.ok(result.reasonCodes.includes('RECOMMENDATION_MISSING'));
});

test('changed profile fingerprint is stale', () => {
  const changed = { ...profile, monthlySavings: 35000 };
  const result = assessRecommendationFreshness({
    profile: changed,
    recommendation: recommendation(),
    currentRegulatoryRuleVersion: 'FY2025-26',
  });
  assert.equal(result.fresh, false);
  assert.ok(result.reasonCodes.includes('PROFILE_CHANGED'));
});

test('regulatory rollover is stale without touching the recommendation', () => {
  const result = assessRecommendationFreshness({
    profile,
    recommendation: recommendation({ regulatoryRuleVersion: 'FY2024-25' }),
    currentRegulatoryRuleVersion: 'FY2025-26',
  });
  assert.equal(result.fresh, false);
  assert.ok(result.reasonCodes.includes('REGULATORY_POLICY_CHANGED'));
});

test('missing model and profile metadata fail closed', () => {
  const result = assessRecommendationFreshness({
    profile,
    recommendation: { regulatoryRuleVersion: 'FY2025-26' },
    currentRegulatoryRuleVersion: 'FY2025-26',
  });
  assert.deepEqual(result.reasonCodes.sort(), ['MODEL_VERSION_MISSING', 'PROFILE_HASH_MISSING', 'PROFILE_VERSION_MISSING']);
});

test('a profile edit that preserves canonical values still invalidates an older profile version', () => {
  const result = assessRecommendationFreshness({
    profile: { ...profile, version: 2 },
    recommendation: recommendation({ profileVersion: 1 }),
    currentRegulatoryRuleVersion: 'FY2025-26',
  });
  assert.equal(result.fresh, false);
  assert.ok(result.reasonCodes.includes('PROFILE_VERSION_CHANGED'));
});

test('missing current regulatory version is unavailable, not fresh', () => {
  const result = assessRecommendationFreshness({
    profile,
    recommendation: recommendation(),
    currentRegulatoryRuleVersion: null,
  });
  assert.equal(result.fresh, false);
  assert.ok(result.reasonCodes.includes('REGULATORY_VERSION_UNAVAILABLE'));
});
