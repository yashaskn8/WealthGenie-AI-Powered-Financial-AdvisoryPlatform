import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Recommendation from '../models/Recommendation.js';
import AuditRecord from '../models/AuditRecord.js';
import IdempotencyKey from '../models/IdempotencyKey.js';
import {
  claimAdvisoryIdempotency,
  releaseAdvisoryIdempotency,
} from '../middleware/idempotency.js';
import { persistAdvisoryAtomically } from '../services/advisoryPersistence.js';
import { REGULATORY_RULE_VERSION } from '../services/taxEngine.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mongoTestHelper.js';

const userId = new mongoose.Types.ObjectId();
const profileId = new mongoose.Types.ObjectId();

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
      profileInputHash: 'a'.repeat(64),
    },
    auditRecord: {
      _id: auditId,
      userId,
      profileId,
      recommendationId,
      correlationId: `atomic-test-${suffix}`,
      traceId: '',
      version_id: 'rule_fallback',
      regulatory_rule_version: REGULATORY_RULE_VERSION,
      input_hash: `input-hash-${suffix}`,
      inputs: {
        financial_profile_schema_version: 'financial-profile-1.0.0',
        recommendation_policy_version: 'suitability-freeze-1.0.0',
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

test.before(async () => {
  await setupTestDatabase({ requireReplicaSet: true });
  await Promise.all([Recommendation.init(), AuditRecord.init(), IdempotencyKey.init()]);
});

test.beforeEach(async () => {
  await Promise.all([
    Recommendation.deleteMany({ userId }),
    AuditRecord.deleteMany({ userId }),
    IdempotencyKey.deleteMany({ userId }),
  ]);
});

test.after(async () => {
  await Promise.all([
    Recommendation.deleteMany({ userId }),
    AuditRecord.deleteMany({ userId }),
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
