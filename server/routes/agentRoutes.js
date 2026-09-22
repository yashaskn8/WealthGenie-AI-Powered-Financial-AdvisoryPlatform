import { Router } from 'express';
import { verifyJWT } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { planReviewLimiter } from '../middleware/rateLimiter.js';
import { planReviewRequestSchema } from '../agents/planReview/planReviewSchemas.js';
import { planReviewActionSchema } from '../agents/planReview/planReviewSchemas.js';
import { enqueuePlanReviewRun, getCurrentPlanReviewRun, getPlanReviewRun } from '../agents/planReview/planReviewService.js';
import AgentRunModel from '../models/AgentRun.js';
import { buildApprovalAction } from '../agents/planReview/planReviewRuntime.js';
import { acknowledgePlanHealthEvent, inspectPlanHealth, listPlanHealthEvents } from '../services/planHealthMonitor.js';
import AgentRunEvent from '../models/AgentRunEvent.js';
import { buildPlanReviewA2UI } from '../agents/a2ui/a2uiSchemas.js';
import { getAgentCard, listAgentCards } from '../agents/a2a/agentCards.js';
import { validateStrict } from '../validation/financialSchemas.js';
import { mandateApprovalAssertionSchema, mandateRevokeSchema, passkeyRegistrationResponseSchema } from '../agents/authorization/authorizationSchemas.js';
import {
  createMandateForPlanReview,
  getMandateForUser,
  listMandatesForUser,
  createApprovalOptions,
  verifyMandateApproval,
  revokeMandate,
} from '../agents/authorization/mandateService.js';
import { createAuthorizedActionExecutor } from '../agents/authorization/authorizedActionExecutor.js';
import { createPasskeyRegistrationOptions, verifyPasskeyRegistration } from '../agents/authorization/passkeyService.js';
import ExecutionReceipt from '../models/ExecutionReceipt.js';
import { appendAuthorizationEvent } from '../agents/authorization/authorizationEvents.js';
import { PrometheusMetrics } from '../services/metricsCollector.js';

const router = Router();

function isEnabled(req) {
  return req.app.locals.runtimeConfig?.agenticPlanReviewEnabled === true;
}

function featureUnavailable() {
  throw createError(404, 'Plan review feature is unavailable.', 'Plan review is not available.', { code: 'FEATURE_UNAVAILABLE' });
}

function authorizationEnabled(req) {
  return req.app.locals.runtimeConfig?.authorization?.verifiableActionsEnabled === true;
}

