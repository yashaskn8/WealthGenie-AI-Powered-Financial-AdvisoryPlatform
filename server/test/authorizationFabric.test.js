import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APPROVE_RECOMPUTE,
  AUTHORIZATION_AUDIENCE,
  AUTHORIZATION_POLICY_VERSION,
  assertMandateTransition,
} from '../agents/authorization/authorizationConstants.js';
import {
  buildMandateDraft,
  buildSnapshotFingerprint,
  createMandateForPlanReview,
  assertVerifiableMandate,
  verifyMandateRecord,
} from '../agents/authorization/mandateService.js';
import { canonicalizeMandate, hashMandatePayload, verifyMandatePayloadHash } from '../agents/authorization/canonicalization.js';
import { DevelopmentApprovalProvider } from '../agents/authorization/approvalProviders.js';
import { DevelopmentEphemeralKeyProvider } from '../agents/authorization/keyProvider.js';
import { createSignedExecutionReceipt, verifyExecutionReceipt } from '../agents/authorization/executionReceipt.js';
import { evaluateAuthorizationPolicy } from '../agents/authorization/policyEngine.js';
import { getAgentCapabilityGrant, assertCapabilityGrant } from '../agents/authorization/capabilityGrants.js';
import { createDelegationContext, verifyDelegationContext } from '../agents/authorization/delegationContext.js';
import { assertScaffoldSpecSafe } from '../agents/evolution/scaffoldSpec.js';
import { hashPlanReviewSnapshot } from '../agents/planReview/planReviewRuntime.js';

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
const run = {
  runId: '4f4f4f4f-1111-4111-8111-111111111111',
  userId,
  profileId,
  recommendationId,
  planReviewSnapshotHash: 'c'.repeat(64),
  status: 'WAITING_FOR_APPROVAL',
  recommendedAction: 'RECOMPUTE_PLAN',
  agentVersion: 'plan-review-agent-2.0.0',
  correlationId: 'corr-1',
};

function draft() {
  return buildMandateDraft({
    run,
    profile,
    recommendation,
    approvalMethod: 'DEVELOPMENT',
    agentIdentity: { agentType: 'PLAN_REVIEW', provider: 'development', subject: 'plan-review:test', authenticated: true },
    now: new Date('2026-09-22T00:00:00.000Z'),
  });
}

test('mandates canonicalize deterministically and status changes do not alter intent hash', () => {
  const mandate = draft();
  const first = hashMandatePayload(mandate);
  const authorized = { ...mandate, status: 'AUTHORIZED' };
  assert.equal(hashMandatePayload(authorized), first);
  assert.equal(verifyMandatePayloadHash(authorized, first), true);
  assert.throws(() => hashMandatePayload({ ...authorized, action: 'EXECUTE_TRADE' }), /unsupported|allowlisted|action/i);
  assert.throws(() => canonicalizeMandate({ ...authorized, unexpected: true }), /unsupported/i);
});

test('policy engine denies agent execution and only permits a verified proposal after approval', () => {
  const grant = getAgentCapabilityGrant('PLAN_REVIEW');
  assert.doesNotThrow(() => assertCapabilityGrant(grant, 'propose:plan_recompute', { agentType: 'PLAN_REVIEW', delegationDepth: 0 }));
  assert.throws(() => assertCapabilityGrant(grant, 'execute:plan_recompute', { agentType: 'PLAN_REVIEW', delegationDepth: 0 }), /denied/i);
  const requiresApproval = evaluateAuthorizationPolicy({ authenticated: true, ownsResource: true, action: APPROVE_RECOMPUTE, audience: AUTHORIZATION_AUDIENCE, agentType: 'PLAN_REVIEW', agentIdentityAuthenticated: true, capabilityGrant: grant, approvalMethod: 'DEVELOPMENT', approvalVerified: false, policyVersion: AUTHORIZATION_POLICY_VERSION, production: false });
  assert.equal(requiresApproval.decision, 'REQUIRES_APPROVAL');
  const allowed = evaluateAuthorizationPolicy({ authenticated: true, ownsResource: true, action: APPROVE_RECOMPUTE, audience: AUTHORIZATION_AUDIENCE, agentType: 'PLAN_REVIEW', agentIdentityAuthenticated: true, capabilityGrant: grant, approvalMethod: 'WEBAUTHN', approvalVerified: true, policyVersion: AUTHORIZATION_POLICY_VERSION, production: false });
  assert.equal(allowed.decision, 'ALLOW');
  assert.equal(evaluateAuthorizationPolicy({ action: 'EXECUTE_TRADE', audience: AUTHORIZATION_AUDIENCE, agentType: 'PLAN_REVIEW', agentIdentityAuthenticated: true, capabilityGrant: grant, approvalVerified: true, policyVersion: AUTHORIZATION_POLICY_VERSION }).decision, 'DENY');
});

