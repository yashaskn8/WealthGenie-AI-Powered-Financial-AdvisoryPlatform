import { Router } from 'express';
import { verifyJWT } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateQuery, marketNavQuerySchema } from '../validation/schemas.js';
import {
  fetchAmfiProductSnapshot,
  fetchAmfiHistoricalNavSnapshot,
  fetchBenchmarkQuotes,
  getLiveInstrumentParams,
  getMarketDataSummary,
  getMutualFundNavsBySchemeCodes,
} from '../services/marketDataService.js';

const router = Router();

/** Public source-health and provenance summary. No assumption is labelled live. */
router.get('/rates', asyncHandler(async (_req, res) => {
  res.json(await getMarketDataSummary());
}));

/** Bounded benchmark snapshot: NIFTY 50 and India VIX only. */
router.get('/benchmarks', asyncHandler(async (_req, res) => {
  res.json(await fetchBenchmarkQuotes());
}));

/**
 * Bounded AMFI lookup. The full official report is fetched at most once per
 * cache window, while the response includes only explicitly requested schemes.
 */
router.get('/mutual-funds/nav', validateQuery(marketNavQuerySchema), asyncHandler(async (req, res) => {
  const schemeCodes = req.query.schemeCodes.split(',');
  res.json(await getMutualFundNavsBySchemeCodes(schemeCodes));
}));

/**
 * Legacy simulation assumptions endpoint. Values are explicitly classified as
 * model assumptions, not live market observations.
 */
router.get('/params', asyncHandler(async (_req, res) => {
  res.json(await getLiveInstrumentParams());
}));

/** Refreshes the two bounded Phase 1 source snapshots without widening scope. */
router.post('/refresh', verifyJWT, asyncHandler(async (_req, res) => {
  Promise.allSettled([
    fetchAmfiProductSnapshot({ forceRefresh: true }),
    fetchAmfiHistoricalNavSnapshot({ forceRefresh: true }),
    fetchBenchmarkQuotes({ forceRefresh: true }),
  ]).catch(() => {});
  res.status(202).json({
    status: 'REFRESH_INITIATED',
    sources: ['AMFI_CURRENT_NAV', 'AMFI_HISTORICAL_NAV', 'UPSTOX'],
    message: 'A bounded refresh was queued. Provider failures remain explicitly unavailable.',
  });
}));

export default router;