function authorizationConfig(req) {
  const config = req.app.locals.runtimeConfig;
  return {
    ...config,
    env: {
      ...process.env,
      NODE_ENV: config.nodeEnv,
      AGENT_APPROVAL_PROVIDER: config.authorization.approvalProvider,
      WEBAUTHN_ORIGIN: config.authorization.webauthnOrigin || process.env.WEBAUTHN_ORIGIN,
      WEBAUTHN_RP_ID: config.authorization.webauthnRpId || process.env.WEBAUTHN_RP_ID,
    },
  };
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

router.get('/cards', verifyJWT, asyncHandler(async (req, res) => {
  if (!isEnabled(req)) return featureUnavailable();
  return res.json({ protocolVersion: 'a2a-1.0.0', agents: listAgentCards() });
}));

router.get('/cards/:agentType', verifyJWT, asyncHandler(async (req, res) => {
  if (!isEnabled(req)) return featureUnavailable();
  const card = getAgentCard(req.params.agentType);
  if (!card) throw createError(404, 'Agent card not found.', 'Agent card not found.');
  return res.json(card);
}));

router.get('/plan-review/:runId/events', verifyJWT, asyncHandler(async (req, res) => {
  if (!isEnabled(req) || req.app.locals.runtimeConfig?.agentStreamEnabled !== true) return featureUnavailable();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.runId)) {
    throw createError(400, 'Invalid plan review run ID.', 'Invalid plan review run ID.');
  }
  const ownedRun = await AgentRunModel.findOne({ userId: req.user.userId, runId: req.params.runId }).lean();
  if (!ownedRun) throw createError(404, 'Plan review run not found or access denied.', 'Plan review run not found.');
  let sequence = Number(req.get('Last-Event-ID') || 0);
  if (!Number.isInteger(sequence) || sequence < 0) sequence = 0;
  res.status(200);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  let closed = false;
  let timer;
  let deadline;
  const cleanup = () => {
    closed = true;
    if (timer) clearInterval(timer);
    if (deadline) clearTimeout(deadline);
  };
  req.on('close', cleanup);
  const send = async () => {
    if (closed) return;
    const events = await AgentRunEvent.find({ userId: req.user.userId, runId: req.params.runId, sequence: { $gt: sequence } })
      .sort({ sequence: 1 }).limit(100).lean();
    for (const event of events) {
      sequence = event.sequence;
      res.write(`id: ${event.sequence}\nevent: ${event.eventType}\ndata: ${JSON.stringify(event.data || {})}\n\n`);
    }
    const currentRun = await AgentRunModel.findOne({ userId: req.user.userId, runId: req.params.runId }).lean();
    if (['COMPLETED', 'WAITING_FOR_APPROVAL', 'FAILED', 'CANCELLED', 'BUDGET_EXCEEDED'].includes(currentRun?.status)) {
      cleanup();
      res.end();
    }
  };
  await send();
  if (!closed) {
    res.write(': connected\n\n');
    timer = setInterval(() => { void send().catch(() => cleanup()); }, 1000);
    timer.unref?.();
    deadline = setTimeout(() => { cleanup(); res.end(); }, 30000);
    deadline.unref?.();
  }
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

router.get('/plan-review/:runId/ui', verifyJWT, asyncHandler(async (req, res) => {
  if (!isEnabled(req)) return featureUnavailable();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.runId)) {
    throw createError(400, 'Invalid plan review run ID.', 'Invalid plan review run ID.');
  }
  const run = await AgentRunModel.findOne({ userId: req.user.userId, runId: req.params.runId }).lean();
  if (!run) throw createError(404, 'Plan review run not found or access denied.', 'Plan review run not found.');
  return res.json(buildPlanReviewA2UI(run.result));
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
  if (req.body.action === 'APPROVE_RECOMPUTE' && authorizationEnabled(req)) {
    await appendAuthorizationEvent({ runId: req.params.runId, userId: req.user.userId, eventType: 'ACTION_PROPOSED', data: { action: req.body.action } });
    const mandate = await createMandateForPlanReview({
      runId: req.params.runId,
      userId: req.user.userId,
      correlationId: req.correlationId,
      ttlSeconds: req.app.locals.runtimeConfig.authorization.mandateTtlSeconds,
      runtimeConfig: authorizationConfig(req),
    });
    await AgentRunModel.updateOne(
      { userId: req.user.userId, runId: req.params.runId },
      { $set: { approval: { status: 'MANDATE_CREATED', action: req.body.action, mandateId: mandate.mandateId, at: new Date() } } },
    );
    await appendAuthorizationEvent({ runId: req.params.runId, userId: req.user.userId, eventType: 'MANDATE_CREATED', data: { mandateId: mandate.mandateId, action: mandate.action } });
    return res.status(201).json({ ...descriptor, authorization: { enabled: true, status: mandate.status }, mandate });
  }
  const approvalStatus = req.body.action === 'APPROVE_RECOMPUTE' ? 'USER_APPROVED'
    : req.body.action === 'REJECT_RECOMPUTE' ? 'USER_REJECTED' : 'USER_OPENED';
  await AgentRunModel.updateOne(
    { userId: req.user.userId, runId: req.params.runId },
    { $set: { approval: { status: approvalStatus, action: req.body.action, at: new Date() } } },
  );
  return res.json(descriptor);
}));

router.get('/mandates', verifyJWT, asyncHandler(async (req, res) => {
  if (!authorizationEnabled(req)) return featureUnavailable();
  return res.json({ mandates: await listMandatesForUser({ userId: req.user.userId, limit: req.query.limit }) });
}));