test('development approval is explicitly non-production and bound to one mandate hash', async () => {
  const mandate = draft();
  const provider = new DevelopmentApprovalProvider({ env: { NODE_ENV: 'test' } });
  const options = await provider.createOptions({ mandate });
  assert.equal(options.mandateId, mandate.mandateId);
  await assert.rejects(() => provider.verify({ mandate, assertion: { method: 'DEVELOPMENT', mandateId: mandate.mandateId, mandateHash: '0'.repeat(64) } }), error => error.code === 'TRUSTED_APPROVAL_INVALID');
  const approval = await provider.verify({ mandate, assertion: options });
  assert.equal(approval.verified, true);
  assert.throws(() => new DevelopmentApprovalProvider({ env: { NODE_ENV: 'production' } }), /production/i);
});

test('mandate verification detects payload, signature, expiry, and replay changes', () => {
  const mandate = { ...draft(), status: 'AUTHORIZED' };
  const keys = new DevelopmentEphemeralKeyProvider({ env: { NODE_ENV: 'test' } });
  const signed = { ...mandate, signatureMetadata: { ...keys.metadata(), signature: keys.sign(canonicalizeMandate(mandate)) } };
  assert.doesNotThrow(() => verifyMandateRecord(signed, keys));
  assert.doesNotThrow(() => assertVerifiableMandate(signed, { keyProvider: keys, now: new Date('2026-09-22T00:01:00.000Z') }));
  assert.throws(() => assertVerifiableMandate({ ...signed, action: 'EXECUTE_TRADE' }, { keyProvider: keys }), /allowlisted|integrity|signature/i);
  assert.throws(() => assertVerifiableMandate({ ...signed, status: 'EXECUTED' }, { keyProvider: keys, now: new Date('2026-09-22T00:01:00.000Z') }), /consumed/i);
  assert.throws(() => assertVerifiableMandate({ ...signed, expiresAt: '2026-09-22T00:00:01.000Z' }, { keyProvider: keys, now: new Date('2026-09-22T00:01:00.000Z') }), /expired/i);
});

test('snapshot binding changes when profile or recommendation version changes', () => {
  const first = buildSnapshotFingerprint({ profile, recommendation });
  assert.notEqual(first.financialSnapshotHash, buildSnapshotFingerprint({ profile: { ...profile, version: 15 }, recommendation }).financialSnapshotHash);
  assert.notEqual(first.financialSnapshotHash, buildSnapshotFingerprint({ profile, recommendation: { ...recommendation, _id: '64b000000000000000000003' } }).financialSnapshotHash);
});

test('PlanReview approval is minted only for the exact current snapshot and reviewed recommendation', async () => {
  const sourceBinding = {
    schemaVersion: 'plan-review-source-binding-1.0.0',
    userId,
    profileId,
    profileVersion: profile.version,
    recommendationId,
  };
  const sourceHash = hashPlanReviewSnapshot(sourceBinding);
  const boundRun = { ...run, planReviewSnapshotHash: sourceHash, sourceBinding };
  const calls = [];
  const saved = [];
  const result = await createMandateForPlanReview({
    runId: boundRun.runId,
    userId,
    dependencies: {
      agentIdentity: { agentType: 'PLAN_REVIEW', provider: 'development', subject: 'plan-review:test', authenticated: true },
      approvalProvider: { name: 'DEVELOPMENT' },
      planReviewSnapshotResolver: async () => ({ planReviewSnapshotHash: sourceHash }),
      agentRunModel: { findOne: filter => ({ lean: async () => (calls.push(['run', filter]), boundRun) }) },
      profileModel: { findOne: filter => ({ lean: async () => (calls.push(['profile', filter]), profile) }) },
      recommendationModel: { findOne: filter => ({ lean: async () => (calls.push(['recommendation', filter]), recommendation) }) },
      mandateModel: { create: async value => (saved.push(value), value) },
    },
    runtimeConfig: { env: { NODE_ENV: 'test' } },
  });

  assert.equal(result.recommendationId, recommendationId);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].planReviewSnapshotHash, sourceHash);
  assert.deepEqual(calls.find(([name]) => name === 'recommendation')[1], { _id: recommendationId, profileId, userId });
});

