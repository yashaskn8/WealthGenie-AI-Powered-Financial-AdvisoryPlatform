import { Router } from 'express';
import { verifyJWT } from '../middleware/authMiddleware.js';
import { asyncHandler, createError, sendError } from '../middleware/errorHandler.js';
import {
  financialProfileSchema,
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
import { delCache, redisClient, redisAvailable } from '../config/redis.js';
import { idempotency } from '../middleware/idempotency.js';

const router = Router();
const PROFILE_RATE_LIMIT = 10;

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

async function invalidateProfileCaches(userId, profileId) {
  try {
    await delCache(`chat:sysprompt_v4:${userId}:${profileId}`);
    await delCache(`recommend:${userId}:${profileId}`);
  } catch (error) {
    console.warn('[Profile] Cache invalidation failed (non-critical):', error.message);
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
    final_suitability_level: suitability.finalLevel,
    suitability_reason_codes: suitability.reasonCodes,
  };
}

router.get('/current', verifyJWT, asyncHandler(async (req, res) => {
  const profile = await FinancialProfile.findOne({ userId: req.user.userId })
    .sort({ createdAt: -1 })
    .lean();
  if (!profile) {
    throw createError(404, 'Financial profile not found', 'Financial profile not found.');
  }
  res.json(formatProfileResponse(profile));
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

    await invalidateProfileCaches(req.user.userId, profile._id);
    res.status(201).json(formatProfileResponse(profile));
  }),
);

router.put(
  '/:profileId',
  verifyJWT,
  validateStrict(financialProfileUpdateSchema),
  asyncHandler(async (req, res) => {
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
      { $set: toProfilePersistence(canonical, suitability), $inc: { version: 1 } },
      { new: true, runValidators: true },
    );
    if (!updated) {
      return sendError(req, res, 409, 'Version conflict', 'PROFILE_VERSION_CONFLICT');
    }

    await invalidateProfileCaches(req.user.userId, updated._id);
    res.json(formatProfileResponse(updated));
  }),
);

export default router;
