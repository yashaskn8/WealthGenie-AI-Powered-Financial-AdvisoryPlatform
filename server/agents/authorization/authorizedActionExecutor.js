import crypto from 'node:crypto';
import UserIntentMandate from '../../models/UserIntentMandate.js';
import ExecutionReceipt from '../../models/ExecutionReceipt.js';
import AuthorizedExecutionAttempt from '../../models/AuthorizedExecutionAttempt.js';
import FinancialProfile from '../../models/FinancialProfile.js';
import Recommendation from '../../models/Recommendation.js';
import { buildRecommendationProfile } from '../../services/recommendationProfile.js';
import { computeCoreRecommendation, assertCoreResultFinalSafety } from '../../services/coreRecommendation.js';
import { persistAdvisoryAtomically } from '../../services/advisoryPersistence.js';
import { buildCanonicalAdvisoryResponse } from '../../services/advisoryResponse.js';
import { claimAdvisoryIdempotency, releaseAdvisoryIdempotency } from '../../middleware/idempotency.js';
import { createAuthorizationKeyProvider } from './keyProvider.js';
import { assertVerifiableMandate, buildSnapshotFingerprint } from './mandateService.js';
import { createSignedExecutionReceipt, verifyExecutionReceipt } from './executionReceipt.js';
import { evaluateAuthorizationPolicy } from './policyEngine.js';
import { getAgentCapabilityGrant } from './capabilityGrants.js';
import { APPROVE_RECOMPUTE, AUTHORIZATION_AUDIENCE, mandateError } from './authorizationConstants.js';
import { appendAuthorizationEvent } from './authorizationEvents.js';
import { PrometheusMetrics } from '../../services/metricsCollector.js';
import { canonicalSha256 } from '../../utils/canonicalJson.js';
import { newExecutionClaim, reconcileAuthorizedExecution } from './executionRecovery.js';

async function resolve(value) { return typeof value?.lean === 'function' ? value.lean() : value; }

function advisoryOperationId(userId, mandateId) {
  return `advisory:${canonicalSha256({ operation: 'recommendation.create', userId: String(userId), key: `mandate:${mandateId}` })}`;
}

async function committedAdvisory(models, userId, mandateId, responseBuilder = buildCanonicalAdvisoryResponse) {
  const recommendation = await resolve(models.recommendationModel.findOne({ idempotencyOperationId: advisoryOperationId(userId, mandateId) }));
  if (!recommendation?.responseSnapshot) return null;
  const response = await responseBuilder({
    userId,
    profileId: recommendation.profileId,
    responseTemplate: recommendation.responseSnapshot,
    replayed: true,
  });
  return { recommendation, response };
}

async function reconcileCommittedExecution({ models, stored, attempt, committed, keyProvider, userId }) {
  const resultReference = attempt?.resultReference || {};
  const recommendation = committed?.recommendation;
  const recommendationId = String(resultReference.recommendationId || recommendation?._id || '');
  const afterSnapshotHash = resultReference.afterSnapshotHash;
  if (!recommendationId || !afterSnapshotHash) {
    throw mandateError('AUTHORIZED_EXECUTION_RECONCILIATION_REQUIRED', 'The committed result is missing its immutable receipt binding.');
  }
  const completedAt = new Date();
  const receipt = createSignedExecutionReceipt({
    mandate: stored,
    beforeSnapshotHash: stored.financialSnapshotHash,
    afterSnapshotHash,
    policyDecisionId: resultReference.policyDecisionId || `recovery:${stored.mandateId}`,
    keyProvider,
    startedAt: attempt.startedAt || completedAt,
    completedAt,
    resultMetadata: {
      recommendationId,
      auditHash: resultReference.auditHash || committed.response?.audit_hash || committed.response?.recommendation?.audit_hash || null,
      recommendationProfileHash: recommendation?.profileInputHash || null,
      status: 'COMMITTED',
    },
  });
  let savedReceipt;
  try {
    savedReceipt = await models.receiptModel.create(receipt);
  } catch (error) {
    if (error?.code !== 11000) throw error;
    savedReceipt = await resolve(models.receiptModel.findOne({ mandateId: stored.mandateId, userId }));
  }
  const normalizedReceipt = savedReceipt?.toObject ? savedReceipt.toObject() : savedReceipt;
  if (!normalizedReceipt || !verifyExecutionReceipt(normalizedReceipt, keyProvider)) {
    throw mandateError('AUTHORIZED_EXECUTION_RECONCILIATION_REQUIRED', 'The recovered execution receipt could not be verified.');
  }
  await models.attemptModel.updateOne(
    { mandateId: stored.mandateId, userId, executionGeneration: attempt.executionGeneration, status: { $in: ['COMMITTED', 'RECEIPT_PENDING', 'REQUIRES_RECONCILIATION'] } },
    { $set: { status: 'COMPLETED', receiptId: normalizedReceipt.receiptId, completedAt, heartbeatAt: completedAt, leaseUntil: null, failureCode: null } },
  );
  await models.mandateModel.updateOne(
    { mandateId: stored.mandateId, userId, status: { $in: ['AUTHORIZED', 'EXECUTING'] } },
    { $set: { status: 'EXECUTED', executedAt: completedAt, receiptId: normalizedReceipt.receiptId } },
  );
  await appendAuthorizationEvent({
    runId: stored.runId,
    userId,
    eventType: 'ACTION_EXECUTION_COMPLETED',
    data: { mandateId: stored.mandateId, action: stored.action, receiptId: normalizedReceipt.receiptId, recovered: true },
    dependencies: models,
  });
  return { receipt: normalizedReceipt, response: committed.response };
}

