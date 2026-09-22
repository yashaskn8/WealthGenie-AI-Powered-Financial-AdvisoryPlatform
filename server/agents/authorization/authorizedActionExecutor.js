import UserIntentMandate from '../../models/UserIntentMandate.js';
import ExecutionReceipt from '../../models/ExecutionReceipt.js';
import FinancialProfile from '../../models/FinancialProfile.js';
import Recommendation from '../../models/Recommendation.js';
import { buildRecommendationProfile } from '../../services/recommendationProfile.js';
import { computeCoreRecommendation, assertCoreResultFinalSafety } from '../../services/coreRecommendation.js';
import { persistAdvisoryAtomically } from '../../services/advisoryPersistence.js';
import { claimAdvisoryIdempotency, releaseAdvisoryIdempotency } from '../../middleware/idempotency.js';
import { createAuthorizationKeyProvider } from './keyProvider.js';
import { assertVerifiableMandate, buildSnapshotFingerprint } from './mandateService.js';
import { createSignedExecutionReceipt } from './executionReceipt.js';
import { evaluateAuthorizationPolicy } from './policyEngine.js';
import { getAgentCapabilityGrant } from './capabilityGrants.js';
import { APPROVE_RECOMPUTE, AUTHORIZATION_AUDIENCE, mandateError } from './authorizationConstants.js';
import { appendAuthorizationEvent } from './authorizationEvents.js';
import { PrometheusMetrics } from '../../services/metricsCollector.js';

async function resolve(value) { return typeof value?.lean === 'function' ? value.lean() : value; }

export function createAuthorizedActionExecutor({ dependencies = {}, runtimeConfig = {} } = {}) {
  const models = { mandateModel: UserIntentMandate, receiptModel: ExecutionReceipt, profileModel: FinancialProfile, recommendationModel: Recommendation, ...dependencies };
  const env = runtimeConfig.env || process.env;
  const keyProvider = dependencies.keyProvider || createAuthorizationKeyProvider({ env, required: env.NODE_ENV === 'production' });

  return {
    async execute({ mandateId, userId, correlationId = null }) {
      const stored = await resolve(models.mandateModel.findOne({ mandateId, userId }));
      if (!stored) throw mandateError('MANDATE_NOT_FOUND', 'Mandate not found or access denied.', 404);
      assertVerifiableMandate(stored, { keyProvider });
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
      const claimed = await resolve(models.mandateModel.findOneAndUpdate(
        { mandateId, userId, status: 'AUTHORIZED', expiresAt: { $gt: startedAt } },
        { $set: { status: 'EXECUTING', executionStartedAt: startedAt } },
        { new: true },
      ));
      if (!claimed) {
        PrometheusMetrics.inc('replay_rejections_total');
        throw mandateError('MANDATE_ALREADY_CONSUMED', 'This mandate has already been consumed.');
      }
      await appendAuthorizationEvent({
        runId: stored.runId,
        userId,
        eventType: 'ACTION_EXECUTION_STARTED',
        data: { mandateId, action: stored.action },
        dependencies,
      });
      try {
        const canonicalProfile = buildRecommendationProfile(profile);
        const core = await computeCoreRecommendation({
          canonicalProfile,
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
        let persisted;
        try {
          persisted = idempotencyClaim.state === 'REPLAY'
            ? idempotencyClaim.response
            : await persistAdvisoryAtomically({ recommendation: core.recommendationData, auditRecord: core.auditRecordData, response: core.response, idempotencyClaim });
        } catch (error) {
          await releaseAdvisoryIdempotency(idempotencyClaim).catch(() => {});
          throw error;
        }
        const completedAt = new Date();
        const afterSnapshot = buildSnapshotFingerprint({ profile, recommendation: core.recommendationData });
        const receipt = createSignedExecutionReceipt({
          mandate: stored,
          beforeSnapshotHash: stored.financialSnapshotHash,
          afterSnapshotHash: afterSnapshot.financialSnapshotHash,
          policyDecisionId: decision.decisionId,
          keyProvider,
          startedAt,
          completedAt,
          resultMetadata: {
            recommendationId: String(core.recommendationData._id),
            auditHash: persisted.audit_hash || persisted.recommendation?.audit_hash || null,
            recommendationProfileHash: core.profileInputHash,
            status: 'COMMITTED',
          },
        });
        const savedReceipt = await models.receiptModel.create(receipt);
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
        await models.mandateModel.updateOne({ mandateId, userId, status: 'EXECUTING' }, { $set: { status: 'FAILED', failureCode: String(error.code || 'AUTHORIZED_ACTION_FAILED').slice(0, 120) } }).catch(() => {});
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
