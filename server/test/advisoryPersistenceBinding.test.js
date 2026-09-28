import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertRecommendationResponseBinding,
  persistAdvisoryAtomically,
} from '../services/advisoryPersistence.js';

const recommendation = {
  _id: '64b000000000000000000001',
  userId: '64b000000000000000000002',
  profileId: '64b000000000000000000003',
  instruments: [{
    id: 'fund-a',
    allocationWeight: 1,
    nominalReturn: 8,
    riskScore: 2,
    returnAssumptionVersion: 'assumption-1',
    returnAssumptionHash: 'a'.repeat(64),
  }],
};

test('advisory persistence rejects a response bound to another recommendation', async () => {
  await assert.rejects(persistAdvisoryAtomically({
    recommendation,
    response: { recommendationId: '64b000000000000000000004' },
  }), error => error.code === 'RECOMMENDATION_RESPONSE_BINDING_MISMATCH');
});

test('advisory persistence rejects response generation instruments that differ from the immutable row', async () => {
  await assert.rejects(persistAdvisoryAtomically({
    recommendation,
    response: {
      recommendationId: recommendation._id,
      profileId: recommendation.profileId,
      instruments: [{ ...recommendation.instruments[0], allocationWeight: 0.9 }],
    },
  }), error => error.code === 'RECOMMENDATION_RESPONSE_BINDING_MISMATCH');
});

test('advisory persistence accepts a matching wrapped generation response', () => {
  assert.doesNotThrow(() => assertRecommendationResponseBinding(recommendation, {
    profile: { profileId: recommendation.profileId },
    recommendation: {
      recommendationId: recommendation._id,
      profileId: recommendation.profileId,
      instruments: recommendation.instruments,
    },
    completion: { status: 'COMMITTED' },
  }));
});
