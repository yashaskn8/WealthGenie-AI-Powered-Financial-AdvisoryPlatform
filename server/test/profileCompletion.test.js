import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { runPipeline } from '../services/RecommendationPipeline.js';
import {
  buildRecommendationProfile,
  buildRecommendationProfileHash,
  FINANCIAL_PROFILE_SCHEMA_VERSION,
  RECOMMENDATION_POLICY_VERSION,
} from '../services/recommendationProfile.js';
import {
  marketContextIdentity,
  rebindCoreRecommendation,
} from '../services/coreRecommendation.js';
import {
  PROFILE_CANDIDATE_SCHEMA_VERSION,
  PROFILE_CANDIDATE_TTL_MS,
  validateProfileRecommendationCandidate,
} from '../services/profileCompletion.js';
import { canonicalSha256 } from '../utils/canonicalJson.js';
import { canonicalProfile } from './helpers/canonicalProfile.js';

const profile = buildRecommendationProfile(canonicalProfile());
const userId = new mongoose.Types.ObjectId().toString();
const modelVersion = 'model-test-1';
const regulatoryRuleVersion = 'india-income-tax-FY2026-27-v1';
const marketContext = {
  status: 'LAST_AVAILABLE',
  context: 'NORMAL',
  policyVersion: 'market-context-policy-1.0.0',
  evaluatedAt: '2026-09-21T10:00:00.000Z',
  marketSnapshot: {
    schemaVersion: 'market-snapshot-1.0.0',
    observedAt: '2026-09-21T09:59:00.000Z',
    policyOutput: { policyVersion: 'market-context-policy-1.0.0' },
  },
};

function makeCandidate(overrides = {}) {
  const pipeline = runPipeline(profile, {
    model_version: modelVersion,
    confidence_scores: {},
  });
  const identity = marketContextIdentity(marketContext);
  const profileInputHash = buildRecommendationProfileHash(profile, { modelVersion });
  const result = {
    canonicalProfile: profile,
    recommendationData: { instruments: pipeline.instruments },
    auditRecordData: { correlationId: 'correlation-test' },
    response: { instruments: pipeline.instruments },
    modelVersion,
    regulatoryRuleVersion,
    marketContext,
    marketContextIdentity: identity,
    profileInputHash,
    recommendationPolicyVersion: RECOMMENDATION_POLICY_VERSION,
    financialProfileSchemaVersion: FINANCIAL_PROFILE_SCHEMA_VERSION,
  };
  const createdAt = new Date('2026-09-21T10:00:00.000Z');
  const candidate = {
    schemaVersion: PROFILE_CANDIDATE_SCHEMA_VERSION,
    candidateId: '4f4f4f4f-1111-4111-8111-111111111111',
    userId,
    profileInputHash,
    modelVersion,
    recommendationPolicyVersion: RECOMMENDATION_POLICY_VERSION,
    regulatoryRuleVersion,
    financialProfileSchemaVersion: FINANCIAL_PROFILE_SCHEMA_VERSION,
    marketContextIdentity: identity,
    marketObservedAt: marketContext.marketSnapshot.observedAt,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + PROFILE_CANDIDATE_TTL_MS).toISOString(),
    result,
    resultHash: canonicalSha256(result),
    ...overrides,
  };
  if (overrides.result && !Object.hasOwn(overrides, 'resultHash')) candidate.resultHash = canonicalSha256(candidate.result);
  return candidate;
}

test('an exact, unexpired candidate passes every binding and safety check', () => {
  const result = validateProfileRecommendationCandidate({
    candidate: makeCandidate(),
    userId,
    canonicalProfile: profile,
    regulatoryRuleVersion,
    marketContext: { ...marketContext, evaluatedAt: '2026-09-21T10:01:00.000Z' },
    now: new Date('2026-09-21T10:01:00.000Z'),
  });
  assert.deepEqual(result, { valid: true, reason: 'CANDIDATE_VALID' });
});

test('profile changes reject the same candidate without trusting stale output', () => {
  for (const change of [
    { monthlySavings: 15001 },
    { riskTolerance: 'Aggressive' },
    { investmentHorizonYears: 11 },
    { investmentGoals: ['Retirement'] },
  ]) {
    const changed = buildRecommendationProfile({ ...profile, ...change });
    const result = validateProfileRecommendationCandidate({
      candidate: makeCandidate(),
      userId,
      canonicalProfile: changed,
      regulatoryRuleVersion,
      marketContext,
      now: new Date('2026-09-21T10:01:00.000Z'),
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'CANDIDATE_PROFILE_MISMATCH');
  }
});

test('expired, cross-user, policy, regulatory, and market-mismatched candidates fail closed', () => {
  const base = makeCandidate();
  const validNow = new Date('2026-09-21T10:01:00.000Z');
  assert.equal(validateProfileRecommendationCandidate({
    candidate: { ...base, expiresAt: '2026-09-21T10:00:00.000Z' },
    userId,
    canonicalProfile: profile,
    regulatoryRuleVersion,
    marketContext,
    now: new Date('2026-09-21T10:01:00.000Z'),
  }).reason, 'CANDIDATE_EXPIRED');
  assert.equal(validateProfileRecommendationCandidate({
    candidate: base,
    userId: new mongoose.Types.ObjectId().toString(),
    canonicalProfile: profile,
    regulatoryRuleVersion,
    marketContext,
    now: validNow,
  }).reason, 'CANDIDATE_OWNER_MISMATCH');
  assert.equal(validateProfileRecommendationCandidate({
    candidate: { ...base, recommendationPolicyVersion: 'old-policy' },
    userId,
    canonicalProfile: profile,
    regulatoryRuleVersion,
    marketContext,
    now: validNow,
  }).reason, 'CANDIDATE_POLICY_VERSION_MISMATCH');
  assert.equal(validateProfileRecommendationCandidate({
    candidate: base,
    userId,
    canonicalProfile: profile,
    regulatoryRuleVersion: 'old-regulatory-policy',
    marketContext,
    now: validNow,
  }).reason, 'CANDIDATE_REGULATORY_VERSION_MISMATCH');
  assert.equal(validateProfileRecommendationCandidate({
    candidate: base,
    userId,
    canonicalProfile: profile,
    regulatoryRuleVersion,
    marketContext: { ...marketContext, context: 'RISK_OFF' },
    now: validNow,
  }).reason, 'CANDIDATE_MARKET_CONTEXT_MISMATCH');
});

test('candidate result corruption is rejected and cannot be rebound', () => {
  const candidate = makeCandidate();
  candidate.result.response.instruments[0].allocationWeight += 0.01;
  const result = validateProfileRecommendationCandidate({
    candidate,
    userId,
    canonicalProfile: profile,
    regulatoryRuleVersion,
    marketContext,
    now: new Date('2026-09-21T10:01:00.000Z'),
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'CANDIDATE_RESULT_INTEGRITY_FAILURE');
});

test('valid candidate output is rebound to fresh durable identifiers without recomputing ML', () => {
  const candidate = makeCandidate();
  const rebound = rebindCoreRecommendation(candidate.result, {
    userId,
    profileId: new mongoose.Types.ObjectId(),
    correlationId: 'final-correlation',
    traceId: 'final-trace',
  });
  assert.notEqual(String(rebound.recommendationData._id), 'undefined');
  assert.equal(rebound.auditRecordData.correlationId, 'final-correlation');
  assert.equal(rebound.recommendationData.userId, userId);
  assert.equal(rebound.response.instruments.length, candidate.result.response.instruments.length);
});
