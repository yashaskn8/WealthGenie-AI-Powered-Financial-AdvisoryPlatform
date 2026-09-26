import AgentRun from '../../models/AgentRun.js';
import AgentCheckpoint from '../../models/AgentCheckpoint.js';
import AgentGraphCheckpoint from '../../models/AgentGraphCheckpoint.js';
import UserIntentMandate from '../../models/UserIntentMandate.js';
import { PrometheusMetrics } from '../../services/metricsCollector.js';
import { PLAN_REVIEW_CHECKPOINT_RETENTION_MS } from './planReviewRuntime.js';

async function resolve(query) {
  return typeof query?.lean === 'function' ? query.lean() : query;
}

async function inRunTransaction(model, callback) {
  // Real Mongoose models always have a connection. Dependency-injected unit
  // fixtures may omit it; the production path must never silently downgrade
  // an authoritative terminal transition to non-transactional writes.
  if (!model?.db) return callback(null);
  if (typeof model.db.startSession !== 'function') {
    throw Object.assign(new Error('PlanReview terminal transitions require MongoDB transaction support.'), {
      status: 503,
      code: 'AGENT_RUNTIME_PERSISTENCE_UNAVAILABLE',
    });
  }
  const session = await model.db.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await callback(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function retainTerminalCheckpoints({ runId, userId, now, session, checkpointModel, graphCheckpointModel }) {
  const expiresAt = new Date(now.getTime() + PLAN_REVIEW_CHECKPOINT_RETENTION_MS);
  const options = session ? { session } : {};
  await checkpointModel.updateMany({ runId, userId }, { $set: { expiresAt } }, options);
  await graphCheckpointModel.updateMany({ runId, userId }, { $set: { expiresAt } }, options);
}

function withSession(query, session) {
  return session && typeof query?.session === 'function' ? query.session(session) : query;
}

/** CAS-bound review-action metadata and lifecycle transition. */
export async function persistPlanReviewAction({
  model = AgentRun,
  userId,
  runId,
  planReviewSnapshotHash,
  action,
  mandate = null,
  now = new Date(),
  checkpointModel = AgentCheckpoint,
  graphCheckpointModel = AgentGraphCheckpoint,
}) {
  const isApprovalAction = action === 'APPROVE_RECOMPUTE' || action === 'REJECT_RECOMPUTE';
  if (!['APPROVE_RECOMPUTE', 'REJECT_RECOMPUTE', 'OPEN_PROFILE', 'OPEN_GOALS'].includes(action)) {
    const error = new Error('Unsupported PlanReview action.');
    error.code = 'UNSUPPORTED_AGENT_ACTION';
    error.status = 400;
    throw error;
  }

  const approvalStatus = action === 'APPROVE_RECOMPUTE'
    ? (mandate ? 'MANDATE_CREATED' : 'USER_APPROVED')
    : action === 'REJECT_RECOMPUTE' ? 'USER_REJECTED' : 'USER_OPENED';
  const filter = { userId, runId, planReviewSnapshotHash };
  if (isApprovalAction) filter.status = 'WAITING_FOR_APPROVAL';
  const update = {
    $set: {
      approval: {
        status: approvalStatus,
        action,
        mandateId: mandate?.mandateId || null,
        at: now,
      },
    },
  };
  if (isApprovalAction && !mandate) {
    update.$set.status = 'COMPLETED';
    update.$set.completedAt = now;
    update.$set.leaseUntil = null;
    update.$unset = { activeDedupeKey: 1 };
  }
  const terminal = isApprovalAction && !mandate;
  return inRunTransaction(model, async session => {
    const query = model.findOneAndUpdate(filter, update, { new: true, ...(session ? { session } : {}) });
    const saved = await resolve(withSession(query, session));
    if (saved && terminal) {
      await retainTerminalCheckpoints({ runId, userId, now, session, checkpointModel, graphCheckpointModel });
    }
    return saved;
  });
}

export async function completePlanReviewMandateAction({
  model = AgentRun,
  userId,
  runId,
  mandateId,
  outcome,
  now = new Date(),
  checkpointModel = AgentCheckpoint,
  graphCheckpointModel = AgentGraphCheckpoint,
}) {
  if (!['EXECUTED', 'REJECTED', 'REVOKED', 'EXPIRED', 'FAILED'].includes(outcome)) {
    throw new TypeError('Unsupported PlanReview mandate outcome.');
  }
  const runStatus = outcome === 'EXECUTED' ? 'COMPLETED'
    : (outcome === 'REJECTED' || outcome === 'REVOKED') ? 'CANCELLED'
      : 'FAILED';
  const update = {
    $set: {
      status: runStatus,
      completedAt: now,
      leaseUntil: null,
      'approval.status': `MANDATE_${outcome}`,
      'approval.completedAt': now,
    },
    $unset: { activeDedupeKey: 1 },
  };
  if (runStatus === 'FAILED') {
    update.$set.failure = { code: `MANDATE_${outcome}`, message: `The approval mandate ended with ${outcome.toLowerCase()}.` };
  }
  return inRunTransaction(model, async session => {
    const query = model.findOneAndUpdate({
      userId,
      runId,
      status: 'WAITING_FOR_APPROVAL',
      'approval.mandateId': mandateId,
    }, update, { new: true, ...(session ? { session } : {}) });
    const saved = await resolve(withSession(query, session));
    if (saved) {
      await retainTerminalCheckpoints({ runId, userId, now, session, checkpointModel, graphCheckpointModel });
    }
    return saved;
  });
}

/**
 * Restart-safe reconciliation for terminal/expired mandates. The mandate
 * transition is a CAS and the source AgentRun transition is independently
 * idempotent; repeated sweeps and competing workers are harmless.
 */
export async function reconcileTerminalPlanReviewMandates({
  mandateModel = UserIntentMandate,
  runModel = AgentRun,
  checkpointModel = AgentCheckpoint,
  graphCheckpointModel = AgentGraphCheckpoint,
  now = new Date(),
  limit = 100,
} = {}) {
  const expired = await mandateModel.updateMany({
    agentType: 'PLAN_REVIEW',
    status: { $in: ['DRAFT', 'PENDING_USER_VERIFICATION', 'AUTHORIZED'] },
    expiresAt: { $lte: now },
  }, { $set: { status: 'EXPIRED', failureCode: 'MANDATE_EXPIRED' } });
  const expiredCount = Number(expired?.modifiedCount ?? expired?.nModified ?? 0);
  if (expiredCount > 0) PrometheusMetrics.inc('mandates_expired_total', expiredCount);

  const query = mandateModel.find({
    agentType: 'PLAN_REVIEW',
    status: { $in: ['EXECUTED', 'REJECTED', 'REVOKED', 'EXPIRED', 'FAILED'] },
    runId: { $type: 'string' },
    sourceRunReconciliationStatus: { $nin: ['RECONCILED', 'ALREADY_TERMINAL', 'SOURCE_RUN_MISSING', 'BINDING_MISMATCH', 'SOURCE_RUN_STATE_CONFLICT'] },
  });
  const mandates = await query.sort({ updatedAt: 1 }).limit(Math.max(1, Math.min(500, limit))).lean();
  let reconciled = 0;
  let processed = 0;
  for (const mandate of mandates) {
    const result = await completePlanReviewMandateAction({
      model: runModel,
      userId: mandate.userId,
      runId: mandate.runId,
      mandateId: mandate.mandateId,
      outcome: mandate.status,
      now,
      checkpointModel,
      graphCheckpointModel,
    });
    let reconciliationStatus = result ? 'RECONCILED' : null;
    if (!result) {
      const runQuery = runModel.findOne({ userId: mandate.userId, runId: mandate.runId });
      const sourceRun = await (typeof runQuery?.select === 'function' ? runQuery.select('status approval') : runQuery)?.lean?.();
      if (!sourceRun) {
        reconciliationStatus = 'SOURCE_RUN_MISSING';
      } else if (sourceRun.status === 'WAITING_FOR_APPROVAL') {
        if (sourceRun.approval?.mandateId !== mandate.mandateId) {
          reconciliationStatus = 'BINDING_MISMATCH';
        }
        // A matching waiting run can be a concurrent CAS winner that has not
        // committed yet. Leave it pending so a later sweep retries it.
      } else if (sourceRun.approval?.mandateId === mandate.mandateId) {
        const expectedStatus = mandate.status === 'EXECUTED' ? 'COMPLETED'
          : (mandate.status === 'REJECTED' || mandate.status === 'REVOKED') ? 'CANCELLED' : 'FAILED';
        reconciliationStatus = sourceRun.status === expectedStatus
          && sourceRun.approval.status === `MANDATE_${mandate.status}`
          ? 'ALREADY_TERMINAL'
          : 'SOURCE_RUN_STATE_CONFLICT';
      } else {
        reconciliationStatus = 'SOURCE_RUN_STATE_CONFLICT';
      }
    } else {
      reconciled += 1;
    }

    if (reconciliationStatus) {
      const marked = await mandateModel.updateOne({
        mandateId: mandate.mandateId,
        status: mandate.status,
        sourceRunReconciliationStatus: null,
      }, { $set: { sourceRunReconciliationStatus: reconciliationStatus, sourceRunReconciledAt: now } });
      if (Number(marked?.modifiedCount ?? marked?.nModified ?? 0) > 0) processed += 1;
      if (reconciliationStatus === 'BINDING_MISMATCH' || reconciliationStatus === 'SOURCE_RUN_STATE_CONFLICT') {
        PrometheusMetrics.inc('agent_mandate_reconciliation_binding_conflicts_total');
      }
    }
  }
  return { scanned: mandates.length, reconciled, processed };
}
