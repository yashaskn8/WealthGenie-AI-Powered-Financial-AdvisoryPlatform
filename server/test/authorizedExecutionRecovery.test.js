import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMandateDraft, buildSnapshotFingerprint } from '../agents/authorization/mandateService.js';
import { canonicalizeMandate } from '../agents/authorization/canonicalization.js';
import { DevelopmentEphemeralKeyProvider } from '../agents/authorization/keyProvider.js';
import { claimExecutionAttempt, createAuthorizedActionExecutor } from '../agents/authorization/authorizedActionExecutor.js';
import { createSignedExecutionReceipt, verifyExecutionReceipt } from '../agents/authorization/executionReceipt.js';
import { reconcileAuthorizedExecution, reconcileAuthorizedExecutions } from '../agents/authorization/executionRecovery.js';
import { canonicalSha256 } from '../utils/canonicalJson.js';

const userId = '64b000000000000000000010';
const profileId = '64b000000000000000000001';
const recommendationId = '64b000000000000000000002';
const profile = {
  _id: profileId,
  version: 14,
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
const recommendation = {
  _id: recommendationId,
  profileInputHash: '1111111111111111111111111111111111111111111111111111111111111111',
  modelVersion: 'model-1.0.0',
};

function signedExecutingMandate(keys) {
  const draft = buildMandateDraft({
    run: {
      runId: '4f4f4f4f-1111-4111-8111-111111111111',
      userId,
      profileId,
      recommendationId,
      planReviewSnapshotHash: 'c'.repeat(64),
      status: 'WAITING_FOR_APPROVAL',
      recommendedAction: 'RECOMPUTE_PLAN',
      agentVersion: 'plan-review-agent-2.0.0',
      correlationId: 'corr-1',
    },
    profile,
    recommendation,
    approvalMethod: 'DEVELOPMENT',
    agentIdentity: { agentType: 'PLAN_REVIEW', provider: 'development', subject: 'plan-review:test', authenticated: true },
    now: new Date('2026-09-22T00:00:00.000Z'),
  });
  const mandate = { ...draft, status: 'EXECUTING' };
  return { ...mandate, signatureMetadata: { ...keys.metadata(), signature: keys.sign(canonicalizeMandate(mandate)) } };
}

test('transactionally committed authorized execution recovers its receipt before checking newer profile state', async () => {
  const keys = new DevelopmentEphemeralKeyProvider({ env: { NODE_ENV: 'test' } });
  const mandate = signedExecutingMandate(keys);
  const afterSnapshotHash = buildSnapshotFingerprint({ profile, recommendation }).financialSnapshotHash;
  const historicalResponseSnapshot = {
    recommendation: {
      recommendationId,
      response_state: 'HISTORICAL_GENERATION',
      calculation_freshness: { fresh: false, reasonCodes: ['HISTORICAL_GENERATION'] },
      state_provenance: { status: 'HISTORICAL_GENERATION' },
    },
    audit_hash: null,
  };
  const attempt = {
    mandateId: mandate.mandateId,
    userId,
    status: 'COMMITTED',
    executionGeneration: 1,
    startedAt: new Date('2026-09-22T00:01:00.000Z'),
    resultReference: {
      recommendationId,
      afterSnapshotHash,
      auditHash: null,
      responseHash: canonicalSha256(historicalResponseSnapshot),
      policyDecisionId: 'policy:original',
    },
  };
  const committedRecommendation = {
    ...recommendation,
    responseSnapshot: historicalResponseSnapshot,
  };
  const canonicalCurrentResponse = {
    response_state: 'CURRENT',
    recommendationId,
    profileId,
    profile_version: profile.version,
    allocation_revision: 1,
    allocation_revision_id: '64b000000000000000000020',
    portfolio_fingerprint: 'a'.repeat(64),
    calculation_freshness: { fresh: true, reasonCodes: [] },
    state_provenance: { status: 'PERSISTED_REVISION' },
  };
  let createdReceipt = null;
  const models = {
    mandateModel: {
      findOne: async () => mandate,
      updateOne: async (_filter, update) => { Object.assign(mandate, update.$set); },
    },
    attemptModel: {
      findOne: async () => attempt,
      updateOne: async (_filter, update) => { Object.assign(attempt, update.$set); },
    },
    receiptModel: {
      findOne: async () => null,
      create: async receipt => { createdReceipt = receipt; return receipt; },
    },
    recommendationModel: { findOne: async () => committedRecommendation },
    profileModel: { findOne: async () => { throw new Error('committed receipt recovery must not require current profile state'); } },
    runModel: { findOne: async () => null },
    eventModel: { create: async event => event },
    keyProvider: keys,
    buildCanonicalAdvisoryResponse: async () => canonicalCurrentResponse,
  };

  const result = await createAuthorizedActionExecutor({ dependencies: models, runtimeConfig: { env: { NODE_ENV: 'test' } } }).execute({
    mandateId: mandate.mandateId,
    userId,
    recovery: true,
  });

  assert.ok(createdReceipt);
  assert.equal(result.response, canonicalCurrentResponse);
  assert.notEqual(result.response, committedRecommendation.responseSnapshot);
  assert.equal(result.receipt.receiptId, createdReceipt.receiptId);
  assert.equal(attempt.status, 'COMPLETED');
  assert.equal(mandate.status, 'EXECUTED');
  assert.equal(mandate.receiptId, createdReceipt.receiptId);
});

test('ordinary retry replays a completed signed receipt and finalizes an interrupted mandate update', async () => {
  const keys = new DevelopmentEphemeralKeyProvider({ env: { NODE_ENV: 'test' } });
  const mandate = signedExecutingMandate(keys);
  const completedAt = new Date('2026-09-23T12:00:00.000Z');
  const receipt = createSignedExecutionReceipt({
    mandate,
    resultMetadata: { recommendationId, auditHash: null, recommendationProfileHash: recommendation.profileInputHash, status: 'COMMITTED' },
    beforeSnapshotHash: mandate.financialSnapshotHash,
    afterSnapshotHash: 'd'.repeat(64),
    policyDecisionId: 'policy:completed',
    keyProvider: keys,
    startedAt: completedAt,
    completedAt,
  });
  const attempt = {
    mandateId: mandate.mandateId,
    userId,
    status: 'COMPLETED',
    executionGeneration: 1,
    receiptId: receipt.receiptId,
    leaseUntil: null,
    mandateFinalizedAt: null,
  };
  let profileLookups = 0;
  const models = {
    mandateModel: {
      findOne: async () => mandate,
      updateOne: async (_filter, update) => { Object.assign(mandate, update.$set); },
    },
    attemptModel: {
      findOne: async () => attempt,
      updateOne: async (_filter, update) => { Object.assign(attempt, update.$set); },
    },
    receiptModel: { findOne: async () => receipt },
    profileModel: { findOne: async () => { profileLookups += 1; throw new Error('a committed retry must not recompute'); } },
    recommendationModel: { findOne: async () => { throw new Error('a committed retry must not query a new recommendation'); } },
    keyProvider: keys,
  };

  const result = await createAuthorizedActionExecutor({ dependencies: models, runtimeConfig: { env: { NODE_ENV: 'test' } } }).execute({
    mandateId: mandate.mandateId,
    userId,
  });

  assert.equal(result.response, null);
  assert.equal(result.receipt.receiptId, receipt.receiptId);
  assert.equal(profileLookups, 0);
  assert.equal(mandate.status, 'EXECUTED');
  assert.equal(mandate.receiptId, receipt.receiptId);
  assert.ok(attempt.mandateFinalizedAt instanceof Date);
});

test('recovery sweep selects COMPLETED attempts lacking the durable mandate-finalized marker', async () => {
  const keys = new DevelopmentEphemeralKeyProvider({ env: { NODE_ENV: 'test' } });
  const mandate = signedExecutingMandate(keys);
  const completedAt = new Date('2026-09-23T12:00:00.000Z');
  const receipt = createSignedExecutionReceipt({
    mandate,
    resultMetadata: { recommendationId, auditHash: null, recommendationProfileHash: recommendation.profileInputHash, status: 'COMMITTED' },
    beforeSnapshotHash: mandate.financialSnapshotHash,
    afterSnapshotHash: 'e'.repeat(64),
    policyDecisionId: 'policy:sweep',
    keyProvider: keys,
    startedAt: completedAt,
    completedAt,
  });
  const attempt = {
    mandateId: mandate.mandateId,
    userId,
    status: 'COMPLETED',
    executionGeneration: 1,
    receiptId: receipt.receiptId,
    leaseUntil: null,
    mandateFinalizedAt: null,
    retryCount: 0,
  };
  let selectedFilter;
  const models = {
    attemptModel: {
      find: filter => {
        selectedFilter = filter;
        return { limit: () => ({ lean: async () => [attempt] }) };
      },
      findOne: async () => attempt,
      updateOne: async (_filter, update) => { Object.assign(attempt, update.$set); },
    },
    mandateModel: {
      findOne: async () => mandate,
      updateOne: async (_filter, update) => { Object.assign(mandate, update.$set); },
    },
    receiptModel: { findOne: async () => receipt },
    keyProvider: keys,
  };

  const results = await reconcileAuthorizedExecutions({
    dependencies: models,
    runtimeConfig: { env: { NODE_ENV: 'test' } },
    now: new Date('2026-09-23T12:01:00.000Z'),
  });

  assert.ok(selectedFilter.status.$in.includes('COMPLETED'));
  assert.ok(selectedFilter.$or.some(condition => condition.status === 'COMPLETED' && condition.mandateFinalizedAt === null));
  assert.equal(results[0].status, 'COMPLETED');
  assert.equal(mandate.status, 'EXECUTED');
  assert.ok(attempt.mandateFinalizedAt instanceof Date);
});

test('recovery sweep selects an expired CLAIMED attempt left before the execution transition', async () => {
  const keys = new DevelopmentEphemeralKeyProvider({ env: { NODE_ENV: 'test' } });
  const mandate = signedExecutingMandate(keys);
  const now = new Date('2026-09-23T12:01:00.000Z');
  const attempt = {
    mandateId: mandate.mandateId,
    userId,
    status: 'CLAIMED',
    executionGeneration: 1,
    leaseUntil: new Date(now.getTime() - 1),
    retryCount: 0,
  };
  let selectedFilter;
  const recovered = [];
  const models = {
    attemptModel: {
      find: filter => {
        selectedFilter = filter;
        return { limit: () => ({ lean: async () => [attempt] }) };
      },
      findOne: async () => attempt,
    },
    mandateModel: { findOne: async () => mandate },
    receiptModel: { findOne: async () => null },
    keyProvider: keys,
  };

  const results = await reconcileAuthorizedExecutions({
    dependencies: models,
    runtimeConfig: { env: { NODE_ENV: 'test' } },
    now,
    recoverExecution: async args => {
      recovered.push(args);
      return { status: 'RECLAIMED', executionGeneration: 2 };
    },
  });

  assert.ok(selectedFilter.status.$in.includes('CLAIMED'));
  assert.ok(selectedFilter.$or.some(condition => condition.leaseUntil?.$lt?.getTime() === now.getTime()));
  assert.deepEqual(recovered, [{ mandateId: mandate.mandateId, userId, dependencies: models, runtimeConfig: { env: { NODE_ENV: 'test' } } }]);
  assert.deepEqual(results, [{ status: 'RECLAIMED', executionGeneration: 2, recovery: true }]);
});

test('concurrent reclaimers of an expired CLAIMED attempt have one CAS winner', async () => {
  const now = new Date('2026-09-23T12:01:00.000Z');
  const mandate = { mandateId: 'mandate-stale-claim', action: 'RECOMPUTE_PLAN', financialSnapshotHash: 'a'.repeat(64) };
  const attempt = {
    mandateId: mandate.mandateId,
    userId,
    status: 'CLAIMED',
    executionGeneration: 1,
    retryCount: 0,
    leaseUntil: new Date(now.getTime() - 1),
  };
  let readers = 0;
  let releaseReaders;
  const bothRead = new Promise(resolve => { releaseReaders = resolve; });
  const attemptModel = {
    findOne: async () => {
      const snapshot = { ...attempt };
      readers += 1;
      if (readers === 2) releaseReaders();
      await bothRead;
      return snapshot;
    },
    findOneAndUpdate: async (filter, update) => {
      if (filter.mandateId !== attempt.mandateId
          || filter.userId !== attempt.userId
          || filter.status !== attempt.status
          || !filter.$or.some(condition => condition.leaseUntil?.$lte?.getTime() === now.getTime())) return null;
      if (attempt.leaseUntil > now) return null;
      Object.assign(attempt, update.$set);
      for (const [key, amount] of Object.entries(update.$inc || {})) attempt[key] = (attempt[key] || 0) + amount;
      return { ...attempt };
    },
  };

  const results = await Promise.allSettled([
    claimExecutionAttempt({ attemptModel }, mandate, userId, { recovery: true, now }),
    claimExecutionAttempt({ attemptModel }, mandate, userId, { recovery: true, now }),
  ]);

  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'AUTHORIZED_EXECUTION_IN_PROGRESS');
  assert.equal(attempt.status, 'CLAIMED');
  assert.equal(attempt.executionGeneration, 2);
  assert.equal(attempt.retryCount, 1);
  assert.ok(attempt.leaseUntil > now);
  assert.match(attempt.workerId, /^executor:/);
});

