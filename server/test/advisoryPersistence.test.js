import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Recommendation from '../models/Recommendation.js';
import FinancialProfile from '../models/FinancialProfile.js';
import AuditRecord from '../models/AuditRecord.js';
import AuditChainHead from '../models/AuditChainHead.js';
import IdempotencyKey from '../models/IdempotencyKey.js';
import RecommendationAllocationRevision from '../models/RecommendationAllocationRevision.js';
import RecommendationState from '../models/RecommendationState.js';
import {
  claimAdvisoryIdempotency,
  releaseAdvisoryIdempotency,
} from '../middleware/idempotency.js';
import { persistAdvisoryAtomically } from '../services/advisoryPersistence.js';
import { createManualAllocationRevision } from '../services/recommendationState.js';
import { getCurrentRegulatoryRuleVersion } from '../services/taxEngine.js';
import { buildRecommendationProfileHash, RECOMMENDATION_POLICY_VERSION } from '../services/recommendationProfile.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mongoTestHelper.js';
import { canonicalProfile } from './helpers/canonicalProfile.js';
import {
  PROJECTION_ASSUMPTION_POLICY_HASH,
  PROJECTION_ASSUMPTION_SOURCE,
  PROJECTION_ASSUMPTION_VERSION,
} from '../services/instrumentConstants.js';

const userId = new mongoose.Types.ObjectId();
const profileId = new mongoose.Types.ObjectId();
const testProfile = canonicalProfile({ monthlyTakeHome: 100000, monthlySavings: 25000, age: 30 });
const profileInputHash = buildRecommendationProfileHash(testProfile, { modelVersion: 'rule_fallback' });

function makeOperation(claim, suffix = '') {
  const recommendationId = new mongoose.Types.ObjectId();
  const auditId = new mongoose.Types.ObjectId();
  const response = {
    recommendationId,
    audit_id: auditId,
    advisory_text: `Atomic advisory ${suffix}`,
    model_version: 'rule_fallback',
  };
  return {
    recommendation: {
      _id: recommendationId,
      userId,
      profileId,
      instruments: [{
        id: `fixture-${suffix}`, name: 'Fixture Fund', type: 'Equity_MF', assetClass: 'Equity',
        nominalReturn: 12, effectiveYield: 12, postTaxReturn: null,
        returnBasis: 'PRE_TAX_NOMINAL', expenseRatio: 0.005,
        returnAssumptionVersion: PROJECTION_ASSUMPTION_VERSION,
        returnAssumptionHash: PROJECTION_ASSUMPTION_POLICY_HASH,
        returnSource: PROJECTION_ASSUMPTION_SOURCE,
        riskLevel: 'Medium', riskScore: 3, lockIn: 0, tags: ['Wealth Growth'],
        score: 80, scoreFactors: {
          expectedReturn: 60, riskFit: 100, liquidity: 80, goalFit: 100,
          horizonFit: 100, cost: 90, mlConfidence: 0,
        },
        allocation_pct: 100, allocationWeight: 1,
      }],
      advisoryText: response.advisory_text,
      confidenceScores: {},
      mlFallback: true,
      modelVersion: 'rule_fallback',
      regulatoryRuleVersion: getCurrentRegulatoryRuleVersion(),
      profileVersion: 1,
      recommendationPolicyVersion: RECOMMENDATION_POLICY_VERSION,
      profileInputHash,
    },
    auditRecord: {
      _id: auditId,
      userId,
      profileId,
      recommendationId,
      correlationId: `atomic-test-${suffix}`,
      traceId: '',
      version_id: 'rule_fallback',
      regulatory_rule_version: getCurrentRegulatoryRuleVersion(),
      input_hash: `input-hash-${suffix}`,
      inputs: {
        financial_profile_schema_version: 'financial-profile-1.0.0',
        recommendation_policy_version: RECOMMENDATION_POLICY_VERSION,
        age: 30, monthly_take_home: 100000, monthly_savings: 25000,
      },
      recommendations: { instruments: [{ id: `fixture-${suffix}`, allocationWeight: 1 }] },
      cited_rag_chunk_ids: [],
      engine: 'rule_fallback',
      timestamp: new Date(),
    },
    response,
    idempotencyClaim: claim,
  };
}

async function claim(key, payload = { profileId: profileId.toString() }) {
  return claimAdvisoryIdempotency({ key, userId, profileId, payload, waitMs: 10000 });
}

function createBarrier() {
  let markEntered;
  let open;
  const entered = new Promise(resolve => { markEntered = resolve; });
  const released = new Promise(resolve => { open = resolve; });
  return { entered, async pause() { markEntered(); await released; }, release() { open(); } };
}