async function claimExecutionAttempt(models, mandate, userId, { recovery = false, now = new Date() } = {}) {
  const existing = await resolve(models.attemptModel.findOne({ mandateId: mandate.mandateId, userId }));
  if (existing?.status === 'COMPLETED' && existing.receiptId) return { attempt: existing, replay: true };
  const activeStatuses = new Set(['CLAIMED', 'EXECUTING', 'COMMITTED', 'RECEIPT_PENDING']);
  if (existing && activeStatuses.has(existing.status)
      && (!recovery || new Date(existing.leaseUntil).getTime() > now.getTime())) {
    const error = mandateError('AUTHORIZED_EXECUTION_IN_PROGRESS', 'This authorized action is already executing.');
    error.status = 409;
    throw error;
  }
  if (existing) {
    const claim = await resolve(models.attemptModel.findOneAndUpdate(
      {
        mandateId: mandate.mandateId,
        userId,
        status: existing.status,
        $or: [{ status: 'FAILED_RETRYABLE' }, { status: 'REQUIRES_RECONCILIATION' }, { leaseUntil: { $lte: now } }],
      },
      {
        $set: {
          status: 'CLAIMED',
          workerId: `executor:${crypto.randomUUID()}`,
          leaseUntil: new Date(now.getTime() + 60000),
          heartbeatAt: now,
          startedAt: now,
          failureCode: null,
          completedAt: null,
        },
        $inc: { executionGeneration: 1, retryCount: 1 },
      },
      { new: true },
    ));
    if (!claim) throw mandateError('AUTHORIZED_EXECUTION_IN_PROGRESS', 'This authorized action is already executing.');
    return { attempt: claim, replay: false };
  }
  const claim = newExecutionClaim({ mandate, userId, now });
  try {
    return { attempt: await resolve(models.attemptModel.create(claim)), replay: false };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const raced = await resolve(models.attemptModel.findOne({ mandateId: mandate.mandateId, userId }));
    if (raced?.status === 'COMPLETED' && raced.receiptId) return { attempt: raced, replay: true };
    throw mandateError('AUTHORIZED_EXECUTION_IN_PROGRESS', 'This authorized action is already executing.');
  }
}

async function loadReceipt(models, receiptId, mandateId, userId) {
  if (!receiptId) return null;
  return resolve(models.receiptModel.findOne({ receiptId, mandateId, userId }));
}

