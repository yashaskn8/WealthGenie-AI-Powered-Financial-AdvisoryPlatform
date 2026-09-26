import AgentRun from '../../models/AgentRun.js';

async function resolve(query) {
  return typeof query?.lean === 'function' ? query.lean() : query;
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
  return resolve(model.findOneAndUpdate(filter, update, { new: true }));
}

export async function completePlanReviewMandateAction({ model = AgentRun, userId, runId, mandateId, outcome, now = new Date() }) {
  if (!['EXECUTED', 'REVOKED', 'EXPIRED', 'FAILED'].includes(outcome)) {
    throw new TypeError('Unsupported PlanReview mandate outcome.');
  }
  return resolve(model.findOneAndUpdate({
    userId,
    runId,
    status: 'WAITING_FOR_APPROVAL',
    'approval.mandateId': mandateId,
  }, {
    $set: {
      status: 'COMPLETED',
      completedAt: now,
      leaseUntil: null,
      'approval.status': `MANDATE_${outcome}`,
      'approval.completedAt': now,
    },
    $unset: { activeDedupeKey: 1 },
  }, { new: true }));
}
