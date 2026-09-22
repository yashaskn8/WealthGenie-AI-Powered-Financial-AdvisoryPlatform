import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { recommendationWeightsSchema } from '../validation/financialSchemas.js';
import { buildCurrentRecommendationResponse } from '../services/recommendationResponse.js';
import { resolveCurrentRecommendationState } from '../services/recommendationState.js';
import { buildRecommendationProfileHash } from '../services/recommendationProfile.js';
import { buildPortfolioFingerprint } from '../services/recommendationFingerprint.js';
import {
  PROJECTION_ASSUMPTION_POLICY_HASH,
  PROJECTION_ASSUMPTION_SOURCE,
  PROJECTION_ASSUMPTION_VERSION,
} from '../services/instrumentConstants.js';

const ids = {
  user: '64b000000000000000000001',
  profile: '64b000000000000000000002',
  recommendation: '64b000000000000000000003',
  revision: '64b000000000000000000004',
};

const profile = {
  _id: ids.profile,
  userId: ids.user,
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

function query(value) {
  return {
    lean: async () => value,
    sort() { return this; },
    session() { return this; },
  };
}

function fixture() {
  const instruments = [{
    id: 'fd', type: 'FD', name: 'Bank Fixed Deposit', assetClass: 'Fixed Income',
    allocationWeight: 1, allocation_pct: 100, nominalReturn: 7.5, effectiveYield: 7.5,
    postTaxReturn: null, returnBasis: 'PRE_TAX_NOMINAL', returnDataClass: 'MODEL_ASSUMPTION',
    returnAssumptionVersion: PROJECTION_ASSUMPTION_VERSION,
    returnAssumptionHash: PROJECTION_ASSUMPTION_POLICY_HASH,
    returnSource: PROJECTION_ASSUMPTION_SOURCE,
    expenseRatio: 0, riskLevel: 'Low', riskScore: 1, lockIn: 0, tags: ['Wealth Growth'],
    score: 80,
  }];
  const generationInstruments = [{ ...instruments[0], allocationWeight: 0.5, allocation_pct: 50 }];
  const recommendation = {
    _id: ids.recommendation,
    userId: ids.user,
    profileId: ids.profile,
    instruments: generationInstruments,
    modelVersion: 'test-model-1',
    recommendationGeneration: 1,
    recommendationPolicyVersion: 'suitability-freeze-1.1.0',
    regulatoryRuleVersion: 'tax-policy-FY2026-27-v2',
    profileInputHash: buildRecommendationProfileHash(profile, { modelVersion: 'test-model-1' }),
    returnAssumptionHash: PROJECTION_ASSUMPTION_POLICY_HASH,
    responseSnapshot: {
      instruments: generationInstruments,
    },
  };
  const portfolioFingerprint = buildPortfolioFingerprint(instruments);
  const revision = {
    _id: ids.revision,
    recommendationId: ids.recommendation,
    profileId: ids.profile,
    userId: ids.user,
    revision: 1,
    source: 'ORIGINAL_RECOMMENDATION',
    instruments,
    profileInputHash: recommendation.profileInputHash,
    modelVersion: recommendation.modelVersion,
    recommendationPolicyVersion: recommendation.recommendationPolicyVersion,
    regulatoryRuleVersion: recommendation.regulatoryRuleVersion,
    returnAssumptionVersion: PROJECTION_ASSUMPTION_VERSION,
    returnAssumptionHash: PROJECTION_ASSUMPTION_POLICY_HASH,
    returnAssumptionSource: PROJECTION_ASSUMPTION_SOURCE,
    portfolioFingerprint,
  };
  const state = {
    _id: '64b000000000000000000005',
    userId: ids.user,
    profileId: ids.profile,
    currentRecommendationId: ids.recommendation,
    currentAllocationRevision: 1,
    currentAllocationRevisionId: ids.revision,
    generationRevision: 1,
    profileInputHash: recommendation.profileInputHash,
    portfolioFingerprint,
    returnAssumptionVersion: PROJECTION_ASSUMPTION_VERSION,
    returnAssumptionHash: PROJECTION_ASSUMPTION_POLICY_HASH,
    returnAssumptionSource: PROJECTION_ASSUMPTION_SOURCE,
  };
  const dependencies = {
    profileModel: { findOne: () => query(profile) },
    recommendationModel: { findOne: () => query(recommendation) },
    stateModel: { findOne: () => query(state) },
    revisionModel: { findOne: () => query(revision) },
    getCurrentRegulatoryRuleVersion: () => recommendation.regulatoryRuleVersion,
  };
  return { recommendation, revision, state, dependencies };
}

test('current response cannot resurrect generation-snapshot allocation fields', () => {
  const { recommendation, revision, state } = fixture();
  const response = buildCurrentRecommendationResponse({
    profile,
    recommendation,
    allocationRevision: revision,
    freshness: { fresh: true, reasonCodes: [] },
    provenance: { status: 'PERSISTED_REVISION' },
    portfolioFingerprint: revision.portfolioFingerprint,
  });
  assert.equal(response.instruments[0].allocationWeight, 1);
  assert.equal(response.generation_instruments[0].allocationWeight, 0.5);
  assert.equal(response.allocation_revision, state.currentAllocationRevision);
  assert.equal(response.portfolio_fingerprint, revision.portfolioFingerprint);
  assert.equal(response.recommendation_id, ids.recommendation);
});

test('valid canonical pointer resolves only the pointed revision', async () => {
  const { dependencies } = fixture();
  const state = await resolveCurrentRecommendationState({
    userId: ids.user,
    profileId: ids.profile,
    profile,
    requireFresh: true,
    dependencies,
  });
  assert.equal(state.currentAllocation.revision, 1);
  assert.equal(state.provenance.status, 'PERSISTED_REVISION');
});

test('tampered allocation contents fail closed through fingerprint verification', async () => {
  const { dependencies, revision } = fixture();
  dependencies.revisionModel = {
    findOne: () => query({ ...revision, instruments: [{ ...revision.instruments[0], allocationWeight: 0.9 }] }),
  };
  await assert.rejects(
    resolveCurrentRecommendationState({ userId: ids.user, profileId: ids.profile, profile, requireFresh: true, dependencies }),
    error => error.code === 'ALLOCATION_FINGERPRINT_MISMATCH' || error.reasonCodes?.includes('ALLOCATION_FINGERPRINT_MISMATCH'),
  );
});

test('missing canonical pointer cannot fall back to a persisted revision', async () => {
  const { dependencies, revision } = fixture();
  dependencies.stateModel = { findOne: () => query(null) };
  dependencies.revisionModel = { findOne: () => query(revision) };
  await assert.rejects(
    resolveCurrentRecommendationState({ userId: ids.user, profileId: ids.profile, profile, requireFresh: true, dependencies }),
    error => error.code === 'FINANCIAL_STATE_MISSING' || error.reasonCodes?.includes('FINANCIAL_STATE_MISSING'),
  );
});

test('legacy generation without a canonical pointer is never reported fresh', async () => {
  const { dependencies } = fixture();
  dependencies.stateModel = { findOne: () => query(null) };
  dependencies.revisionModel = { findOne: () => query(null) };
  const state = await resolveCurrentRecommendationState({
    userId: ids.user,
    profileId: ids.profile,
    profile,
    dependencies,
  });
  assert.equal(state.provenance.status, 'LEGACY_GENERATION_STATE');
  assert.equal(state.freshness.fresh, false);
  assert.ok(state.freshness.reasonCodes.includes('FINANCIAL_STATE_MISSING'));
});

test('explicit superseded recommendation cannot be used as current state', async () => {
  const { dependencies, recommendation } = fixture();
  const older = { ...recommendation, _id: '64b000000000000000000099' };
  dependencies.recommendationModel = { findOne: () => query(older) };
  await assert.rejects(
    resolveCurrentRecommendationState({
      userId: ids.user,
      profileId: ids.profile,
      recommendationId: older._id,
      profile,
      requireFresh: true,
      dependencies,
    }),
    error => error.code === 'RECOMMENDATION_SUPERSEDED',
  );
});

test('rebalance tokens are mandatory optimistic-concurrency inputs', () => {
  const result = recommendationWeightsSchema.validate({
    profileId: ids.profile,
    weights: { fd: 1 },
  });
  assert.ok(result.error);
  assert.match(result.error.message, /recommendationId|expectedAllocationRevision|expectedPortfolioFingerprint/);
});

test('allocation revision model exposes no query mutation path', () => {
  const source = readFileSync(resolve(process.cwd(), 'models/RecommendationAllocationRevision.js'), 'utf8');
  assert.match(source, /Allocation revisions are immutable/);
  assert.match(source, /Allocation revisions are append-only/);
  assert.doesNotMatch(readFileSync(resolve(process.cwd(), 'services/advisoryPersistence.js'), 'utf8'), /RecommendationAllocationRevision\.(create|updateOne|findOneAndUpdate|deleteMany)/);
});
