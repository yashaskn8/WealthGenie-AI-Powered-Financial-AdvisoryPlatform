import { Router } from 'express';
import { verifyJWT, isValidObjectId } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { customGoalSchema, customGoalUpdateSchema, validateStrict } from '../validation/financialSchemas.js';
import Goal from '../models/Goal.js';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';
import { reverseSIP, runMonteCarloWithGoal, getInstrumentVolatility } from '../services/monteCarloEngine.js';
import { buildCovarianceMatrix, portfolioReturn, portfolioVol } from '../services/portfolioEngine.js';
import { getGoalAdvisory } from '../services/geminiService.js';
import {
  buildRecommendationProfile,
  buildLlmFinancialContext,
} from '../services/recommendationProfile.js';
import { assessSuitabilityRisk } from '../services/riskProfiler.js';
import { idempotency } from '../middleware/idempotency.js';

const router = Router();
const GOAL_INFLATION_ASSUMPTION = 0.05;

const staleAdvicePatterns = ['temporarily unavailable', 'could not process', 'api key not configured'];

function isStaleAdvice(advice) {
  if (!advice || typeof advice !== 'string') return true;
  return staleAdvicePatterns.some(pattern => advice.toLowerCase().includes(pattern));
}

function determineGoalStatus(probability, gap, monthlyCapacity) {
  if (probability >= 0.65 && gap <= 0) return 'on_track';
  if (probability >= 0.35 || gap <= monthlyCapacity * 0.25) return 'at_risk';
  return 'off_track';
}

async function findOwnedProfile(profileId, userId) {
  if (!isValidObjectId(profileId)) return null;
  return FinancialProfile.findOne({ _id: profileId, userId }).lean();
}

function computeYearsRemaining(targetDate) {
  const date = new Date(targetDate);
  const now = new Date();
  const sixMonthsFromNow = new Date(now);
  sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
  const fiftyYearsFromNow = new Date(now);
  fiftyYearsFromNow.setFullYear(fiftyYearsFromNow.getFullYear() + 50);
  if (!Number.isFinite(date.getTime()) || date < sixMonthsFromNow || date > fiftyYearsFromNow) {
    throw createError(400, 'Goal target date must be between 6 months and 50 years from today.', 'Invalid target date.');
  }
  return Math.floor(((date - now) / (365.25 * 24 * 60 * 60 * 1000)) * 4) / 4;
}

function toDecimalRate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError('Recommendation return must be finite');
  return Math.abs(number) > 1 ? number / 100 : number;
}

/** Uses only the persisted authoritative recommendation for this exact profile. */
export async function _getBlendedPortfolioMetrics(userId, profileId, _unused = undefined, overrideRec = null) {
  const recommendation = overrideRec || await Recommendation.findOne({ userId, profileId }).sort({ generatedAt: -1 }).lean();
  const instruments = recommendation?.instruments?.filter(instrument =>
    instrument.type && Number(instrument.allocationWeight) > 0 && Number.isFinite(Number(instrument.nominalReturn))
  );
  if (!instruments?.length) {
    const error = new Error('Generate an authoritative recommendation before creating or recalculating goals.');
    error.status = 409;
    error.code = 'RECOMMENDATION_REQUIRED';
    throw error;
  }
  const totalWeight = instruments.reduce((sum, instrument) => sum + Number(instrument.allocationWeight), 0);
  if (!(totalWeight > 0)) throw new TypeError('Persisted recommendation has invalid allocation weights');
  const weights = instruments.map(instrument => Number(instrument.allocationWeight) / totalWeight);
  const returns = instruments.map(instrument => toDecimalRate(instrument.nominalReturn));
  const assetKeys = instruments.map(instrument => instrument.type);
  const expectedReturn = Number(portfolioReturn(weights, returns).toFixed(4));
  let volatility;
  try {
    volatility = Number(portfolioVol(buildCovarianceMatrix(assetKeys).matrix, weights).toFixed(4));
  } catch {
    const componentVolatilities = assetKeys.map(key => {
      const parameters = getInstrumentVolatility(key);
      if (!parameters) throw new TypeError(`No volatility parameters for ${key}`);
      return parameters.stdDev;
    });
    volatility = Math.sqrt(componentVolatilities.reduce(
      (sum, component, index) => sum + (weights[index] * component) ** 2,
      0,
    ));
  }
  return {
    expectedReturn,
    volatility,
    primaryInstrument: instruments[0].type,
    returnBasis: 'PRE_TAX_NOMINAL',
  };
}

function validateMonteCarlo(result) {
  if (!Number.isFinite(result.goal_probability) || result.goal_probability < 0 || result.goal_probability > 1) {
    throw new Error('Monte Carlo engine returned an invalid goal probability');
  }
  const lastIndex = result.p50.length - 1;
  if (lastIndex < 0 || result.p10[lastIndex] > result.p90[lastIndex]) {
    throw new Error('Monte Carlo engine returned invalid percentile bands');
  }
  return lastIndex;
}

