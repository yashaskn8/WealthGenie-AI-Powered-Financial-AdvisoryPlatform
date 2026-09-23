import mongoose from 'mongoose';
import { Router } from 'express';
import { verifyJWT } from '../middleware/authMiddleware.js';
import { asyncHandler, createError, sendError } from '../middleware/errorHandler.js';
import {
  financialProfileSchema,
  financialProfileCompletionSchema,
  financialProfileUpdateSchema,
  validateStrict,
} from '../validation/financialSchemas.js';
import {
  buildRecommendationProfile,
  toProfileApiResponse,
  toProfilePersistence,
} from '../services/recommendationProfile.js';
import { assessSuitabilityRisk } from '../services/riskProfiler.js';
import FinancialProfile from '../models/FinancialProfile.js';
import { requireFreshRecommendationState } from '../services/recommendationState.js';
import { calculateFinancialHealthScore } from '../services/financialHealthEngine.js';
import { redisClient, redisAvailable } from '../config/redis.js';
import { idempotency } from '../middleware/idempotency.js';
import { persistAdvisoryAtomically } from '../services/advisoryPersistence.js';
import { getCurrentRegulatoryRuleVersion } from '../services/taxEngine.js';
import { PrometheusMetrics } from '../services/metricsCollector.js';
import { triggerPlanHealthCheck } from '../services/planHealthMonitor.js';
import {
  computeCoreRecommendation,
  readRecommendationMarketContext,
  assertCoreResultFinalSafety,
} from '../services/coreRecommendation.js';
import {
  storeProfileRecommendationCandidate,
  loadProfileRecommendationCandidate,
  validateProfileRecommendationCandidate,
  claimProfileCandidateForCommit,
  releaseProfileCandidateCommit,
  consumeProfileRecommendationCandidate,
  rebindCandidateForProfile,
} from '../services/profileCompletion.js';
import { claimAdvisoryIdempotency, releaseAdvisoryIdempotency } from '../middleware/idempotency.js';
import { createEndpointRateLimiter, ipKeyGenerator } from '../middleware/rateLimiter.js';

const router = Router();
const PROFILE_RATE_LIMIT = 10;
const profilePrecomputeLimiter = createEndpointRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Profile precomputation rate limit exceeded. Continue editing and try again shortly.',
  prefix: 'rl:profile-precompute:',
  keyGenerator: req => `user:${req.user?.userId || ipKeyGenerator(req.ip)}`,
});

function profilePersistenceDocument({ userId, profileId, canonical, suitability }) {
  return {
    _id: profileId,
    userId,
    ...toProfilePersistence(canonical, suitability),
    version: 1,
  };
}

function candidateMetricFor(reason) {
  if (reason === 'CANDIDATE_EXPIRED' || reason === 'CANDIDATE_EXPIRED_OR_MISSING') {
    PrometheusMetrics.inc('profile_complete_candidate_expired_total');
  }
  if (reason?.includes('PROFILE_MISMATCH')) {
    PrometheusMetrics.inc('profile_complete_candidate_profile_mismatch_total');
  }
  if (reason?.includes('VERSION_MISMATCH') || reason?.includes('SCHEMA_MISMATCH')) {
    PrometheusMetrics.inc('profile_complete_candidate_version_mismatch_total');
  }
}

async function checkProfileRateLimit(userId) {
  if (!redisAvailable || !redisClient) return true;
  try {
    const key = `profile:ratelimit:${userId}`;
    const count = await redisClient.incr(key);
    if (count === 1) await redisClient.expire(key, 3600);
    return count <= PROFILE_RATE_LIMIT;
  } catch {
    return true;
  }
}

export function formatProfileResponse(profile) {
  const p = profile?.toObject ? profile.toObject() : profile;
  const canonical = buildRecommendationProfile(p);
  const suitability = assessSuitabilityRisk(canonical);
  return {
    ...toProfileApiResponse(p),
    version: p.version ?? 1,
    risk_capacity_score: suitability.capacityScore,
    risk_capacity_level: suitability.capacityLevel,
    final_suitability_risk: suitability.finalRisk,
    final_suitability_level: suitability.finalLevel,
    suitability_reason_codes: suitability.reasonCodes,
  };
}

