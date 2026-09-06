import { Router } from 'express';
import { verifyJWT } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  getMarketDataSummary,
  getLiveInstrumentParams,
  fetchIndexStatistics,
  MARKET_PARAMETER_CACHE_KEY,
} from '../services/marketDataService.js';
import { delCache } from '../config/redis.js';

const router = Router();

/**
 * GET /api/market/rates [Public]
 * Returns live market data summary with instrument data source transparency.
 */
router.get('/rates', asyncHandler(async (req, res) => {
  const summary = await getMarketDataSummary();
  const liveParams = await getLiveInstrumentParams();

  // Build instrument_data_sources map for frontend transparency
  const instrument_data_sources = {};
  if (liveParams?.params) {
    for (const [key, val] of Object.entries(liveParams.params)) {
      instrument_data_sources[key] = {
        source: val.source,
        rate: val.mean,
        ...(val.source === 'verified-index-derived'
          ? { based_on: 'Nifty 3-year monthly series with disclosed 0.8 policy factor' }
          : { note: `Frozen catalog assumption: ${(val.mean * 100).toFixed(1)}%` }
        ),
      };
    }
  }

  res.json({
    ...summary,
    instrument_data_sources,
    last_live_refresh: summary.last_refresh,
  });
}));

/**
 * GET /api/market/params [Public]
 * Returns live Monte Carlo instrument parameters.
 */
router.get('/params', asyncHandler(async (req, res) => {
  const result = await getLiveInstrumentParams();
  res.json(result);
}));

/**
 * POST /api/market/refresh [Protected]
 * Invalidates Redis cache for live market data and triggers a background refresh.
 * Returns 202 immediately — does not block on the actual fetch.
 */
router.post('/refresh', verifyJWT, asyncHandler(async (req, res) => {
  // Invalidate cached live data
  await Promise.allSettled([
    delCache('index:stats:^NSEI'),
    delCache('index:stats:^BSESN'),
    delCache(MARKET_PARAMETER_CACHE_KEY),
  ]);

  // Trigger background refresh (non-blocking)
  fetchIndexStatistics('^NSEI').catch((err) => {
    console.warn('[Market] Background Nifty refresh failed:', err.message);
  });
  fetchIndexStatistics('^BSESN').catch((err) => {
    console.warn('[Market] Background Sensex refresh failed:', err.message);
  });

  res.status(202).json({
    status: 'refresh_initiated',
    estimated_completion_ms: 3000,
    message: 'Live data cache invalidated. New data will be fetched in background.',
  });
}));

export default router;