test('PlanReview approval fails stale and never substitutes a newer timestamp-selected recommendation', async () => {
  const sourceBinding = { schemaVersion: 'plan-review-source-binding-1.0.0', userId, profileId, profileVersion: profile.version, recommendationId };
  const sourceHash = hashPlanReviewSnapshot(sourceBinding);
  const boundRun = { ...run, planReviewSnapshotHash: sourceHash, sourceBinding };
  let recommendationLookupCount = 0;
  let mandateCreateCount = 0;
  await assert.rejects(() => createMandateForPlanReview({
    runId: boundRun.runId,
    userId,
    dependencies: {
      agentIdentity: { agentType: 'PLAN_REVIEW', provider: 'development', subject: 'plan-review:test', authenticated: true },
      approvalProvider: { name: 'DEVELOPMENT' },
      planReviewSnapshotResolver: async () => ({ planReviewSnapshotHash: 'd'.repeat(64) }),
      agentRunModel: { findOne: () => ({ lean: async () => boundRun }) },
      profileModel: { findOne: () => ({ lean: async () => profile }) },
      recommendationModel: { findOne: () => { recommendationLookupCount += 1; return { lean: async () => recommendation }; } },
      mandateModel: { create: async value => { mandateCreateCount += 1; return value; } },
    },
    runtimeConfig: { env: { NODE_ENV: 'test' } },
  }), error => error.code === 'PLAN_REVIEW_SOURCE_SUPERSEDED' && error.status === 409);
  assert.equal(recommendationLookupCount, 0);
  assert.equal(mandateCreateCount, 0);
});

test('execution receipts are tamper-evident and delegation cannot expand privileges', () => {
  const mandate = { ...draft(), status: 'AUTHORIZED' };
  const keys = new DevelopmentEphemeralKeyProvider({ env: { NODE_ENV: 'test' } });
  const receipt = createSignedExecutionReceipt({ mandate, beforeSnapshotHash: mandate.financialSnapshotHash, policyDecisionId: 'policy:1', keyProvider: keys, resultMetadata: { recommendationId, auditHash: null, recommendationProfileHash: mandate.recommendationFingerprint, status: 'COMMITTED' } });
  assert.equal(verifyExecutionReceipt(receipt, keys), true);
  assert.equal(verifyExecutionReceipt({ ...receipt, mandateId: 'tampered' }, keys), false);
  const context = createDelegationContext({ originalUser: userId, actingAgent: 'PLAN_REVIEW', purpose: 'propose recompute', action: APPROVE_RECOMPUTE, runId: run.runId, mandateId: mandate.mandateId, audience: AUTHORIZATION_AUDIENCE, issuedAt: '2026-09-22T00:00:00.000Z', expiresAt: '2026-09-22T00:05:00.000Z' });
  assert.equal(verifyDelegationContext(context, { audience: AUTHORIZATION_AUDIENCE, mandateId: mandate.mandateId, now: new Date('2026-09-22T00:01:00.000Z') }), true);
  assert.throws(() => verifyDelegationContext({ ...context, delegationDepth: 1 }, { audience: AUTHORIZATION_AUDIENCE, mandateId: mandate.mandateId, now: new Date('2026-09-22T00:01:00.000Z') }), /integrity|depth/i);
  assert.throws(() => assertMandateTransition('AUTHORIZED', 'EXECUTED'), /Invalid mandate/);
});

test('evolution firewall protects authorization surfaces and scaffold cannot claim execution', () => {
  assert.throws(() => assertScaffoldSpecSafe({ agentType: 'PLAN_REVIEW', authorizedActionExecutor: true }), /not allowed/i);
  assert.throws(() => assertScaffoldSpecSafe({ agentType: 'PLAN_REVIEW', mandateTtlMaximum: 999999 }), /not allowed/i);
});