test.before(async () => {
  await setupTestDatabase({ requireReplicaSet: true });
  await Promise.all([Recommendation.init(), AuditRecord.init(), IdempotencyKey.init()]);
});

test.beforeEach(async () => {
  await Promise.all([
    FinancialProfile.deleteMany({ userId }),
    Recommendation.deleteMany({ userId }),
    // Production blocks deletion to preserve append-only history. The test
    // harness clears its fixture rows through the raw collection instead.
    RecommendationAllocationRevision.collection.deleteMany({ userId }),
    RecommendationState.deleteMany({ userId }),
    AuditRecord.deleteMany({ userId }),
    AuditChainHead.deleteMany({ userId }),
    IdempotencyKey.deleteMany({ userId }),
  ]);
  await FinancialProfile.create({
    _id: profileId,
    userId,
    ...testProfile,
    recommendationProfileVersion: 'financial-profile-1.1.0',
  });
});

test.after(async () => {
  await Promise.all([
    FinancialProfile.deleteMany({ userId }),
    Recommendation.deleteMany({ userId }),
    RecommendationAllocationRevision.collection.deleteMany({ userId }),
    RecommendationState.deleteMany({ userId }),
    AuditRecord.deleteMany({ userId }),
    AuditChainHead.deleteMany({ userId }),
    IdempotencyKey.deleteMany({ userId }),
  ]).catch(() => {});
  await teardownTestDatabase();
});

test('failure after recommendation creation rolls back recommendation and audit', async () => {
  const operationClaim = await claim('atomic-after-rec-001');
  await assert.rejects(
    persistAdvisoryAtomically({
      ...makeOperation(operationClaim, 'after-rec'),
      testHooks: { afterRecommendationCreate: () => { throw new Error('injected after recommendation'); } },
    }),
    /injected after recommendation/,
  );
  await releaseAdvisoryIdempotency(operationClaim);

  assert.equal(await Recommendation.countDocuments({ userId }), 0);
  assert.equal(await AuditRecord.countDocuments({ userId }), 0);
});

test('barrier-controlled recommendation generation loses to a concurrently committed profile edit', async () => {
  const operationClaim = await claim('atomic-profile-race-001');
  const barrier = createBarrier();
  let paused = false;
  const pending = persistAdvisoryAtomically({
    ...makeOperation(operationClaim, 'profile-race'),
    testHooks: {
      afterSourceProfileRead: async () => {
        if (paused) return;
        paused = true;
        await barrier.pause();
      },
    },
  });
  await barrier.entered;
  await FinancialProfile.updateOne({ _id: profileId, userId }, {
    $set: { monthlySavings: 30000 },
    $inc: { version: 1, financialStateFence: 1 },
  });
  barrier.release();
  await assert.rejects(pending, error => error.code === 'PROFILE_STATE_CHANGED' || /write conflict/i.test(error.message));
  await releaseAdvisoryIdempotency(operationClaim);
  const changedProfile = await FinancialProfile.findOne({ _id: profileId, userId }).lean();
  assert.equal(changedProfile.version, 2);
  assert.equal(changedProfile.financialStateFence, 1);
  assert.equal(await Recommendation.countDocuments({ userId }), 0);
  assert.equal(await RecommendationAllocationRevision.countDocuments({ userId }), 0);
  assert.equal(await RecommendationState.countDocuments({ userId }), 0);
  assert.equal(await AuditRecord.countDocuments({ userId }), 0);
  assert.equal(await AuditChainHead.countDocuments({ _id: userId }), 0);
});

test('audit write validation failure rolls back recommendation and audit', async () => {
  const operationClaim = await claim('atomic-audit-fail-001');
  const operation = makeOperation(operationClaim, 'audit-fail');
  delete operation.auditRecord.recommendations;

  await assert.rejects(persistAdvisoryAtomically(operation), /recommendations.*required/i);
  await releaseAdvisoryIdempotency(operationClaim);

  assert.equal(await Recommendation.countDocuments({ userId }), 0);
  assert.equal(await AuditRecord.countDocuments({ userId }), 0);
});