router.post(
  '/precompute',
  verifyJWT,
  profilePrecomputeLimiter,
  validateStrict(financialProfileSchema),
  asyncHandler(async (req, res) => {
    PrometheusMetrics.inc('profile_precompute_requested_total');
    try {
      const canonical = buildRecommendationProfile(req.body);
      const core = await computeCoreRecommendation({
        canonicalProfile: canonical,
        userId: req.user.userId,
        correlationId: req.correlationId,
        traceId: req.traceId || req.correlationId,
        userRole: req.user.role,
      });
      const candidate = await storeProfileRecommendationCandidate({
        userId: req.user.userId,
        core,
      });
      PrometheusMetrics.inc('profile_precompute_ready_total');
      return res.status(200).json(candidate);
    } catch (error) {
      PrometheusMetrics.inc('profile_precompute_failed_total');
      throw error;
    }
  }),
);

router.post(
  '/complete',
  verifyJWT,
  validateStrict(financialProfileCompletionSchema),
  asyncHandler(async (req, res) => {
    const totalStart = performance.now();
    const validationStart = performance.now();
    const canonical = buildRecommendationProfile(req.body);
    const suitability = assessSuitabilityRisk(canonical);
    const regulatoryRuleVersion = getCurrentRegulatoryRuleVersion();
    if (!regulatoryRuleVersion) {
      throw createError(
        503,
        'No verified regulatory policy is available for the current fiscal year.',
        'Regulatory policy metadata is temporarily unavailable.',
        { code: 'REGULATORY_POLICY_UNAVAILABLE' },
      );
    }
    const validationMs = performance.now() - validationStart;

    const idempotencyStart = performance.now();
    const idempotencyClaim = await claimAdvisoryIdempotency({
      key: req.headers['idempotency-key'],
      userId: req.user.userId,
      profileId: null,
      payload: req.body,
    });
    const idempotencyMs = performance.now() - idempotencyStart;
    if (idempotencyClaim.state === 'REPLAY') {
      res.setHeader('X-Cache-Lookup', 'HIT - Idempotent');
      return res.status(idempotencyClaim.response.status).json(idempotencyClaim.response.body);
    }

    const profileId = new mongoose.Types.ObjectId();
    const candidateId = req.body.candidateId || null;
    let candidate = null;
    let candidateValidation = { valid: false, reason: 'CANDIDATE_NOT_PROVIDED' };
    let candidateLease = null;
    let candidateMarketContext = null;
    const candidateLookupStart = performance.now();
    const candidateValidationStart = performance.now();

    try {
      if (candidateId) {
        const loaded = await loadProfileRecommendationCandidate({
          candidateId,
          userId: req.user.userId,
        });
        candidate = loaded.candidate;
        if (loaded.reason === 'CANDIDATE_CONSUMED') {
          throw createError(409, 'This precomputed candidate has already been consumed.', 'Please precompute the profile again before completing it.', { code: loaded.reason });
        }
        if (!candidate) {
          candidateValidation.reason = loaded.reason;
          candidateMetricFor(loaded.reason);
        } else {
          candidateMarketContext = await readRecommendationMarketContext();
          candidateValidation = validateProfileRecommendationCandidate({
            candidate,
            userId: req.user.userId,
            canonicalProfile: canonical,
            regulatoryRuleVersion,
            marketContext: candidateMarketContext,
          });
          if (!candidateValidation.valid) candidateMetricFor(candidateValidation.reason);
          if (candidateValidation.valid) {
            candidateLease = await claimProfileCandidateForCommit(candidateId);
            if (!candidateLease) {
              candidateValidation = { valid: false, reason: 'CANDIDATE_CONSUME_RACE' };
            }
          }
        }
      }
      const candidateLookupMs = performance.now() - candidateLookupStart;
      let core;
      let candidateHit = candidateValidation.valid && Boolean(candidateLease);
      if (candidateHit) {
        try {
          core = rebindCandidateForProfile(candidate, {
            userId: req.user.userId,
            profileId,
            correlationId: req.correlationId,
            traceId: req.traceId || req.correlationId,
          });
          assertCoreResultFinalSafety(canonical, core);
        } catch {
          candidateHit = false;
          candidateValidation = { valid: false, reason: 'CANDIDATE_FINAL_SAFETY_FAILURE' };
          await releaseProfileCandidateCommit(candidateLease);
          candidateLease = null;
          candidateMetricFor(candidateValidation.reason);
          core = null;
        }
      }
      if (!candidateHit) {
        core = await computeCoreRecommendation({
          canonicalProfile: canonical,
          userId: req.user.userId,
          profileId,
          correlationId: req.correlationId,
          traceId: req.traceId || req.correlationId,
          userRole: req.user.role,
          marketContext: candidateMarketContext,
        });
        assertCoreResultFinalSafety(canonical, core);
        PrometheusMetrics.inc('profile_complete_recomputed_total');
        PrometheusMetrics.inc('profile_complete_candidate_miss_total');
      } else {
        PrometheusMetrics.inc('profile_complete_candidate_hit_total');
        core.recommendationData.profileCompletionCandidateId = candidateId;
      }
      const candidateValidationMs = performance.now() - candidateValidationStart;
      const profileDocument = profilePersistenceDocument({
        userId: req.user.userId,
        profileId,
        canonical,
        suitability,
      });
      const response = {
        profile: formatProfileResponse(profileDocument),
        recommendation: core.response,
        completion: {
          status: 'COMMITTED',
          candidateHit,
          recomputed: !candidateHit,
          candidateReason: candidateValidation.reason,
          profileId: String(profileId),
          recommendationId: String(core.recommendationData._id),
        },
      };
      const transactionStart = performance.now();
      const persisted = await persistAdvisoryAtomically({
        profile: profileDocument,
        recommendation: core.recommendationData,
        auditRecord: core.auditRecordData,
        response,
        idempotencyClaim,
      });
      const transactionMs = performance.now() - transactionStart;
      if (candidateLease) await consumeProfileRecommendationCandidate(candidateLease);
      void triggerPlanHealthCheck({ userId: req.user.userId, profileId });

      const timings = core.timings || {};
      const totalMs = performance.now() - totalStart;
      res.setHeader('Server-Timing', [
        `validation;dur=${validationMs.toFixed(2)}`,
        `idempotency;dur=${idempotencyMs.toFixed(2)}`,
        `candidate-lookup;dur=${candidateLookupMs.toFixed(2)}`,
        `candidate-validation;dur=${candidateValidationMs.toFixed(2)}`,
        `ml;dur=${Number(candidateHit ? 0 : timings.ml || 0).toFixed(2)}`,
        `market-context;dur=${Number(candidateHit ? candidateLookupMs : timings.marketContext || 0).toFixed(2)}`,
        `pipeline;dur=${Number(candidateHit ? 0 : timings.pipeline || 0).toFixed(2)}`,
        `projection;dur=${Number(candidateHit ? 0 : timings.projection || 0).toFixed(2)}`,
        `transaction;dur=${transactionMs.toFixed(2)}`,
        `total;dur=${totalMs.toFixed(2)}`,
      ].join(', '));
      return res.status(200).json(persisted);
    } catch (error) {
      if (candidateLease && error?.code === 11000
          && (error.keyPattern?.profileCompletionCandidateId
            || error.keyValue?.profileCompletionCandidateId)) {
        await releaseProfileCandidateCommit(candidateLease).catch(() => {});
        candidateLease = null;
        await releaseAdvisoryIdempotency(idempotencyClaim).catch(() => {});
        throw createError(
          409,
          'This precomputed candidate has already been committed.',
          'Please precompute the profile again before completing it.',
          { code: 'PROFILE_CANDIDATE_ALREADY_COMMITTED' },
        );
      }
      if (candidateLease) await releaseProfileCandidateCommit(candidateLease).catch(() => {});
      await releaseAdvisoryIdempotency(idempotencyClaim).catch(() => {});
      throw error;
    }
  }),
);

