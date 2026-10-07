import AgentRun from '../../models/AgentRun.js';
import AgentRunEvent from '../../models/AgentRunEvent.js';
import AgentCheckpoint from '../../models/AgentCheckpoint.js';
import AgentGraphCheckpoint from '../../models/AgentGraphCheckpoint.js';
import ProductionAgentEvaluation from '../../models/ProductionAgentEvaluation.js';
import { scheduleTerminalEvaluationReconciliation } from '../evals/productionEvaluationQueue.js';
import { PLAN_REVIEW_CHECKPOINT_RETENTION_MS } from './planReviewRuntime.js';

async function inTransaction(model, callback) {
  if (!model?.db) return callback(null);
  if (typeof model.db.startSession !== 'function') {
    throw Object.assign(new Error('PlanReview terminal transitions require transaction-capable MongoDB.'), {
      status: 503,
      code: 'AGENT_RUNTIME_PERSISTENCE_UNAVAILABLE',
    });
  }
  const session = await model.db.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await callback(session); });
    return result;
  } finally {
    await session.endSession();
  }
}
async function resolve(query) {
  return typeof query?.lean === 'function' ? query.lean() : query;
}

/** Persist cancellation/supersession, its immutable event, and checkpoint TTL atomically. */
export async function terminalizePlanReviewRun({
  model = AgentRun,
  eventModel = AgentRunEvent,
  checkpointModel = AgentCheckpoint,
  graphCheckpointModel = AgentGraphCheckpoint,
  productionEvaluationModel = ProductionAgentEvaluation,
  userId,
  runId,
  expectedStatuses,
  expectedPlanReviewSnapshotHash = null,
  status,
  reasonCode,
  node = null,
  now = new Date(),
  session = null,
} = {}) {
  if (!['CANCELLED', 'SUPERSEDED'].includes(status) || !Array.isArray(expectedStatuses)
      || !expectedStatuses.length || !reasonCode) {
    throw new TypeError('A valid PlanReview terminal transition is required.');
  }
  if (!session && model?.db) {
    const run = await inTransaction(model, transaction => terminalizePlanReviewRun({
      model, eventModel, checkpointModel, graphCheckpointModel, productionEvaluationModel, userId, runId,
      expectedStatuses, expectedPlanReviewSnapshotHash, status, reasonCode, node, now, session: transaction,
    }));
    if (run && model === AgentRun && productionEvaluationModel) {
      scheduleTerminalEvaluationReconciliation({ runModel: model, eventModel, evaluationModel: productionEvaluationModel });
    }
    return run;
  }
  const filter = { userId, runId, status: { $in: expectedStatuses } };
  if (expectedPlanReviewSnapshotHash) filter.planReviewSnapshotHash = expectedPlanReviewSnapshotHash;
  const eventType = status === 'CANCELLED' ? 'RUN_CANCELLED' : 'RUN_SUPERSEDED';
  const update = {
    $set: {
      status,
      completedAt: now,
      leaseUntil: null,
      ...(status === 'CANCELLED' ? { cancellationRequested: true } : {}),
      failure: {
        code: reasonCode,
        message: status === 'CANCELLED'
          ? 'The plan review was cancelled by the user.'
          : 'Financial source state changed before this review completed.',
      },
    },
    $unset: { activeDedupeKey: 1 },
    $inc: { eventSequence: 1 },
  };
  const query = model.findOneAndUpdate(filter, update, { new: true, ...(session ? { session } : {}) });
  const run = await resolve(session && typeof query?.session === 'function' ? query.session(session) : query);
  if (!run) return null;
  if (!eventModel?.create || !checkpointModel?.updateMany || !graphCheckpointModel?.updateMany) {
    throw Object.assign(new Error('PlanReview terminal evidence stores are unavailable.'), {
      status: 503,
      code: 'AGENT_RUNTIME_PERSISTENCE_UNAVAILABLE',
    });
  }
  const options = session ? { session } : {};
  await eventModel.create([{
    runId,
    userId,
    executionGeneration: Number(run.executionGeneration) || 0,
    sequence: Number(run.eventSequence),
    eventType,
    node,
    data: { type: eventType, code: reasonCode, at: now.toISOString() },
  }], options);
  const expiresAt = new Date(now.getTime() + PLAN_REVIEW_CHECKPOINT_RETENTION_MS);
  await checkpointModel.updateMany({ runId, userId }, { $set: { expiresAt } }, options);
  await graphCheckpointModel.updateMany({ runId, userId }, { $set: { expiresAt } }, options);
  if (!session && run && model === AgentRun && productionEvaluationModel) {
    scheduleTerminalEvaluationReconciliation({ runModel: model, eventModel, evaluationModel: productionEvaluationModel });
  }
  return run;
}