function chartData(result) {
  return result.years_array.map((year, index) => ({
    year,
    p10: result.p10[index], p25: result.p25[index], p50: result.p50[index],
    p75: result.p75[index], p90: result.p90[index],
  }));
}

async function generateGoalAdvice(goal, profile) {
  const suitability = assessSuitabilityRisk(profile);
  const context = buildLlmFinancialContext(profile, suitability);
  const yearsRemaining = computeYearsRemaining(goal.target_date);
  const prompt = `Custom planning goal "${goal.goal_name}" targets ₹${Number(goal.target_amount).toLocaleString('en-IN')} in ${yearsRemaining} years. The computed monthly SIP is ₹${Number(goal.recommended_sip).toLocaleString('en-IN')} against a Financial Profile savings capacity of ₹${profile.monthlySavings.toLocaleString('en-IN')}. Goal status is ${String(goal.status).replace(/_/g, ' ')}. Suggest one adjustment without treating the custom goal name as a Financial Profile input.`;
  try {
    return await getGoalAdvisory(prompt, context);
  } catch {
    return `Review the target date or target amount because the required ₹${Number(goal.recommended_sip).toLocaleString('en-IN')} monthly SIP must stay within your ₹${profile.monthlySavings.toLocaleString('en-IN')} savings capacity.`;
  }
}

export async function persistGoalAtomically(goalData, _profileId, { testHooks = {} } = {}) {
  await Goal.init();
  const goal = await Goal.create(goalData);
  await testHooks.afterGoalCreate?.(null, goal);
  return goal;
}

async function calculateGoalPlan({ profile, profileId, userId, targetAmount, targetDate, currentSavings }) {
  const yearsRemaining = computeYearsRemaining(targetDate);
  const metrics = await _getBlendedPortfolioMetrics(userId, profileId);
  const inflationAdjustedTarget = Math.round(targetAmount * (1 + GOAL_INFLATION_ASSUMPTION) ** yearsRemaining);
  const rawSip = reverseSIP(inflationAdjustedTarget, metrics.expectedReturn, yearsRemaining, currentSavings);
  if (!Number.isFinite(rawSip)) throw new Error('Unable to calculate required SIP');
  const requiredSip = Math.max(0, Math.round(rawSip));
  const result = runMonteCarloWithGoal({
    monthlyInvestment: requiredSip,
    annualExpectedReturn: metrics.expectedReturn,
    annualVolatility: metrics.volatility,
    years: yearsRemaining,
    simulations: 5000,
    inflationRate: GOAL_INFLATION_ASSUMPTION,
    targetAmount: inflationAdjustedTarget,
    currentSavings,
  });
  const lastIndex = validateMonteCarlo(result);
  const gap = Math.max(0, requiredSip - profile.monthlySavings);
  return {
    yearsRemaining,
    metrics,
    inflationAdjustedTarget,
    requiredSip,
    result,
    lastIndex,
    gap,
    status: determineGoalStatus(result.goal_probability, gap, profile.monthlySavings),
  };
}