router.get('/current', verifyJWT, asyncHandler(async (req, res) => {
  const profile = await FinancialProfile.findOne({ userId: req.user.userId })
    .sort({ createdAt: -1 })
    .lean();
  if (!profile) {
    throw createError(404, 'Financial profile not found', 'Financial profile not found.');
  }
  res.json(formatProfileResponse(profile));
}));

router.get('/:profileId/health-score', verifyJWT, asyncHandler(async (req, res) => {
  const profile = await FinancialProfile.findOne({ _id: req.params.profileId, userId: req.user.userId }).lean();
  if (!profile) throw createError(404, 'Profile not found or access denied', 'Financial profile not found.');
  let instruments = [];
  try {
    const state = await requireFreshRecommendationState({ userId: req.user.userId, profileId: profile._id, profile });
    instruments = state.currentAllocation?.instruments || [];
  } catch (error) {
    if (error.code !== 'RECOMMENDATION_REQUIRED') {
      throw createError(error.status || 409, error.message, 'Regenerate recommendations before calculating financial health.', {
        code: error.code || 'RECOMMENDATION_STALE', reasonCodes: error.reasonCodes, freshness: error.freshness,
      });
    }
  }
  res.json(calculateFinancialHealthScore(profile, instruments));
}));

router.post(
  '/build',
  verifyJWT,
  idempotency(),
  validateStrict(financialProfileSchema),
  asyncHandler(async (req, res) => {
    if (process.env.DISABLE_RATE_LIMIT !== 'true' && !(await checkProfileRateLimit(req.user.userId))) {
      throw createError(429, 'Profile creation rate limit exceeded', `Maximum ${PROFILE_RATE_LIMIT} profile submissions per hour.`);
    }

    const canonical = buildRecommendationProfile(req.body);
    const suitability = assessSuitabilityRisk(canonical);
    const profile = await FinancialProfile.create({
      userId: req.user.userId,
      ...toProfilePersistence(canonical, suitability),
    });

    res.status(201).json(formatProfileResponse(profile));
    void triggerPlanHealthCheck({ userId: req.user.userId, profileId: profile._id });
  }),
);

