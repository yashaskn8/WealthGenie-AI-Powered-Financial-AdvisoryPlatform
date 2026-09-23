import test from 'node:test';
import assert from 'node:assert/strict';
import { assessAdvisoryStateBinding } from '../services/advisoryBinding.js';

const state = {
  recommendation: {
    _id: '64b000000000000000000001',
    profileId: '64b000000000000000000002',
    profileInputHash: 'a'.repeat(64),
    recommendationPolicyVersion: 'policy-1',
    regulatoryRuleVersion: 'tax-policy-1',
  },
  allocationRevision: {
    _id: '64b000000000000000000003',
    revision: 2,
    returnAssumptionHash: 'b'.repeat(64),
  },
  profileVersion: 4,
  portfolioFingerprint: 'c'.repeat(64),
  recommendationFingerprint: 'd'.repeat(64),
};

function metadata(overrides = {}) {
  return {
    status: 'READY',
    recommendationId: state.recommendation._id,
    profileId: state.recommendation.profileId,
    allocationRevision: 2,
    allocationRevisionId: state.allocationRevision._id,
    portfolioFingerprint: state.portfolioFingerprint,
    profileInputHash: state.recommendation.profileInputHash,
    recommendationFingerprint: state.recommendationFingerprint,
    recommendationPolicyVersion: state.recommendation.recommendationPolicyVersion,
    regulatoryRuleVersion: state.recommendation.regulatoryRuleVersion,
    returnAssumptionHash: state.allocationRevision.returnAssumptionHash,
    profileVersion: 4,
    generatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

test('advisory binding accepts only the exact current recommendation and allocation provenance', () => {
  assert.deepEqual(assessAdvisoryStateBinding(metadata(), state), { fresh: true, reason: null });
  for (const overrides of [
    { allocationRevision: 1 },
    { allocationRevisionId: '64b000000000000000000099' },
    { recommendationFingerprint: 'e'.repeat(64) },
    { profileVersion: 3 },
    { returnAssumptionHash: 'f'.repeat(64) },
    { generatedAt: null },
  ]) {
    assert.equal(assessAdvisoryStateBinding(metadata(overrides), state).fresh, false);
  }
});

test('a generating advisory may be bound before completion but cannot cross allocation revisions', () => {
  const generating = metadata({ status: 'GENERATING', generatedAt: undefined });
  assert.equal(assessAdvisoryStateBinding(generating, state).fresh, true);
  assert.equal(assessAdvisoryStateBinding({ ...generating, portfolioFingerprint: 'f'.repeat(64) }, state).fresh, false);
});
