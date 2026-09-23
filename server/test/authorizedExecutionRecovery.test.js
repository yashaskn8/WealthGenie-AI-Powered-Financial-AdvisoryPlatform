import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMandateDraft, buildSnapshotFingerprint } from '../agents/authorization/mandateService.js';
import { canonicalizeMandate } from '../agents/authorization/canonicalization.js';
import { DevelopmentEphemeralKeyProvider } from '../agents/authorization/keyProvider.js';
import { createAuthorizedActionExecutor } from '../agents/authorization/authorizedActionExecutor.js';

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

test('authorized execution recovery reconstructs a missing receipt without repeating the committed effect', async () => {
  const keys = new DevelopmentEphemeralKeyProvider({ env: { NODE_ENV: 'test' } });
  const mandate = signedExecutingMandate(keys);
  const afterSnapshotHash = buildSnapshotFingerprint({ profile, recommendation }).financialSnapshotHash;
  const attempt = {
    mandateId: mandate.mandateId,
    userId,
    status: 'RECEIPT_PENDING',
    executionGeneration: 1,
    startedAt: new Date('2026-09-22T00:01:00.000Z'),
    resultReference: { recommendationId, afterSnapshotHash, auditHash: null, policyDecisionId: 'policy:original' },
  };
  const committedRecommendation = {
    ...recommendation,
    responseSnapshot: { recommendation: { _id: recommendationId }, audit_hash: null },
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
