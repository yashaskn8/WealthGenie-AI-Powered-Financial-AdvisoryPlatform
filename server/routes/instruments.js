import { Router } from 'express';
import { asyncHandler, sendError } from '../middleware/errorHandler.js';
import { verifyJWT } from '../middleware/authMiddleware.js';
import { rankWtiProfileSchema, validateStrict } from '../validation/financialSchemas.js';
import { instrumentListQuerySchema, validateQuery } from '../validation/schemas.js';
import Instrument from '../models/Instrument.js';
import FinancialProfile from '../models/FinancialProfile.js';
import { getCache, setCache } from '../config/redis.js';
import { serializeCachedInstrumentPage, serializeInstrumentPage } from '../services/instrumentDto.js';
import { rankWtiAgainstCurrentState } from '../services/currentWtiRanking.js';

const router = Router();

// Allowed sort fields to prevent injection via sort parameter
const ALLOWED_SORT_FIELDS = new Set(['name', 'interestRate', 'returns1yr', 'returns3yr', 'returns5yr', 'riskLevel', 'aumCr', 'expenseRatio']);

/**
 * GET /api/instruments [Public]
 * List instruments with filtering, sorting, and pagination.
 */
router.get('/', validateQuery(instrumentListQuerySchema), asyncHandler(async (req, res) => {
  const { type, sort, order, limit, page } = req.query;

  const cacheKey = `instruments:public-v2:${type || 'all'}:${sort || 'name'}:${order || 'asc'}:${page || 1}:${limit || 20}`;

  // Check Redis cache
  const cached = await getCache(cacheKey);
  const cachedPage = serializeCachedInstrumentPage(cached);
  if (cachedPage) return res.json(cachedPage);

  // Build query
  const query = {};
  if (type) query.type = type;

  // Validate sort field to prevent NoSQL injection
  const sortField = (sort === 'rate' ? 'interestRate' : sort) || 'name';
  const safeSortField = ALLOWED_SORT_FIELDS.has(sortField) ? sortField : 'name';
  const sortOrder = order === 'desc' ? -1 : 1;

  // Pagination with bounds
  const pageSize = limit === undefined ? 20 : Number(limit);
  const pageNum = page === undefined ? 1 : Number(page);
  const skip = (pageNum - 1) * pageSize;

  const [instruments, total] = await Promise.all([
    Instrument.find(query).sort({ [safeSortField]: sortOrder }).skip(skip).limit(pageSize).lean(),
    Instrument.countDocuments(query),
  ]);

  const result = serializeInstrumentPage({ instruments, total, page: pageNum, pageSize });

  // Cache for 24 hours
  await setCache(cacheKey, result, 86400);

  res.json(result);
}));

/**
 * POST /api/instruments/rank-wti [Protected]
 * Returns a suitability-filtered, source-qualified product comparison. Phase 2
 * supports exact AMFI mutual-fund categories and fails closed for other classes.
 */
router.post('/rank-wti', verifyJWT, validateStrict(rankWtiProfileSchema), asyncHandler(async (req, res) => {
  const {
    profileId,
    profileVersion,
    recommendationId,
    expectedAllocationRevision,
    expectedAllocationRevisionId,
    expectedPortfolioFingerprint,
    expectedRecommendationFingerprint,
    parentInstrumentId,
    taxCalculationContext,
  } = req.body;
  const profile = await FinancialProfile.findOne({ _id: profileId, userId: req.user.userId }).lean();
  if (!profile) {
    return sendError(req, res, 404, 'Profile not found or access denied', 'PROFILE_NOT_FOUND');
  }

  const requestedBinding = {
    profileId: String(profileId),
    profileVersion: Number(profileVersion),
    recommendationId: String(recommendationId),
    allocationRevision: Number(expectedAllocationRevision),
    allocationRevisionId: String(expectedAllocationRevisionId),
    portfolioFingerprint: expectedPortfolioFingerprint,
    recommendationFingerprint: expectedRecommendationFingerprint,
  };
  let result;
  try {
    result = await rankWtiAgainstCurrentState({
      userId: req.user.userId,
      profileId,
      parentInstrumentId,
      expectedBinding: requestedBinding,
      taxCalculationContext,
    });
  } catch (error) {
    if (['FINANCIAL_STATE_CHANGED', 'RECOMMENDATION_PARENT_MISMATCH'].includes(error?.code)) {
      return sendError(req, res, error.status || 409, error.clientMessage || error.message, error.code);
    }
    throw error;
  }

  res.json({
    success: true,
    financialStateBinding: result.financialStateBinding,
    total: result.ranked.length,
    products: result.ranked,
    excluded: result.ranked.metadata?.excluded || [],
    suitability: result.ranked.metadata?.riskReconciliation || null,
    catalog: result.ranked.metadata?.catalog || null,
    ranking: result.ranked.metadata?.ranking || null,
    comparisonUniverse: result.ranked.metadata?.comparisonUniverse || null,
  });
}));

export default router;
