import { Router } from 'express';
import { verifyJWT } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { personalizedMonteCarloSchema, validateStrict } from '../validation/financialSchemas.js';
import { runMonteCarloWithGoal, getInstrumentVolatility } from '../services/monteCarloEngine.js';
import { getLiveInstrumentParams } from '../services/marketDataService.js';
import {
  buildRecommendationProfile,
  buildProfileGroundedSimulation,
  buildRecommendationProfileHash,
} from '../services/recommendationProfile.js';
import { assertPortfolioSuitable } from '../services/RecommendationPipeline.js';
import FinancialProfile from '../models/FinancialProfile.js';
import { getCache, setCache } from '../config/redis.js';

const router = Router();
const MONTE_CARLO_INFLATION_ASSUMPTION = 0.05;
const MONTE_CARLO_SIMULATIONS = 10000;

router.post('/montecarlo', verifyJWT, validateStrict(personalizedMonteCarloSchema), asyncHandler(async (req, res) => {
  const { instrument, monthly_investment, years, target_amount, profileId } = req.body;
  const stored = await FinancialProfile.findOne({ _id: profileId, userId: req.user.userId }).lean();
  if (!stored) throw createError(404, 'Profile not found or access denied', 'Profile not found.');
  const profile = buildRecommendationProfile(stored);
  const simulation = buildProfileGroundedSimulation(profile, {
    monthlyInvestment: monthly_investment,
    years,
  });
  const suitability = assertPortfolioSuitable(profile, [instrument]);

  const liveResult = await getLiveInstrumentParams();
  const liveParams = liveResult.params[instrument] || getInstrumentVolatility(instrument);
  if (!liveParams || !Number.isFinite(liveParams.mean) || !Number.isFinite(liveParams.stdDev)) {
    throw createError(422, `No simulation parameters for ${instrument}`, 'Simulation data is unavailable for this instrument.');
  }
  const annualReturn = liveParams.mean;
  const annualVolatility = liveParams.stdDev;
  const profileHash = buildRecommendationProfileHash(profile, { modelVersion: 'monte-carlo-2.0.0' });
  const targetKey = target_amount === undefined ? 'none' : String(Math.round(target_amount));
  const cacheKey = [
    'mc-v2', req.user.userId, profileId, profileHash, instrument, years,
    simulation.monthlyContribution, simulation.initialCapital, targetKey,
    annualReturn.toFixed(6), annualVolatility.toFixed(6),
    MONTE_CARLO_INFLATION_ASSUMPTION, MONTE_CARLO_SIMULATIONS,
  ].join(':');
  const cached = await getCache(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  const result = runMonteCarloWithGoal({
    monthlyInvestment: simulation.monthlyContribution,
    annualExpectedReturn: annualReturn,
    annualVolatility,
    years: simulation.years,
    simulations: MONTE_CARLO_SIMULATIONS,
    inflationRate: MONTE_CARLO_INFLATION_ASSUMPTION,
    targetAmount: target_amount ?? null,
    currentSavings: simulation.initialCapital,
  });
  const chartData = result.years_array.map((year, index) => ({
    year,
    p10: result.p10[index], p25: result.p25[index], p50: result.p50[index],
    p75: result.p75[index], p90: result.p90[index], mean: result.mean[index],
    p10_real: result.p10_real?.[index], p50_real: result.p50_real?.[index],
    p90_real: result.p90_real?.[index], standard_error: result.standard_error?.[index],
  }));
  const terminalIndex = result.p50.length - 1;
  const confidenceIntervalWidth = terminalIndex >= 0 && result.p50[terminalIndex] > 0
    ? Number(((result.p75[terminalIndex] - result.p25[terminalIndex]) / result.p50[terminalIndex]).toFixed(3))
    : null;
  const response = {
    instrument,
    years: simulation.years,
    monthly_investment: simulation.monthlyContribution,
    initial_capital: simulation.initialCapital,
    simulation_classification: simulation.classification,
    return_basis: 'PRE_TAX_NOMINAL',
    chartData,
    goal_probability: result.goal_probability,
    target_amount: result.target_amount,
    simulations_run: result.simulations_run,
    variance_reduction: result.variance_reduction,
    percentile_summary: {
      p10: result.p10[terminalIndex], p25: result.p25[terminalIndex], p50: result.p50[terminalIndex],
      p75: result.p75[terminalIndex], p90: result.p90[terminalIndex],
    },
    percentile_summary_real: result.p50_real ? {
      p10: result.p10_real[terminalIndex], p25: result.p25_real[terminalIndex],
      p50: result.p50_real[terminalIndex], p75: result.p75_real[terminalIndex],
      p90: result.p90_real[terminalIndex],
    } : null,
    confidence_interval_width: confidenceIntervalWidth,
    data_source: liveParams.source || 'static-catalog',
    nominal_rate_used: annualReturn,
    volatility_used: annualVolatility,
    sequence_of_returns_risk: result.sequence_of_returns_risk || null,
    sharpe_ratio_sensitivity: result.sharpe_ratio_sensitivity || null,
    inflation_rate: result.inflation_rate,
    assumptions: {
      inflation_rate: MONTE_CARLO_INFLATION_ASSUMPTION,
      simulations: MONTE_CARLO_SIMULATIONS,
      initial_capital_source: 'declared_lump_sum_only',
    },
    final_suitability_risk: suitability.finalRisk,
    suitability_reason_codes: suitability.reasonCodes,
    cached: false,
  };
  await setCache(cacheKey, response, 1800);
  return res.json(response);
}));

export default router;