router.post('/create', verifyJWT, idempotency(), validateStrict(customGoalSchema), asyncHandler(async (req, res) => {
  const { goal_name, target_amount, target_date, current_savings, profileId, priority } = req.body;
  const stored = await findOwnedProfile(profileId, req.user.userId);
  if (!stored) throw createError(404, 'Profile not found or access denied', 'Build a financial profile first.');
  const profile = buildRecommendationProfile(stored);

  const duplicate = await Goal.exists({
    userId: req.user.userId,
    goal_name: { $regex: new RegExp(`^${goal_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
  });
  if (duplicate) throw createError(409, `Duplicate goal name: ${goal_name}`, 'A goal with this name already exists.');

  const plan = await calculateGoalPlan({
    profile, profileId, userId: req.user.userId, targetAmount: target_amount,
    targetDate: target_date, currentSavings: current_savings,
  });
  const data = {
    userId: req.user.userId,
    profileId,
    goal_name,
    target_amount,
    inflation_adjusted_target: plan.inflationAdjustedTarget,
    target_date: new Date(target_date),
    current_savings,
    recommended_sip: plan.requiredSip,
    recommended_instrument: plan.metrics.primaryInstrument,
    probability_of_success: plan.result.goal_probability,
    gap_amount: plan.gap,
    status: plan.status,
    priority,
    monte_carlo_summary: {
      p10: plan.result.p10[plan.lastIndex], p25: plan.result.p25[plan.lastIndex],
      p50: plan.result.p50[plan.lastIndex], p75: plan.result.p75[plan.lastIndex],
      p90: plan.result.p90[plan.lastIndex], simulations_run: plan.result.simulations_run,
    },
    chart_data: chartData(plan.result),
    mc_computed_at: new Date(),
    years_remaining: plan.yearsRemaining,
    simulation_classification: 'NON_RECOMMENDATION_GOAL_WHAT_IF',
    return_basis: plan.metrics.returnBasis,
    inflation_assumption: GOAL_INFLATION_ASSUMPTION,
  };
  data.gemini_advice = await generateGoalAdvice(data, profile);
  let goal;
  try {
    goal = await persistGoalAtomically(data, profileId);
  } catch (error) {
    if (error.code === 11000) throw createError(409, `Duplicate goal name: ${goal_name}`, 'A goal with this name already exists.');
    throw error;
  }
  res.status(201).json({ goal: { ...goal.toObject(), goalId: goal._id, chartData: data.chart_data } });
}));

router.get('/', verifyJWT, asyncHandler(async (req, res) => {
  const goals = await Goal.find({ userId: req.user.userId }).sort({ target_date: 1 });
  for (const goal of goals.filter(item => isStaleAdvice(item.gemini_advice))) {
    try {
      const stored = await findOwnedProfile(goal.profileId, req.user.userId);
      if (!stored) continue;
      const profile = buildRecommendationProfile(stored);
      const advice = await generateGoalAdvice(goal, profile);
      if (!isStaleAdvice(advice)) {
        goal.gemini_advice = advice;
        await goal.save();
      }
    } catch (error) {
      console.warn('[Goals] Advice regeneration failed:', error.message);
    }
  }
  res.json({ goals: goals.map(goal => ({ ...goal.toObject(), chartData: goal.chart_data })) });
}));

router.patch('/:goalId/refresh-advice', verifyJWT, asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.goalId)) throw createError(400, 'Invalid goalId', 'Invalid goal ID.');
  const goal = await Goal.findOne({ _id: req.params.goalId, userId: req.user.userId });
  if (!goal) throw createError(404, 'Goal not found', 'Goal not found.');
  const stored = await findOwnedProfile(goal.profileId, req.user.userId);
  if (!stored) throw createError(409, 'The goal profile is unavailable.', 'Financial profile unavailable.');
  const profile = buildRecommendationProfile(stored);
  goal.gemini_advice = await generateGoalAdvice(goal, profile);
  await goal.save();
  res.json({ goalId: goal._id, gemini_advice: goal.gemini_advice });
}));

router.patch('/:goalId', verifyJWT, validateStrict(customGoalUpdateSchema), asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.goalId)) throw createError(400, 'Invalid goalId', 'Invalid goal ID.');
  const goal = await Goal.findOne({ _id: req.params.goalId, userId: req.user.userId });
  if (!goal) throw createError(404, 'Goal not found', 'Goal not found.');
  const stored = await findOwnedProfile(goal.profileId, req.user.userId);
  if (!stored) throw createError(409, 'The goal profile is unavailable.', 'Financial profile unavailable.');
  const profile = buildRecommendationProfile(stored);
  if (req.body.priority !== undefined) goal.priority = req.body.priority;
  if (req.body.target_amount !== undefined) goal.target_amount = req.body.target_amount;
  if (req.body.current_savings !== undefined) goal.current_savings = req.body.current_savings;

  if (req.body.target_amount !== undefined || req.body.current_savings !== undefined) {
    const plan = await calculateGoalPlan({
      profile, profileId: goal.profileId, userId: req.user.userId,
      targetAmount: goal.target_amount, targetDate: goal.target_date,
      currentSavings: goal.current_savings,
    });
    goal.inflation_adjusted_target = plan.inflationAdjustedTarget;
    goal.recommended_sip = plan.requiredSip;
    goal.recommended_instrument = plan.metrics.primaryInstrument;
    goal.probability_of_success = plan.result.goal_probability;
    goal.gap_amount = plan.gap;
    goal.status = plan.status;
    goal.monte_carlo_summary = {
      p10: plan.result.p10[plan.lastIndex], p25: plan.result.p25[plan.lastIndex],
      p50: plan.result.p50[plan.lastIndex], p75: plan.result.p75[plan.lastIndex],
      p90: plan.result.p90[plan.lastIndex], simulations_run: plan.result.simulations_run,
    };
    goal.chart_data = chartData(plan.result);
    goal.mc_computed_at = new Date();
    goal.years_remaining = plan.yearsRemaining;
    goal.simulation_classification = 'NON_RECOMMENDATION_GOAL_WHAT_IF';
    goal.return_basis = plan.metrics.returnBasis;
    goal.inflation_assumption = GOAL_INFLATION_ASSUMPTION;
    goal.gemini_advice = await generateGoalAdvice(goal, profile);
  }
  await goal.save();
  res.json({ success: true, goal });
}));

router.delete('/:goalId', verifyJWT, asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.goalId)) throw createError(400, 'Invalid goalId', 'Invalid goal ID.');
  const goal = await Goal.findOneAndDelete({ _id: req.params.goalId, userId: req.user.userId });
  if (!goal) throw createError(404, 'Goal not found', 'Goal not found.');
  res.json({ deleted: true, goalId: goal._id });
}));

export default router;
