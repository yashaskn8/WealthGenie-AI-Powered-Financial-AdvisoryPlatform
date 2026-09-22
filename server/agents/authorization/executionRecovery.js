import crypto from 'node:crypto';
import AuthorizedExecutionAttempt from '../../models/AuthorizedExecutionAttempt.js';
import ExecutionReceipt from '../../models/ExecutionReceipt.js';
import UserIntentMandate from '../../models/UserIntentMandate.js';
import { createAuthorizationKeyProvider } from './keyProvider.js';
import { verifyExecutionReceipt } from './executionReceipt.js';

const LEASE_MS = 60000;

function resolve(value) { return typeof value?.lean === 'function' ? value.lean() : value; }

export async function reconcileAuthorizedExecution({ mandateId, userId, dependencies = {}, runtimeConfig = {}, now = new Date() } = {}) {
  const models = { attemptModel: AuthorizedExecutionAttempt, mandateModel: UserIntentMandate, receiptModel: ExecutionReceipt, ...dependencies };
  const attempt = await resolve(models.attemptModel.findOne({ mandateId, userId }));
  const mandate = await resolve(models.mandateModel.findOne({ mandateId, userId }));
  if (!attempt || !mandate) return { status: 'NOT_FOUND', reconciled: false };
  const keyProvider = dependencies.keyProvider || createAuthorizationKeyProvider({ env: runtimeConfig.env || process.env, required: (runtimeConfig.env || process.env).NODE_ENV === 'production' });
  const candidateReceipt = attempt.receiptId
    ? await resolve(models.receiptModel.findOne({ receiptId: attempt.receiptId, mandateId, userId }))
    : await resolve(models.receiptModel.findOne({ mandateId, userId }));
  const receipt = candidateReceipt && verifyExecutionReceipt(candidateReceipt, keyProvider) ? candidateReceipt : null;
  if (receipt) {
    await models.attemptModel.updateOne(
      { mandateId, userId, executionGeneration: attempt.executionGeneration },
      { $set: { status: 'COMPLETED', receiptId: receipt.receiptId, completedAt: receipt.completedAt, leaseUntil: null, heartbeatAt: now } },
    );
    await models.mandateModel.updateOne(
      { mandateId, userId, status: { $in: ['AUTHORIZED', 'EXECUTING'] } },
      { $set: { status: 'EXECUTED', executedAt: receipt.completedAt, receiptId: receipt.receiptId } },
    );
    return { status: 'COMPLETED', reconciled: true, receiptId: receipt.receiptId };
  }
  if (attempt.status === 'RECEIPT_PENDING' || attempt.status === 'COMMITTED') {
    await models.attemptModel.updateOne(
      { mandateId, userId, executionGeneration: attempt.executionGeneration },
      { $set: { status: 'REQUIRES_RECONCILIATION', leaseUntil: null, heartbeatAt: now, failureCode: 'RECEIPT_MISSING_AFTER_COMMIT' } },
    );
    return { status: 'REQUIRES_RECONCILIATION', reconciled: false };
  }
  if (new Date(attempt.leaseUntil).getTime() > now.getTime()) return { status: attempt.status, reconciled: false };
  return { status: 'STALE_RETRYABLE', reconciled: false };
}

export async function recoverAuthorizedExecution(args = {}) {
  const { createAuthorizedActionExecutor } = await import('./authorizedActionExecutor.js');
  return createAuthorizedActionExecutor({ dependencies: args.dependencies, runtimeConfig: args.runtimeConfig }).execute({
    mandateId: args.mandateId,
    userId: args.userId,
    correlationId: args.correlationId || null,
    recovery: true,
  });
}

export async function reconcileAuthorizedExecutions({ dependencies = {}, runtimeConfig = {}, limit = 100 } = {}) {
  const models = { attemptModel: AuthorizedExecutionAttempt, ...dependencies };
  const attempts = await models.attemptModel.find({
    status: { $in: ['EXECUTING', 'COMMITTED', 'RECEIPT_PENDING', 'REQUIRES_RECONCILIATION'] },
    $or: [{ leaseUntil: { $lt: new Date() } }, { status: 'REQUIRES_RECONCILIATION' }],
  }).limit(Math.min(1000, Math.max(1, Number(limit) || 100))).lean();
  const results = [];
  for (const attempt of attempts) {
    const result = await reconcileAuthorizedExecution({ mandateId: attempt.mandateId, userId: attempt.userId, dependencies, runtimeConfig });
    if (['STALE_RETRYABLE', 'REQUIRES_RECONCILIATION'].includes(result.status) && Number(attempt.retryCount || 0) < 3) {
      try {
        results.push({ ...(await recoverAuthorizedExecution({ mandateId: attempt.mandateId, userId: attempt.userId, dependencies, runtimeConfig })), recovery: true });
      } catch (error) {
        results.push({ status: result.status === 'REQUIRES_RECONCILIATION' ? 'REQUIRES_RECONCILIATION' : 'FAILED_RETRYABLE', mandateId: attempt.mandateId, code: error.code || 'AUTHORIZED_RECOVERY_FAILED' });
      }
    } else if (result.status === 'STALE_RETRYABLE') {
      await models.attemptModel.updateOne({ mandateId: attempt.mandateId, userId: attempt.userId, executionGeneration: attempt.executionGeneration }, { $set: { status: 'FAILED_TERMINAL', failureCode: 'RECOVERY_RETRY_LIMIT', leaseUntil: null } });
      results.push({ status: 'FAILED_TERMINAL', mandateId: attempt.mandateId });
    } else {
      results.push(result);
    }
  }
  return results;
}

export function newExecutionClaim({ mandate, userId, workerId = `executor:${crypto.randomUUID()}`, now = new Date(), leaseMs = LEASE_MS } = {}) {
  return {
    executionId: crypto.randomUUID(),
    mandateId: mandate.mandateId,
    userId,
    action: mandate.action,
    status: 'CLAIMED',
    executionGeneration: 1,
    workerId,
    leaseUntil: new Date(now.getTime() + leaseMs),
    heartbeatAt: now,
    startedAt: now,
    idempotencyKey: `mandate:${mandate.mandateId}`,
    financialSnapshotHash: mandate.financialSnapshotHash,
    retryCount: 0,
  };
}
