import mongoose from 'mongoose';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';
import AuditRecord from '../models/AuditRecord.js';
import IdempotencyKey from '../models/IdempotencyKey.js';
import AuditChainHead from '../models/AuditChainHead.js';
import { prepareAuditChainEntry, advanceAuditChainHead } from './auditChain.js';
import { omitUnsetOptionalUniqueFields, optionalUniqueIndex } from '../config/mongoCompatibility.js';

let advisoryPersistenceReady = null;

async function ensureAdvisoryPersistenceReady() {
  if (!advisoryPersistenceReady) {
    advisoryPersistenceReady = (async () => {
      await Promise.all([
        FinancialProfile.init(),
        Recommendation.init(),
        AuditRecord.init(),
        AuditChainHead.init(),
        IdempotencyKey.init(),
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

      if (profile) {
        await FinancialProfile.create([profile], { session });
      }

      await Recommendation.create([omitUnsetOptionalUniqueFields({
        ...recommendation,
        idempotencyOperationId: idempotencyClaim.operationId,
        idempotencyRequestHash: idempotencyClaim.requestHash,
        responseSnapshot: committedResponse,
      })], { session });

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