test('successful advisory transaction persists exactly one recommendation and audit', async () => {
  const operationClaim = await claim('atomic-success-001');
  const operation = makeOperation(operationClaim, 'success');
  const result = await persistAdvisoryAtomically(operation);

  assert.equal(await Recommendation.countDocuments({ userId }), 1);
  assert.equal(await AuditRecord.countDocuments({ userId }), 1);
  assert.equal(String(result.recommendationId), String(operation.recommendation._id));
  assert.equal(String(result.audit_id), String(operation.auditRecord._id));
  assert.equal(result.response_state, 'CURRENT');
  assert.equal(result.allocation_revision, 1);
  assert.match(String(result.allocation_revision_id), /^[a-f\d]{24}$/i);
  assert.match(result.portfolio_fingerprint, /^[a-f\d]{64}$/i);
  assert.equal(result.calculation_freshness.fresh, true);
  assert.deepEqual(result.calculation_freshness.reasonCodes, []);
  assert.equal(result.state_provenance.status, 'PERSISTED_REVISION');
  const persistedRevision = await RecommendationAllocationRevision.findById(result.allocation_revision_id).lean();
  assert.equal(String(persistedRevision.recommendationId), String(operation.recommendation._id));
  assert.equal(persistedRevision.revision, result.allocation_revision);
  assert.equal(persistedRevision.portfolioFingerprint, result.portfolio_fingerprint);
});

test('idempotency replay reconstructs the canonical allocation after rebalance and newer generation', async () => {
  const key = 'atomic-current-replay-001';
  const payload = { profileId: profileId.toString(), mode: 'replay-current' };
  const originalClaim = await claim(key, payload);
  const original = await persistAdvisoryAtomically(makeOperation(originalClaim, 'replay-original'));
  const originalId = String(original.recommendationId);
  const initialRevision = await RecommendationAllocationRevision.findById(original.allocation_revision_id).lean();

  await createManualAllocationRevision({
    userId,
    profileId,
    recommendationId: originalId,
    expectedRevision: 1,
    expectedRecommendationId: originalId,
    expectedPortfolioFingerprint: initialRevision.portfolioFingerprint,
    instruments: initialRevision.instruments,
    correlationId: 'idempotency-replay-rebalance',
  });

  const afterRebalance = await claim(key, payload);
  assert.equal(afterRebalance.state, 'REPLAY');
  assert.equal(afterRebalance.response.body.response_state, 'CURRENT');
  assert.equal(String(afterRebalance.response.body.recommendationId), originalId);
  assert.equal(afterRebalance.response.body.allocation_revision, 2);
  assert.notEqual(afterRebalance.response.body.allocation_revision_id, original.allocation_revision_id);

  const newerClaim = await claim('atomic-current-replay-newer-001', { profileId: profileId.toString(), mode: 'new-generation' });
  const newer = await persistAdvisoryAtomically(makeOperation(newerClaim, 'replay-newer'));
  assert.notEqual(String(newer.recommendationId), originalId);

  const afterRefresh = await claim(key, payload);
  assert.equal(afterRefresh.state, 'REPLAY');
  assert.equal(String(afterRefresh.response.body.recommendationId), String(newer.recommendationId));
  assert.equal(afterRefresh.response.body.allocation_revision, 1);
  assert.equal(afterRefresh.response.body.portfolio_fingerprint, newer.portfolio_fingerprint);
  assert.equal(await Recommendation.countDocuments({ userId }), 2);

  await FinancialProfile.updateOne({ _id: profileId, userId }, { $inc: { version: 1, financialStateFence: 1 } });
  await assert.rejects(claim(key, payload), error => error.status === 409 || error.status === 503);
  assert.equal(await Recommendation.countDocuments({ userId }), 2);
});

test('concurrent duplicate advisory requests execute once and replay identical IDs', async () => {
  const key = 'atomic-concurrent-001';
  const payload = { profileId: profileId.toString() };

  async function execute() {
    const operationClaim = await claim(key, payload);
    if (operationClaim.state === 'REPLAY') return operationClaim.response.body;

    const operation = makeOperation(operationClaim, 'concurrent');
    await new Promise(resolve => setTimeout(resolve, 100));
    return persistAdvisoryAtomically(operation);
  }

  const results = await Promise.all(Array.from({ length: 20 }, execute));
  const recommendationIds = new Set(results.map(result => String(result.recommendationId)));
  const auditIds = new Set(results.map(result => String(result.audit_id)));

  assert.equal(recommendationIds.size, 1);
  assert.equal(auditIds.size, 1);
  assert.equal(await Recommendation.countDocuments({ userId }), 1);
  assert.equal(await AuditRecord.countDocuments({ userId }), 1);
});

test('same user and key with a different payload is rejected', async () => {
  const key = 'atomic-conflict-001';
  const firstClaim = await claim(key, { profileId: profileId.toString(), mode: 'one' });
  await persistAdvisoryAtomically(makeOperation(firstClaim, 'conflict'));

  await assert.rejects(
    claim(key, { profileId: profileId.toString(), mode: 'two' }),
    error => error.status === 409 && error.code === 'IDEMPOTENCY_PAYLOAD_CONFLICT',
  );
  assert.equal(await Recommendation.countDocuments({ userId }), 1);
  assert.equal(await AuditRecord.countDocuments({ userId }), 1);
});
