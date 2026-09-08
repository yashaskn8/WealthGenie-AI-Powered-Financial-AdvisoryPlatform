import express from 'express';
import { verifyJWT } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';
import {
  buildRecommendationProfile,
  buildRecommendationProfileHash,
} from '../services/recommendationProfile.js';
import { getLiveMarketContext } from '../services/marketContextService.js';
import { applyProfileSafeMarketContextAdjustment } from '../services/regimeRotationEngine.js';
import {
  validate, validateQuery, regimeAdjustSchema, marketContextQuerySchema,
} from '../validation/schemas.js';

const router = express.Router();

// GET /api/regime/current — verified, source-backed market context only.
// Query overrides are deliberately rejected: clients cannot select a regime.
router.get('/current', validateQuery(marketContextQuerySchema), asyncHandler(async (_req, res) => {
  const current = await getLiveMarketContext();
  res.json(current);
}));

// POST /api/regime/adjust — bounded preview over the latest server-owned
// recommendation. Client-supplied weights and context overrides are forbidden.
router.post('/adjust', verifyJWT, validate(regimeAdjustSchema), asyncHandler(async (req, res) => {
  const { profileId } = req.body;
  const profileDocument = await FinancialProfile.findOne({
    _id: profileId,
    userId: req.user.userId,
  }).lean();
  if (!profileDocument) {
    throw createError(404, 'Profile not found or access denied', 'Financial profile not found.');
  }
  const recommendation = await Recommendation.findOne({
    profileId,
    userId: req.user.userId,
  }).sort({ generatedAt: -1 }).lean();
  if (!recommendation?.instruments?.length) {
    throw createError(404, 'No authoritative recommendation found', 'Generate a recommendation before previewing a market-context adjustment.');
  }
  const profile = buildRecommendationProfile(profileDocument);
  const expectedProfileHash = buildRecommendationProfileHash(profile, {
    modelVersion: recommendation.modelVersion,
  });
  if (recommendation.profileInputHash !== expectedProfileHash) {
    throw createError(
      409,
      'Recommendation was generated from an older profile state.',
      'Regenerate recommendations before previewing a market-context adjustment.',
      { code: 'STALE_RECOMMENDATION_PROFILE' },
    );
  }
  const marketContext = await getLiveMarketContext();
  const result = applyProfileSafeMarketContextAdjustment({
    profile,
    instruments: recommendation.instruments,
    marketContext,
  });
  res.json({
    ...result,
    marketContext,
    recommendationId: String(recommendation._id),
    profileId: String(profileDocument._id),
    persisted: false,
  });
}));

export default router;
