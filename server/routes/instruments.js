import { Router } from 'express';
import { asyncHandler, sendError } from '../middleware/errorHandler.js';
import { verifyJWT } from '../middleware/authMiddleware.js';
import { rankWtiProfileSchema, validateStrict } from '../validation/financialSchemas.js';
import Instrument from '../models/Instrument.js';
import FinancialProfile from '../models/FinancialProfile.js';
import { getCache, setCache } from '../config/redis.js';

const router = Router();

// Allowed sort fields to prevent injection via sort parameter
const ALLOWED_SORT_FIELDS = new Set(['name', 'interestRate', 'returns1yr', 'returns3yr', 'returns5yr', 'riskLevel', 'aumCr', 'expenseRatio']);
const ALLOWED_TYPES = new Set(['FD', 'Mutual_Fund', 'ETF', 'Government', 'ELSS']);

/**
 * GET /api/instruments [Public]
 * List instruments with filtering, sorting, and pagination.
 */
router.get('/', asyncHandler(async (req, res) => {
  const { type, sort, order, limit, page } = req.query;

  // Validate type if provided
  if (type && !ALLOWED_TYPES.has(type)) {
    return sendError(
      req,
      res,
      400,
      `Invalid instrument type. Allowed: ${[...ALLOWED_TYPES].join(', ')}`,
      'INSTRUMENT_TYPE_INVALID',
    );
  }

  const cacheKey = `instruments:${type || 'all'}:${sort || 'name'}:${order || 'asc'}:${page || 1}:${limit || 20}`;

  // Check Redis cache
  const cached = await getCache(cacheKey);
  if (cached) return res.json({ ...cached, fromCache: true });

  // Build query
  const query = {};
  if (type) query.type = type;

  // Validate sort field to prevent NoSQL injection
  const sortField = (sort === 'rate' ? 'interestRate' : sort) || 'name';
  const safeSortField = ALLOWED_SORT_FIELDS.has(sortField) ? sortField : 'name';
  const sortOrder = order === 'desc' ? -1 : 1;

  // Pagination with bounds
  const pageSize = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
  const pageNum = Math.max(parseInt(page) || 1, 1);
  const skip = (pageNum - 1) * pageSize;

  const [instruments, total] = await Promise.all([
    Instrument.find(query).sort({ [safeSortField]: sortOrder }).skip(skip).limit(pageSize).lean(),
    Instrument.countDocuments(query),
  ]);

  const result = {
    instruments,
    total,
    page: pageNum,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };

  // Cache for 24 hours
  await setCache(cacheKey, result, 86400);

  res.json(result);
}));

import { rankWhereToInvestBackend } from '../services/RecommendationPipeline.js';

/**
 * POST /api/instruments/rank-wti [Protected]
 * Dynamically ranks Where To Invest product candidates against user profile & macro regimes.
 * WG-005: Protected with verifyJWT + Joi schema validation.
 */
router.post('/rank-wti', verifyJWT, validateStrict(rankWtiProfileSchema), asyncHandler(async (req, res) => {
  const { profileId, parentInstrumentId, candidates } = req.body;
  const profile = await FinancialProfile.findOne({ _id: profileId, userId: req.user.userId }).lean();
  if (!profile) {
    return sendError(req, res, 404, 'Profile not found or access denied', 'PROFILE_NOT_FOUND');
  }
  const ranked = rankWhereToInvestBackend(candidates, profile, { parentInstrumentId });
  res.json({
    success: true,
    total: ranked.length,
    products: ranked,
    excluded: ranked.metadata?.excluded || [],
    suitability: ranked.metadata?.riskReconciliation || null,
  });
}));

export default router;
