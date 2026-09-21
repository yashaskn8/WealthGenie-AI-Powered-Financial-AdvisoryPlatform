import { Router } from 'express';
import { verifyJWT } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { planReviewLimiter } from '../middleware/rateLimiter.js';
import { validateStrict } from '../validation/financialSchemas.js';
import { planReviewRequestSchema } from '../agents/planReview/planReviewSchemas.js';
import { getPlanReviewRun, runPlanReview } from '../agents/planReview/planReviewService.js';

const router = Router();

function isEnabled(req) {
  return req.app.locals.runtimeConfig?.agenticPlanReviewEnabled === true;
}

function featureUnavailable() {
  throw createError(404, 'Plan review feature is unavailable.', 'Plan review is not available.', { code: 'FEATURE_UNAVAILABLE' });
}

router.post('/plan-review', verifyJWT, planReviewLimiter, validateStrict(planReviewRequestSchema), asyncHandler(async (req, res) => {
  if (!isEnabled(req)) return featureUnavailable();
  const result = await runPlanReview({
    userId: req.user.userId,
    profileId: req.body.profileId,
    correlationId: req.correlationId,
    traceId: req.traceId || req.correlationId,
    runtimeConfig: req.app.locals.runtimeConfig,
  });
  return res.json(result);
}));

router.get('/plan-review/:runId', verifyJWT, asyncHandler(async (req, res) => {
  if (!isEnabled(req)) return featureUnavailable();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.runId)) {
    throw createError(400, 'Invalid plan review run ID.', 'Invalid plan review run ID.');
  }
  const run = await getPlanReviewRun({ userId: req.user.userId, runId: req.params.runId });
  if (!run) throw createError(404, 'Plan review run not found or access denied.', 'Plan review run not found.');
  return res.json(run.result);
}));

export default router;
