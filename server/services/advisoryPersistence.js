import mongoose from 'mongoose';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';
import AuditRecord from '../models/AuditRecord.js';
import IdempotencyKey from '../models/IdempotencyKey.js';
import AuditChainHead from '../models/AuditChainHead.js';
import RecommendationState from '../models/RecommendationState.js';
import RecommendationAllocationRevision from '../models/RecommendationAllocationRevision.js';
import { prepareAuditChainEntry, advanceAuditChainHead } from './auditChain.js';
import { omitUnsetOptionalUniqueFields, optionalUniqueIndex } from '../config/mongoCompatibility.js';
import { buildPortfolioFingerprint, buildRecommendationFingerprint } from './recommendationFingerprint.js';
import {
  PROJECTION_ASSUMPTION_POLICY_HASH,
  PROJECTION_ASSUMPTION_SOURCE,
  PROJECTION_ASSUMPTION_VERSION,
} from './instrumentConstants.js';
import { RECOMMENDATION_POLICY_VERSION } from './recommendationProfile.js';
import { createAllocationRevision } from './recommendationState.js';

let advisoryPersistenceReady = null;

function instrumentsAssumptionHash(instruments = []) {
  return instruments.find(item => item?.returnAssumptionHash)?.returnAssumptionHash || null;
}

async function ensureAdvisoryPersistenceReady() {
  if (!advisoryPersistenceReady) {
    advisoryPersistenceReady = (async () => {
      await Promise.all([
        FinancialProfile.init(),
        Recommendation.init(),
        AuditRecord.init(),
        AuditChainHead.init(),
        IdempotencyKey.init(),
        RecommendationState.init(),
        RecommendationAllocationRevision.init(),
      ]);
      // Production disables general auto-index creation. This one uniqueness
      // constraint is part of the advisory correctness boundary, not tuning.
      for (const [collection, index] of [
        [Recommendation.collection, optionalUniqueIndex('idempotencyOperationId', 'unique_advisory_idempotency_operation')],
        [Recommendation.collection, optionalUniqueIndex('profileCompletionCandidateId', 'unique_profile_completion_candidate')],
        [AuditRecord.collection, optionalUniqueIndex('chain_sequence', 'unique_user_audit_chain_sequence')],
      ]) {
        const key = collection === AuditRecord.collection
          ? { userId: 1, ...index.key }
          : index.key;
        await collection.createIndex(key, index.options);
      }
    })().catch(error => {
      advisoryPersistenceReady = null;
      throw error;
    });
  }
  return advisoryPersistenceReady;
}

// Called during application startup after MongoDB is connected so the first
// authoritative request does not pay schema/index initialization latency.
export async function warmAdvisoryPersistence() {
  await ensureAdvisoryPersistenceReady();
}

function transactionRequirementError(error) {
  const message = error?.message || '';
  if (/Transaction numbers are only allowed|replica set|does not support retryable writes/i.test(message)) {
    const wrapped = new Error(
      'Atomic advisory persistence requires a transaction-capable MongoDB replica set. No standalone fallback is permitted.',
      { cause: error },
    );
    wrapped.status = 503;
    wrapped.clientMessage = 'Advisory persistence is temporarily unavailable.';
    wrapped.code = 'ADVISORY_TRANSACTIONS_REQUIRED';
    return wrapped;
  }
  return error;
}

/**
 * Atomically persists the recommendation, its required audit record, and the
 * successful idempotency response. No compensation/fallback path is allowed.
 */