test('recovery does not finalize a mandate from a correctly signed receipt bound to a different mandate hash', async () => {
  const keys = new DevelopmentEphemeralKeyProvider({ env: { NODE_ENV: 'test' } });
  const mandate = signedExecutingMandate(keys);
  const receipt = createSignedExecutionReceipt({
    mandate: { ...mandate, mandateHash: 'f'.repeat(64) },
    resultMetadata: { recommendationId, status: 'COMMITTED' },
    beforeSnapshotHash: mandate.financialSnapshotHash,
    afterSnapshotHash: 'e'.repeat(64),
    policyDecisionId: 'policy:mismatched-mandate',
    keyProvider: keys,
    startedAt: new Date('2026-09-23T12:00:00.000Z'),
    completedAt: new Date('2026-09-23T12:01:00.000Z'),
  });
  assert.equal(verifyExecutionReceipt(receipt, keys), true, 'receipt signature/hash are valid independently');
  const attempt = {
    mandateId: mandate.mandateId,
    userId,
    status: 'COMMITTED',
    executionGeneration: 1,
    leaseUntil: new Date('2026-09-23T11:00:00.000Z'),
  };
  const models = {
    mandateModel: { findOne: async () => mandate, updateOne: async () => { throw new Error('mismatched receipt must not finalize mandate'); } },
    attemptModel: { findOne: async () => attempt, updateOne: async (_filter, update) => { Object.assign(attempt, update.$set); } },
    receiptModel: { findOne: async () => receipt },
    keyProvider: keys,
  };

  const result = await reconcileAuthorizedExecution({
    mandateId: mandate.mandateId,
    userId,
    dependencies: models,
    runtimeConfig: { env: { NODE_ENV: 'test' } },
    now: new Date('2026-09-23T12:02:00.000Z'),
  });

  assert.equal(result.status, 'REQUIRES_RECONCILIATION');
  assert.equal(attempt.status, 'REQUIRES_RECONCILIATION');
  assert.equal(mandate.status, 'EXECUTING');
});