export function createAuthorizedActionExecutor({ dependencies = {}, runtimeConfig = {} } = {}) {
  const models = { mandateModel: UserIntentMandate, receiptModel: ExecutionReceipt, attemptModel: AuthorizedExecutionAttempt, profileModel: FinancialProfile, recommendationModel: Recommendation, ...dependencies };
  const env = runtimeConfig.env || process.env;
  const keyProvider = dependencies.keyProvider || createAuthorizationKeyProvider({ env, required: env.NODE_ENV === 'production' });
  const responseBuilder = dependencies.buildCanonicalAdvisoryResponse || buildCanonicalAdvisoryResponse;

  return {
    async execute({ mandateId, userId, correlationId = null, recovery = false }) {
      const stored = await resolve(models.mandateModel.findOne({ mandateId, userId }));
      if (!stored) throw mandateError('MANDATE_NOT_FOUND', 'Mandate not found or access denied.', 404);
      if (!recovery) {
        assertVerifiableMandate(stored, { keyProvider });
      } else if (!['AUTHORIZED', 'EXECUTING'].includes(stored.status)) {
        if (stored.status === 'EXECUTED' && stored.receiptId) {
          const receipt = await loadReceipt(models, stored.receiptId, stored.mandateId, userId);
          if (receipt && verifyExecutionReceipt(receipt, keyProvider)) return { receipt, response: null };
        }
        throw mandateError('AUTHORIZED_EXECUTION_NOT_RECOVERABLE', 'This authorized action is not recoverable.');
      } else {
        // Recovery still verifies the immutable mandate and signature. It only
        // relaxes the one-time state check so a leased execution can resume.
        const { verifyMandateRecord } = await import('./mandateService.js');
        verifyMandateRecord(stored, keyProvider);
      }
      const existingAttempt = await resolve(models.attemptModel.findOne({ mandateId, userId }));
      if (existingAttempt?.receiptId) {
        const existingReceipt = await loadReceipt(models, existingAttempt.receiptId, mandateId, userId);
        if (existingReceipt && verifyExecutionReceipt(existingReceipt, keyProvider)) return { receipt: existingReceipt, response: null };
      }
      if (recovery && ['COMMITTED', 'RECEIPT_PENDING', 'REQUIRES_RECONCILIATION'].includes(existingAttempt?.status)) {
        const reconciled = await reconcileAuthorizedExecution({ mandateId, userId, dependencies: models });
        if (reconciled.status === 'COMPLETED' && reconciled.receiptId) {
          const receipt = await loadReceipt(models, reconciled.receiptId, mandateId, userId);
          if (receipt && verifyExecutionReceipt(receipt, keyProvider)) return { receipt, response: null };
        }
        const committed = await committedAdvisory(models, userId, mandateId, responseBuilder);
        if (committed) return reconcileCommittedExecution({ models, stored, attempt: existingAttempt, committed, keyProvider, userId });
        throw mandateError('AUTHORIZED_EXECUTION_RECONCILIATION_REQUIRED', 'The execution committed without a recoverable result reference.');
      }
      const profile = await resolve(models.profileModel.findOne({ _id: stored.profileId, userId }));
      const recommendation = stored.recommendationId
        ? await resolve(models.recommendationModel.findOne({ _id: stored.recommendationId, profileId: stored.profileId, userId }))
        : await resolve(models.recommendationModel.findOne({ profileId: stored.profileId, userId }).sort({ generatedAt: -1 }));
      if (!profile) throw mandateError('MANDATE_STALE', 'The financial profile required by this authorization is no longer available.');
      const currentSnapshot = buildSnapshotFingerprint({ profile, recommendation });
      if (currentSnapshot.financialSnapshotHash !== stored.financialSnapshotHash
          || currentSnapshot.recommendationFingerprint !== stored.recommendationFingerprint
          || currentSnapshot.profileVersion !== Number(stored.constraints?.resourceVersion)) {
        PrometheusMetrics.inc('snapshot_mismatch_rejections_total');
        await models.mandateModel.updateOne({ mandateId, userId, status: 'AUTHORIZED' }, { $set: { status: 'FAILED', failureCode: 'MANDATE_STALE' } });
        throw mandateError('MANDATE_STALE', 'The approved financial snapshot has changed. Fresh approval is required.');
      }
      const decision = evaluateAuthorizationPolicy({
        authenticated: true,
        ownsResource: true,
        action: stored.action,
        audience: stored.audience,
        agentType: stored.agentType,
        agentIdentityAuthenticated: stored.agentIdentity?.authenticated === true,
        capabilityGrant: getAgentCapabilityGrant(stored.agentType),
        delegationDepth: stored.delegationDepth,
        approvalMethod: stored.approvalMethod,
        approvalVerified: true,
        production: env.NODE_ENV === 'production',
        policyVersion: stored.policyVersion,
        mandateId,
      });
      if (decision.decision !== 'ALLOW' || stored.action !== APPROVE_RECOMPUTE || stored.audience !== AUTHORIZATION_AUDIENCE) {
        PrometheusMetrics.inc('mandates_rejected_total');
        if (decision.reasonCodes.includes('AGENT_CAPABILITY_DENIED')) PrometheusMetrics.inc('capability_denials_total');
        throw mandateError(decision.reasonCodes[0] || 'AUTHORIZATION_DENIED', 'Authorization policy denied execution.');
      }
      const startedAt = new Date();
      const claim = await claimExecutionAttempt(models, stored, userId, { recovery, now: startedAt });
      if (claim.replay) {
        const replayReceipt = await loadReceipt(models, claim.attempt.receiptId, mandateId, userId);
        if (replayReceipt && verifyExecutionReceipt(replayReceipt, keyProvider)) return { receipt: replayReceipt, response: null };
        throw mandateError('AUTHORIZED_EXECUTION_RECONCILIATION_REQUIRED', 'Execution completed but its receipt requires reconciliation.');
      }
      const claimed = recovery && stored.status === 'EXECUTING'
        ? stored
        : await resolve(models.mandateModel.findOneAndUpdate(
          { mandateId, userId, status: 'AUTHORIZED', expiresAt: { $gt: startedAt } },
          { $set: { status: 'EXECUTING', executionStartedAt: startedAt } },
          { new: true },
        ));
      if (!claimed) {
        await models.attemptModel.updateOne({ executionId: claim.attempt.executionId, executionGeneration: claim.attempt.executionGeneration }, { $set: { status: 'FAILED_RETRYABLE', failureCode: 'MANDATE_ALREADY_CONSUMED', leaseUntil: null } }).catch(() => {});
        PrometheusMetrics.inc('replay_rejections_total');
        throw mandateError('MANDATE_ALREADY_CONSUMED', 'This mandate has already been consumed.');
      }
      const runningAttempt = await resolve(models.attemptModel.findOneAndUpdate(
        { executionId: claim.attempt.executionId, executionGeneration: claim.attempt.executionGeneration, status: 'CLAIMED' },
        { $set: { status: 'EXECUTING', heartbeatAt: startedAt, leaseUntil: new Date(startedAt.getTime() + 60000) } },
        { new: true },
      ));
      if (!runningAttempt) throw mandateError('AUTHORIZED_EXECUTION_FENCED', 'The authorized execution worker lease is no longer valid.');
      await appendAuthorizationEvent({
        runId: stored.runId,
        userId,
        eventType: 'ACTION_EXECUTION_STARTED',
        data: { mandateId, action: stored.action },
        dependencies,
      });
      try {
        const canonicalProfile = buildRecommendationProfile(profile);
        const alreadyCommitted = await committedAdvisory(models, userId, mandateId, responseBuilder);
        let core = null;
        let persisted;
        if (alreadyCommitted) {
          persisted = alreadyCommitted.response;
          core = { recommendationData: alreadyCommitted.recommendation };
        } else {
          core = await computeCoreRecommendation({
            canonicalProfile,
            profileVersion: profile.version ?? 1,
            userId,
            profileId: stored.profileId,
            correlationId: correlationId || stored.correlationId,
            traceId: correlationId || stored.correlationId,
          });
          assertCoreResultFinalSafety(canonicalProfile, core);
          const idempotencyClaim = await claimAdvisoryIdempotency({
            key: `mandate:${mandateId}`,
            userId,
            profileId: stored.profileId,
            payload: { mandateId, action: stored.action, snapshotHash: stored.financialSnapshotHash },
          });
          try {
            persisted = idempotencyClaim.state === 'REPLAY'
              ? idempotencyClaim.response
              : await persistAdvisoryAtomically({ recommendation: core.recommendationData, auditRecord: core.auditRecordData, response: core.response, idempotencyClaim });
          } catch (error) {
            await releaseAdvisoryIdempotency(idempotencyClaim).catch(() => {});
            throw error;
          }
        }
        const completedAt = new Date();
        const afterSnapshot = buildSnapshotFingerprint({ profile, recommendation: core.recommendationData });
        const recommendationId = String(core.recommendationData?._id || persisted?.recommendation?._id || '');
        if (!recommendationId) throw mandateError('AUTHORIZED_EXECUTION_RECONCILIATION_REQUIRED', 'The committed recommendation reference is unavailable.');
        const resultReference = {
          recommendationId,
          auditHash: persisted.audit_hash || persisted.recommendation?.audit_hash || null,
          afterSnapshotHash: afterSnapshot.financialSnapshotHash,
          responseHash: canonicalSha256(persisted),
          policyDecisionId: decision.decisionId,
        };
        await models.attemptModel.updateOne(
          { executionId: runningAttempt.executionId, executionGeneration: runningAttempt.executionGeneration, status: 'EXECUTING' },
          { $set: { status: 'RECEIPT_PENDING', resultReference, heartbeatAt: completedAt, leaseUntil: new Date(completedAt.getTime() + 60000) } },
        );
        const receipt = createSignedExecutionReceipt({
          mandate: stored,
          beforeSnapshotHash: stored.financialSnapshotHash,
          afterSnapshotHash: afterSnapshot.financialSnapshotHash,
          policyDecisionId: decision.decisionId,
          keyProvider,
          startedAt,
          completedAt,
          resultMetadata: {
            recommendationId,
            auditHash: persisted.audit_hash || persisted.recommendation?.audit_hash || null,
            recommendationProfileHash: core.profileInputHash,
            status: 'COMMITTED',
          },
        });
        let savedReceipt;
        try {
          savedReceipt = await models.receiptModel.create(receipt);
        } catch (error) {
          if (error?.code !== 11000) throw error;
          savedReceipt = await resolve(models.receiptModel.findOne({ mandateId, userId }));
        }
        if (!savedReceipt || !verifyExecutionReceipt(savedReceipt.toObject ? savedReceipt.toObject() : savedReceipt, keyProvider)) {
          throw mandateError('AUTHORIZED_EXECUTION_RECONCILIATION_REQUIRED', 'Execution receipt could not be verified after persistence.');
        }
        await models.attemptModel.updateOne(
          { executionId: runningAttempt.executionId, executionGeneration: runningAttempt.executionGeneration, status: 'RECEIPT_PENDING' },
          { $set: { status: 'COMPLETED', receiptId: savedReceipt.receiptId, completedAt, heartbeatAt: completedAt, leaseUntil: null } },
        );
        await models.mandateModel.updateOne({ mandateId, userId, status: 'EXECUTING' }, { $set: { status: 'EXECUTED', executedAt: completedAt, receiptId: savedReceipt.receiptId } });
        await appendAuthorizationEvent({
          runId: stored.runId,
          userId,
          eventType: 'ACTION_EXECUTION_COMPLETED',
          data: { mandateId, action: stored.action, receiptId: savedReceipt.receiptId },
          dependencies,
        });
        return { receipt: savedReceipt.toObject ? savedReceipt.toObject() : savedReceipt, response: persisted };
      } catch (error) {
        const failureCode = String(error.code || 'AUTHORIZED_ACTION_FAILED').slice(0, 120);
        await models.attemptModel.updateOne(
          { executionId: runningAttempt.executionId, executionGeneration: runningAttempt.executionGeneration, status: { $in: ['CLAIMED', 'EXECUTING'] } },
          { $set: { status: error.code === 'AUTHORIZED_EXECUTION_RECONCILIATION_REQUIRED' ? 'REQUIRES_RECONCILIATION' : 'FAILED_RETRYABLE', failureCode, leaseUntil: null, heartbeatAt: new Date() }, $inc: { retryCount: 1 } },
        ).catch(() => {});
        await appendAuthorizationEvent({
          runId: stored.runId,
          userId,
          eventType: 'ACTION_EXECUTION_FAILED',
          data: { mandateId, action: stored.action, code: String(error.code || 'AUTHORIZED_ACTION_FAILED').slice(0, 120) },
          dependencies,
        });
        throw error;
      }
    },
  };
}