export async function persistAdvisoryAtomically({
  profile = null,
  recommendation,
  auditRecord,
  response,
  idempotencyClaim,
  testHooks = {},
}) {
  await ensureAdvisoryPersistenceReady();
  const session = await mongoose.startSession();
  let committedResponse = null;
  try {
    await session.withTransaction(async () => {
      const existingState = await RecommendationState.findOne({
        userId: recommendation.userId,
        profileId: recommendation.profileId,
      }).session(session).lean();
      const generationRevision = Number(existingState?.generationRevision || 0) + 1;
      const instruments = recommendation.instruments || [];
      const portfolioFingerprint = buildPortfolioFingerprint(instruments);
      const persistedRecommendation = {
        ...recommendation,
        recommendationGeneration: generationRevision,
        recommendationPolicyVersion: recommendation.recommendationPolicyVersion || RECOMMENDATION_POLICY_VERSION,
        returnAssumptionHash: recommendation.returnAssumptionHash
          || instrumentsAssumptionHash(recommendation.instruments || [])
          || PROJECTION_ASSUMPTION_POLICY_HASH,
      };
      const initialRevisionId = new mongoose.Types.ObjectId();
      const returnAssumptionHash = instrumentsAssumptionHash(instruments) || PROJECTION_ASSUMPTION_POLICY_HASH;
      persistedRecommendation.returnAssumptionHash = returnAssumptionHash;
      const recommendationFingerprint = buildRecommendationFingerprint({
        recommendationId: persistedRecommendation._id,
        profileInputHash: persistedRecommendation.profileInputHash,
        modelVersion: persistedRecommendation.modelVersion,
        recommendationPolicyVersion: persistedRecommendation.recommendationPolicyVersion,
        regulatoryRuleVersion: persistedRecommendation.regulatoryRuleVersion,
        returnAssumptionVersion: instruments.find(item => item.returnAssumptionVersion)?.returnAssumptionVersion || PROJECTION_ASSUMPTION_VERSION,
        returnAssumptionHash,
        allocationRevision: 1,
        instruments,
      });
      if (auditRecord.recommendations && typeof auditRecord.recommendations === 'object') {
        auditRecord.recommendations = {
          ...auditRecord.recommendations,
          recommendationGeneration: generationRevision,
          allocationRevision: 1,
          allocationSource: persistedRecommendation.currentAllocationSource || 'ORIGINAL_RECOMMENDATION',
          portfolioFingerprint,
        };
      }
      const chainEntry = await prepareAuditChainEntry(auditRecord, session);
      committedResponse = response?.recommendation
        ? {
          ...response,
          audit_hash: chainEntry.record.record_hash,
          recommendation: {
            ...response.recommendation,
            audit_hash: chainEntry.record.record_hash,
          },
        }
        : { ...response, audit_hash: chainEntry.record.record_hash };
      committedResponse = {
        ...committedResponse,
        generation_instruments: instruments,
        allocation_revision: 1,
        current_allocation_source: persistedRecommendation.currentAllocationSource || 'ORIGINAL_RECOMMENDATION',
        portfolio_fingerprint: portfolioFingerprint,
      };

      if (profile) {
        await FinancialProfile.create([profile], { session });
      }

      await Recommendation.create([omitUnsetOptionalUniqueFields({
        ...persistedRecommendation,
        idempotencyOperationId: idempotencyClaim.operationId,
        idempotencyRequestHash: idempotencyClaim.requestHash,
        responseSnapshot: committedResponse,
      })], { session });

      await createAllocationRevision({
        session,
        data: {
          _id: initialRevisionId,
          recommendationId: persistedRecommendation._id,
          profileId: persistedRecommendation.profileId,
          userId: persistedRecommendation.userId,
          revision: 1,
          previousRevision: null,
          source: persistedRecommendation.currentAllocationSource || 'ORIGINAL_RECOMMENDATION',
          instruments,
          profileInputHash: persistedRecommendation.profileInputHash,
          modelVersion: persistedRecommendation.modelVersion,
          recommendationPolicyVersion: persistedRecommendation.recommendationPolicyVersion,
          regulatoryRuleVersion: persistedRecommendation.regulatoryRuleVersion,
          returnAssumptionVersion: instruments.find(item => item.returnAssumptionVersion)?.returnAssumptionVersion || PROJECTION_ASSUMPTION_VERSION,
          returnAssumptionHash,
          returnAssumptionSource: instruments.find(item => item.returnSource)?.returnSource || PROJECTION_ASSUMPTION_SOURCE,
          portfolioFingerprint,
          recommendationFingerprint,
        },
      });
      await RecommendationState.findOneAndUpdate({
        userId: persistedRecommendation.userId,
        profileId: persistedRecommendation.profileId,
      }, {
        $set: {
          currentRecommendationId: persistedRecommendation._id,
          currentAllocationRevision: 1,
          currentAllocationRevisionId: initialRevisionId,
          generationRevision,
          profileInputHash: persistedRecommendation.profileInputHash,
          portfolioFingerprint,
          returnAssumptionVersion: instruments.find(item => item.returnAssumptionVersion)?.returnAssumptionVersion || PROJECTION_ASSUMPTION_VERSION,
          returnAssumptionHash,
          returnAssumptionSource: instruments.find(item => item.returnSource)?.returnSource || PROJECTION_ASSUMPTION_SOURCE,
        },
      }, { session, upsert: true, new: true, setDefaultsOnInsert: true });

      await testHooks.afterRecommendationCreate?.(session);

      try {
        await AuditRecord.create([chainEntry.record], { session });
      } catch (error) {
        if (error.hasErrorLabel?.('TransientTransactionError')) throw error;
        const auditError = new Error(`Required advisory audit write failed: ${error.message}`, { cause: error });
        auditError.status = 500;
        auditError.clientMessage = 'Failed to persist required advisory audit record. Transaction rolled back.';
        auditError.code = 'ADVISORY_AUDIT_WRITE_FAILED';
        throw auditError;
      }
      await testHooks.afterAuditCreate?.(session);
      await advanceAuditChainHead(chainEntry, session);

      const completion = await IdempotencyKey.updateOne({
        _id: idempotencyClaim.operationId,
        status: 'LOCK',
        requestHash: idempotencyClaim.requestHash,
      }, {
        $set: {
          status: 'DONE',
          response: {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' },
            body: committedResponse,
          },
        },
      }, { session });

      if (completion.matchedCount !== 1) {
        throw new Error('Advisory idempotency claim disappeared before transaction completion.');
      }
    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
    });

    return committedResponse;
  } catch (error) {
    throw transactionRequirementError(error);
  } finally {
    await session.endSession();
  }
}
