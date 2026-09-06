import { Router } from 'express';
import { verifyJWT } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { personalizedProjectionSchema, validateStrict } from '../validation/financialSchemas.js';
import FinancialProfile from '../models/FinancialProfile.js';
import { generateProjections } from '../services/projectionEngine.js';
import { computeXIRR, computeSIPXIRR } from '../services/xirrCalculator.js';
import { buildRateLookup } from '../services/instrumentConstants.js';
import { buildRecommendationProfile, buildProfileGroundedSimulation } from '../services/recommendationProfile.js';
import { assertPortfolioSuitable } from '../services/RecommendationPipeline.js';

const router = Router();

const RATE_LOOKUP = buildRateLookup();
const PROJECTION_INFLATION_ASSUMPTION = 0.05;
const PERSONALIZED_CONTRIBUTION_STEP_UP = 0;

/**
 * POST /api/projection [Protected]
 * Generate wealth projections for multiple instruments over time.
 */
router.post('/', verifyJWT, validateStrict(personalizedProjectionSchema), asyncHandler(async (req, res) => {
  const { profileId, instruments, monthly_investment, years } = req.body;

  const stored = await FinancialProfile.findOne({ _id: profileId, userId: req.user.userId }).lean();
  if (!stored) {
    throw createError(404, `Profile not found: ${profileId}`, 'Profile not found.');
  }
  const profile = buildRecommendationProfile(stored);
  const projectionYears = years;
  if (projectionYears.some(year => year > profile.investmentHorizonYears)) {
    throw createError(400, 'Projection years cannot exceed the Financial Profile horizon.', 'Projection horizon exceeds profile.');
  }
  const simulation = buildProfileGroundedSimulation(profile, {
    monthlyInvestment: monthly_investment,
    years: Math.max(...projectionYears),
  });
  const suitability = assertPortfolioSuitable(profile, instruments);

  // Use authoritative pre-tax nominal rates. A tax profile is not inferred.
  const instKeys = instruments;
  const instList = instKeys.map(key => {
    const nominalRate = RATE_LOOKUP[key];
    if (nominalRate === undefined) {
      throw createError(400, `Unknown instrument key: ${key}`, 'Unknown instrument.');
    }
    return { name: key, type: key, nominalRate };
  });

  const annualRates = {};
  instList.forEach(i => { annualRates[i.name] = i.nominalRate; });

  const projections = generateProjections(
    simulation.monthlyContribution,
    instList,
    annualRates,
    projectionYears,
    PROJECTION_INFLATION_ASSUMPTION,
    PERSONALIZED_CONTRIBUTION_STEP_UP,
    simulation.initialCapital,
  );

  res.json({
    ...projections,
    simulation_classification: simulation.classification,
    return_basis: 'PRE_TAX_NOMINAL',
    initial_capital: simulation.initialCapital,
    monthly_contribution: simulation.monthlyContribution,
    final_suitability_risk: suitability.finalRisk,
    assumptions: {
      inflation_rate: PROJECTION_INFLATION_ASSUMPTION,
      contribution_step_up_rate: PERSONALIZED_CONTRIBUTION_STEP_UP,
      contribution_step_up_reason: 'No future savings growth is inferred from the Financial Profile.',
    },
  });
}));

/**
 * POST /api/projection/xirr [Protected]
 * Compute XIRR (Extended Internal Rate of Return) for irregular cashflows.
 * Uses Newton-Raphson iteration — the institutional standard for evaluating
 * SIP performance where each installment has a different holding period.
 *
 * Body: { cashflows: [{amount, date}], guess?: number }
 *   OR: { monthlySIP, months, currentValue }  (SIP convenience mode)
 */
router.post('/xirr', verifyJWT, asyncHandler(async (req, res) => {
  const { cashflows, monthlySIP, months, currentValue, guess } = req.body;

  // SIP convenience mode
  if (monthlySIP && months && currentValue) {
    if (!Number.isFinite(monthlySIP) || monthlySIP <= 0) {
      throw createError(400, 'Invalid monthlySIP', 'Monthly SIP must be a positive number.');
    }
    if (!Number.isFinite(months) || months < 1 || months > 1200) {
      throw createError(400, 'Invalid months', 'Months must be between 1 and 1200 (max 100 years).');
    }
    if (!Number.isFinite(currentValue) || currentValue <= 0) {
      throw createError(400, 'Invalid currentValue', 'Current value must be a positive number.');
    }
    const result = computeSIPXIRR(monthlySIP, months, currentValue);
    return res.json({ mode: 'sip', ...result });
  }

  // General XIRR mode
  if (!Array.isArray(cashflows) || cashflows.length < 2) {
    throw createError(400, 'Invalid cashflows', 'Provide at least 2 cashflows with amount and date.');
  }

  if (cashflows.length > 1000) {
    throw createError(400, 'Too many cashflows', 'Maximum 1000 cashflows allowed to prevent server overhead.');
  }

  // Validate each cashflow
  for (const cf of cashflows) {
    if (!Number.isFinite(cf.amount)) {
      throw createError(400, `Invalid cashflow amount: ${cf.amount}`, 'Each cashflow must have a finite amount.');
    }
    if (!cf.date) {
      throw createError(400, 'Missing cashflow date', 'Each cashflow must have a date.');
    }
    const parsedDate = new Date(cf.date);
    if (!Number.isFinite(parsedDate.getTime())) {
      throw createError(400, `Invalid cashflow date: ${cf.date}`, 'Each cashflow must have a valid date.');
    }
  }

  let safeGuess = guess;
  if (guess !== undefined) {
    safeGuess = Number(guess);
    if (!Number.isFinite(safeGuess)) {
      throw createError(400, `Invalid XIRR guess: ${guess}`, 'Guess must be a finite number.');
    }
  }

  const result = computeXIRR(cashflows, safeGuess);
  res.json({ mode: 'general', ...result });
}));

export default router;