router.put(
  '/:profileId',
  verifyJWT,
  validateStrict(financialProfileUpdateSchema),
  asyncHandler(async (req, res) => {
    // TODO: Follow-up — make profile edits and recommendation refresh atomic;
    // this endpoint intentionally preserves the existing two-step edit flow.
    const expectedVersion = req.body.version;
    const existing = await FinancialProfile.findOne({
      _id: req.params.profileId,
      userId: req.user.userId,
    }).lean();
    if (!existing) throw createError(404, 'Profile not found or access denied', 'Profile not found.');

    const currentVersion = existing.version ?? 1;
    if (currentVersion !== expectedVersion) {
      return sendError(req, res, 409, 'Version conflict', 'PROFILE_VERSION_CONFLICT', {
        currentVersion,
        expectedVersion,
      });
    }

    const canonical = buildRecommendationProfile(req.body);
    const suitability = assessSuitabilityRisk(canonical);
    const updated = await FinancialProfile.findOneAndUpdate(
      { _id: req.params.profileId, userId: req.user.userId, version: expectedVersion },
      { $set: toProfilePersistence(canonical, suitability), $inc: { version: 1, financialStateFence: 1 } },
      { new: true, runValidators: true },
    );
    if (!updated) {
      return sendError(req, res, 409, 'Version conflict', 'PROFILE_VERSION_CONFLICT');
    }

    void triggerPlanHealthCheck({ userId: req.user.userId, profileId: updated._id });
    res.json(formatProfileResponse(updated));
  }),
);

export default router;
