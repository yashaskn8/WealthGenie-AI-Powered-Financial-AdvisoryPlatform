import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Recommendation from '../models/Recommendation.js';
import AuditRecord from '../models/AuditRecord.js';
import AuditChainHead from '../models/AuditChainHead.js';
import IdempotencyKey from '../models/IdempotencyKey.js';
import { claimAdvisoryIdempotency } from '../middleware/idempotency.js';
import { persistAdvisoryAtomically } from '../services/advisoryPersistence.js';
import { verifyAuditChain } from '../services/auditChain.js';
import { getCurrentRegulatoryRuleVersion } from '../services/taxEngine.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mongoTestHelper.js';

const userId = new mongoose.Types.ObjectId();
const profileId = new mongoose.Types.ObjectId();

async function createAdvisory(index) {
  const claim = await claimAdvisoryIdempotency({
    key: `audit-chain-${String(index).padStart(3, '0')}`,
    userId,
    profileId,
    payload: { profileId: String(profileId), request: index },
    waitMs: 10000,
  });
  const recommendationId = new mongoose.Types.ObjectId();
  const auditId = new mongoose.Types.ObjectId();
  return persistAdvisoryAtomically({
    recommendation: {
      _id: recommendationId,
      userId,
      profileId,
      instruments: [{
        id: `fund-${index}`, name: `Fund ${index}`, type: 'Equity_MF', assetClass: 'Equity',
        nominalReturn: 12, effectiveYield: 12, postTaxReturn: null,
        returnBasis: 'PRE_TAX_NOMINAL', expenseRatio: 0.005,
        riskLevel: 'Medium', riskScore: 3, lockIn: 0, tags: ['Wealth Growth'],
        score: 80, scoreFactors: {
          expectedReturn: 60, riskFit: 100, liquidity: 80, goalFit: 100,
          horizonFit: 100, cost: 90, mlConfidence: 80,
        },
        allocation_pct: 100, allocationWeight: 1,
      }],
      advisoryText: `Advisory ${index}`,
      confidenceScores: { Equity_MF: 0.8 },
      mlFallback: false,
      modelVersion: `model-${index}`,
      regulatoryRuleVersion: getCurrentRegulatoryRuleVersion(),
      profileInputHash: 'b'.repeat(64),
    },
    auditRecord: {
      _id: auditId,
      userId,
      profileId,
      recommendationId,
      correlationId: `audit-chain-correlation-${index}`,
      traceId: `trace-${index}`,
      version_id: `model-${index}`,
      regulatory_rule_version: getCurrentRegulatoryRuleVersion(),
      input_hash: `legacy-input-hash-${index}`,
      inputs: {
        financial_profile_schema_version: 'financial-profile-1.0.0',
        recommendation_policy_version: 'suitability-freeze-1.0.0',
        model_version: `model-${index}`,
        age: 30 + index,
        monthly_take_home: 100000,
        monthly_savings: 25000,
      },
      recommendations: {
        instruments: [{ name: `Fund ${index}`, allocationWeight: 1 }],
        confidenceScores: { Equity_MF: 0.8 },
      },
      cited_rag_chunk_ids: [`trusted-chunk-${index}`],
      engine: 'ml_service',
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
    },
    response: { recommendationId, audit_id: auditId, audit_hash: 'pending' },
    idempotencyClaim: claim,
  });
}

async function clearAuditState() {
  await Promise.all([
    Recommendation.deleteMany({ userId }),
    AuditRecord.deleteMany({ userId }),
    AuditChainHead.deleteMany({ _id: userId }),
    IdempotencyKey.deleteMany({ userId }),
  ]);
}

test.before(async () => {
  await setupTestDatabase({ requireReplicaSet: true });
});

test.beforeEach(clearAuditState);

test.after(async () => {
  await clearAuditState().catch(() => {});
  await teardownTestDatabase();
});

test('valid multi-record tamper-evident audit chain verifies', async () => {
  await createAdvisory(1);
  await createAdvisory(2);
  await createAdvisory(3);

  const verification = await verifyAuditChain(userId);
  assert.equal(verification.valid, true, JSON.stringify(verification.errors));
  assert.equal(verification.checkedRecords, 3);
  assert.equal(verification.headSequence, 3);
});

test('concurrent advisories retain a single ordered audit chain', async () => {
  await Promise.all([1, 2, 3, 4, 5].map(createAdvisory));
  const verification = await verifyAuditChain(userId);
  assert.equal(verification.valid, true, JSON.stringify(verification.errors));
  assert.equal(verification.checkedRecords, 5);
  assert.deepEqual(
    (await AuditRecord.find({ userId }).sort({ chain_sequence: 1 }).lean()).map(record => record.chain_sequence),
    [1, 2, 3, 4, 5],
  );
});

test('mutating any protected advisory field breaks chain verification', async () => {
  await createAdvisory(1);
  await createAdvisory(2);
  await createAdvisory(3);
  const target = await AuditRecord.findOne({ userId, chain_sequence: 2 }).lean();

  const mutations = [
    ['input', { $set: { 'inputs.age': 99 } }],
    ['output', { $set: { 'recommendations.instruments.0.allocationWeight': 0.25 } }],
    ['model version', { $set: { version_id: 'tampered-model' } }],
    ['rule version', { $set: { regulatory_rule_version: 'tampered-rule' } }],
    ['RAG provenance', { $set: { cited_rag_chunk_ids: ['untrusted-chunk'] } }],
    ['previous hash', { $set: { previous_hash: 'tampered-previous-hash' } }],
  ];

  for (const [field, update] of mutations) {
    const mutationResult = await AuditRecord.updateOne({ _id: target._id }, update);
    assert.equal(mutationResult.matchedCount, 1, `${field} mutation must match its audit record`);
    assert.equal(mutationResult.modifiedCount, 1, `${field} mutation must modify its audit record`);
    const verification = await verifyAuditChain(userId);
    assert.equal(verification.valid, false, `${field} mutation must invalidate the chain`);
    assert.ok(
      verification.errors.some(error => error.auditRecordId === String(target._id)),
      `${field} mutation must identify the changed record`,
    );

    await AuditRecord.replaceOne({ _id: target._id }, target, { timestamps: false });
    const restored = await verifyAuditChain(userId);
    assert.equal(restored.valid, true, `${field} restoration failed: ${JSON.stringify(restored.errors)}`);
  }
});
