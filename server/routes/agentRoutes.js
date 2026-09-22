import { Router } from 'express';
import { verifyJWT } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { planReviewLimiter } from '../middleware/rateLimiter.js';
import { validateStrict } from '../validation/financialSchemas.js';
import { planReviewRequestSchema } from '../agents/planReview/planReviewSchemas.js';
import { planReviewActionSchema } from '../agents/planReview/planReviewSchemas.js';
import { enqueuePlanReviewRun, getCurrentPlanReviewRun, getPlanReviewRun } from '../agents/planReview/planReviewService.js';
import AgentRunModel from '../models/AgentRun.js';
import { buildApprovalAction } from '../agents/planReview/planReviewRuntime.js';
import { acknowledgePlanHealthEvent, inspectPlanHealth, listPlanHealthEvents } from '../services/planHealthMonitor.js';

const router = Router();

function isEnabled(req) {
  return req.app.locals.runtimeConfig?.agenticPlanReviewEnabled === true;
}

function featureUnavailable() {
  throw createError(404, 'Plan review feature is unavailable.', 'Plan review is not available.', { code: 'FEATURE_UNAVAILABLE' });
}

router.post('/plan-review', verifyJWT, planReviewLimiter, validateStrict(planReviewRequestSchema), asyncHandler(async (req, res) => {
  if (!isEnabled(req)) return featureUnavailable();
  const result = await enqueuePlanReviewRun({
    userId: req.user.userId,
    profileId: req.body.profileId,
    correlationId: req.correlationId,
    traceId: req.traceId || req.correlationId,
    runtimeConfig: req.app.locals.runtimeConfig,
  });
  return res.status(result.created ? 202 : 200).json(result.run);
}));

router.get('/plan-review/current', verifyJWT, asyncHandler(async (req, res) => {
  if (!isEnabled(req)) return featureUnavailable();
  if (!/^[0-9a-f]{24}$/i.test(String(req.query.profileId || ''))) {
    throw createError(400, 'A valid profile ID is required.', 'Invalid profile ID.');
  }
  const run = await getCurrentPlanReviewRun({ userId: req.user.userId, profileId: req.query.profileId });
  if (!run) throw createError(404, 'No plan review run found.', 'No plan review run found.');
  return res.json(run);
}));

router.get('/plan-review/:runId', verifyJWT, asyncHandler(async (req, res) => {
  if (!isEnabled(req)) return featureUnavailable();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.runId)) {
    throw createError(400, 'Invalid plan review run ID.', 'Invalid plan review run ID.');
  }
  const run = await getPlanReviewRun({ userId: req.user.userId, runId: req.params.runId });
  if (!run) throw createError(404, 'Plan review run not found or access denied.', 'Plan review run not found.');
  return res.json(run);
}));

router.post('/plan-review/:runId/cancel', verifyJWT, asyncHandler(async (req, res) => {
  if (!isEnabled(req)) return featureUnavailable();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.runId)) {
    throw createError(400, 'Invalid plan review run ID.', 'Invalid plan review run ID.');
  }
  const run = await AgentRunModel.findOneAndUpdate(
    { userId: req.user.userId, runId: req.params.runId, status: { $in: ['QUEUED', 'RUNNING', 'WAITING_FOR_APPROVAL'] } },
    { $set: { cancellationRequested: true, status: 'CANCELLED', completedAt: new Date(), leaseUntil: null }, $unset: { activeDedupeKey: 1 } },
    { new: true },
  ).lean();
  if (!run) throw createError(404, 'Plan review run not found or cannot be cancelled.', 'Plan review run not found.');
  return res.json({ runId: run.runId, status: run.status, mutationPerformed: false });
}));

router.post('/plan-review/:runId/action', verifyJWT, validateStrict(planReviewActionSchema), asyncHandler(async (req, res) => {
  if (!isEnabled(req)) return featureUnavailable();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.runId)) {
    throw createError(400, 'Invalid plan review run ID.', 'Invalid plan review run ID.');
  }
  const run = await AgentRunModel.findOne({ userId: req.user.userId, runId: req.params.runId }).lean();
  if (!run) throw createError(404, 'Plan review run not found or access denied.', 'Plan review run not found.');
  if (run.status !== 'WAITING_FOR_APPROVAL' && req.body.action === 'APPROVE_RECOMPUTE') {
    throw createError(409, 'This plan review is not waiting for approval.', 'Plan review approval is not available.');
  }
  const descriptor = buildApprovalAction(req.body.action, run);
  const approvalStatus = req.body.action === 'APPROVE_RECOMPUTE' ? 'USER_APPROVED'
    : req.body.action === 'REJECT_RECOMPUTE' ? 'USER_REJECTED' : 'USER_OPENED';
  await AgentRunModel.updateOne(
    { userId: req.user.userId, runId: req.params.runId },
    { $set: { approval: { status: approvalStatus, action: req.body.action, at: new Date() } } },
  );
  return res.json(descriptor);
}));

router.get('/plan-health', verifyJWT, asyncHandler(async (req, res) => {
  if (!isEnabled(req)) return featureUnavailable();
  if (!/^[0-9a-f]{24}$/i.test(String(req.query.profileId || ''))) {
    throw createError(400, 'A valid profile ID is required.', 'Invalid profile ID.');
  }
  const result = await inspectPlanHealth({ userId: req.user.userId, profileId: req.query.profileId });
  return res.json(result);
}));

router.get('/plan-health/events', verifyJWT, asyncHandler(async (req, res) => {
  if (!isEnabled(req)) return featureUnavailable();
  const events = await listPlanHealthEvents({ userId: req.user.userId, limit: req.query.limit });
  return res.json({ events });
}));

router.patch('/plan-health/events/:eventId/acknowledge', verifyJWT, asyncHandler(async (req, res) => {
  if (!isEnabled(req)) return featureUnavailable();
  if (!/^[0-9a-f]{24}$/i.test(req.params.eventId)) throw createError(400, 'Invalid health event ID.', 'Invalid health event ID.');
  const event = await acknowledgePlanHealthEvent({ userId: req.user.userId, eventId: req.params.eventId });
  if (!event) throw createError(404, 'Plan health event not found.', 'Plan health event not found.');
  return res.json(event);
}));

export default router;