router.post('/passkeys/registration/options', verifyJWT, asyncHandler(async (req, res) => {
  if (!authorizationEnabled(req)) return featureUnavailable();
  return res.json(await createPasskeyRegistrationOptions({ userId: req.user.userId, runtimeConfig: authorizationConfig(req) }));
}));

router.post('/passkeys/registration/verify', verifyJWT, validateStrict(passkeyRegistrationResponseSchema), asyncHandler(async (req, res) => {
  if (!authorizationEnabled(req)) return featureUnavailable();
  return res.status(201).json(await verifyPasskeyRegistration({ userId: req.user.userId, response: req.body, runtimeConfig: authorizationConfig(req) }));
}));

router.get('/mandates/:mandateId', verifyJWT, asyncHandler(async (req, res) => {
  if (!authorizationEnabled(req)) return featureUnavailable();
  const mandate = await getMandateForUser({ mandateId: req.params.mandateId, userId: req.user.userId });
  if (!mandate) throw createError(404, 'Mandate not found or access denied.', 'Mandate not found.');
  return res.json(mandate);
}));

router.post('/mandates/:mandateId/approval/options', verifyJWT, asyncHandler(async (req, res) => {
  if (!authorizationEnabled(req)) return featureUnavailable();
  const result = await createApprovalOptions({ mandateId: req.params.mandateId, userId: req.user.userId, runtimeConfig: authorizationConfig(req) });
  await appendAuthorizationEvent({ runId: result.mandate.runId, userId: req.user.userId, eventType: 'USER_VERIFICATION_REQUIRED', data: { mandateId: req.params.mandateId, action: result.mandate.action } });
  return res.json(result);
}));

router.post('/mandates/:mandateId/approval/verify', verifyJWT, validateStrict(mandateApprovalAssertionSchema), asyncHandler(async (req, res) => {
  if (!authorizationEnabled(req)) return featureUnavailable();
  if (req.body.mandateId !== req.params.mandateId) throw createError(400, 'Mandate ID mismatch.', 'Mandate ID mismatch.');
  const mandate = await verifyMandateApproval({ mandateId: req.params.mandateId, userId: req.user.userId, assertion: req.body, runtimeConfig: authorizationConfig(req) });
  await appendAuthorizationEvent({ runId: mandate.runId, userId: req.user.userId, eventType: 'MANDATE_AUTHORIZED', data: { mandateId: mandate.mandateId, action: mandate.action } });
  return res.json(mandate);
}));

router.post('/mandates/:mandateId/revoke', verifyJWT, validateStrict(mandateRevokeSchema), asyncHandler(async (req, res) => {
  if (!authorizationEnabled(req)) return featureUnavailable();
  const mandate = await revokeMandate({ mandateId: req.params.mandateId, userId: req.user.userId, reason: req.body.reason });
  await appendAuthorizationEvent({ runId: mandate.runId, userId: req.user.userId, eventType: 'MANDATE_REVOKED', data: { mandateId: mandate.mandateId, action: mandate.action } });
  return res.json(mandate);
}));

router.post('/mandates/:mandateId/execute', verifyJWT, asyncHandler(async (req, res) => {
  if (!authorizationEnabled(req)) return featureUnavailable();
  if (Object.keys(req.body || {}).length !== 0) throw createError(400, 'Execution accepts no model-controlled parameters.', 'Execution payload must be empty.');
  const startedAt = Date.now();
  try {
    const result = await createAuthorizedActionExecutor({ runtimeConfig: authorizationConfig(req) }).execute({ mandateId: req.params.mandateId, userId: req.user.userId, correlationId: req.correlationId });
    return res.json({ receipt: result.receipt, response: result.response });
  } finally {
    PrometheusMetrics.recordAuthorizationLatency(Date.now() - startedAt);
  }
}));

router.get('/receipts/:receiptId', verifyJWT, asyncHandler(async (req, res) => {
  if (!authorizationEnabled(req)) return featureUnavailable();
  const receipt = await ExecutionReceipt.findOne({ receiptId: req.params.receiptId, userId: req.user.userId }).lean();
  if (!receipt) throw createError(404, 'Execution receipt not found or access denied.', 'Execution receipt not found.');
  return res.json(receipt);
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
