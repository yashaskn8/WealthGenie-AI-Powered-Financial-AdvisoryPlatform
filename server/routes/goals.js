import { Router } from 'express';
import mongoose from 'mongoose';
import { verifyJWT, isValidObjectId } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { customGoalSchema, customGoalUpdateSchema, goalSimulationSchema, validateStrict } from '../validation/financialSchemas.js';
import Goal from '../models/Goal.js';
import RecommendationState from '../models/RecommendationState.js';
import FinancialProfile from '../models/FinancialProfile.js';
import { reverseSIP, runMonteCarloWithGoal } from '../services/monteCarloEngine.js';
import { buildCovarianceMatrix, portfolioReturn, portfolioVol } from '../services/portfolioEngine.js';
import { getGoalAdvisory } from '../services/geminiService.js';
import {
  buildRecommendationProfile,
  buildRecommendationProfileHash,
  buildLlmFinancialContext,
} from '../services/recommendationProfile.js';
import { assessSuitabilityRisk } from '../services/riskProfiler.js';
import { idempotency } from '../middleware/idempotency.js';
import {
  PROJECTION_ASSUMPTION_DATA_CLASS,
  PROJECTION_ASSUMPTION_SOURCE,
  PROJECTION_ASSUMPTION_VERSION,
} from '../services/instrumentConstants.js';
import { triggerPlanHealthCheck } from '../services/planHealthMonitor.js';
import { assessGoalCalculationFreshness, requireFreshRecommendationState } from '../services/recommendationState.js';

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
  if (!Number.isFinite(number) || number < -100 || number > 100) {
    throw new TypeError('Recommendation nominal return must be a percentage from -100 to 100');
  }
  return number / 100;
}

/** Uses only the persisted authoritative recommendation for this exact profile. */
export async function _getBlendedPortfolioMetrics(userId, profileId, profile = undefined, overrideRec = null) {
  let state = null;
  const recommendation = overrideRec || (state = await requireFreshRecommendationState({ userId, profileId, profile })).currentRecommendationView;
  const instruments = recommendation?.instruments;
  if (!instruments?.length) {
    const error = new Error('Generate an authoritative recommendation before creating or recalculating goals.');
    error.status = 409;
    error.code = 'RECOMMENDATION_REQUIRED';
    throw error;
  }
  if (profile) {
    const expectedProfileHash = buildRecommendationProfileHash(profile, { modelVersion: recommendation.modelVersion });
    if (recommendation.profileInputHash !== expectedProfileHash) {
      const error = new Error('The authoritative recommendation is stale for the current Financial Profile.');
      error.status = 409;
      error.code = 'RECOMMENDATION_STALE';
      throw error;
    }
  }
  if (instruments.some(instrument => (
    !instrument.type || !Number.isFinite(Number(instrument.allocationWeight))
    || Number(instrument.allocationWeight) <= 0 || !Number.isFinite(Number(instrument.nominalReturn))
    || instrument.returnBasis !== 'PRE_TAX_NOMINAL' || instrument.postTaxReturn !== null
  ))) throw new TypeError('Persisted recommendation contains an invalid instrument');
  const totalWeight = instruments.reduce((sum, instrument) => sum + Number(instrument.allocationWeight), 0);
  if (!Number.isFinite(totalWeight) || Math.abs(totalWeight - 1) > 0.001) {
    throw new TypeError('Persisted recommendation allocation weights must total 1');
  }
  const weights = instruments.map(instrument => Number(instrument.allocationWeight));
  const returns = instruments.map(instrument => toDecimalRate(instrument.nominalReturn));
  const assetKeys = instruments.map(instrument => instrument.type);
  const expectedReturn = Number(portfolioReturn(weights, returns).toFixed(4));
  const volatility = Number(portfolioVol(buildCovarianceMatrix(assetKeys).matrix, weights).toFixed(4));
  return {
    expectedReturn,
    volatility,
    primaryInstrument: instruments[0].type,
    returnBasis: 'PRE_TAX_NOMINAL',
    returnDataClass: PROJECTION_ASSUMPTION_DATA_CLASS,
    returnAssumptionVersion: PROJECTION_ASSUMPTION_VERSION,
    returnAssumptionSource: PROJECTION_ASSUMPTION_SOURCE,
    returnAssumptionHash: state?.allocationRevision?.returnAssumptionHash || null,
    recommendationFingerprint: state?.recommendationFingerprint || null,
    state,
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
    return await getGoalAdvisory(prompt, context, {
      goalName: goal.goal_name,
      targetAmount: Number(goal.target_amount),
      yearsRemaining,
      recommendedSip: Number(goal.recommended_sip),
      monthlySavingsCapacity: profile.monthlySavings,
      status: goal.status,
      classification: 'NON_RECOMMENDATION_GOAL_PLAN',
    });
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

function goalStateConflict() {
  return createError(
    409,
    'The financial state changed while the goal calculation was running.',
    'Recalculate the goal before saving it.',
    { code: 'GOAL_SOURCE_STATE_CHANGED' },
  );
}

function plannedStateMatches(current, planned) {
  return Boolean(
    planned?.recommendation?._id
      && current?.recommendation?._id
      && String(planned.recommendation._id) === String(current.recommendation._id)
      && Number(planned.allocationRevision?.revision) === Number(current.allocationRevision?.revision)
      && String(planned.allocationRevision?._id) === String(current.allocationRevision?._id)
      && planned.portfolioFingerprint === current.portfolioFingerprint
      && planned.recommendationFingerprint === current.recommendationFingerprint,
  );
}

async function assertGoalPlanStateCurrent({ userId, profileId, profile, plannedState }) {
  const current = await requireFreshRecommendationState({ userId, profileId, profile });
  if (!plannedStateMatches(current, plannedState)) throw goalStateConflict();
  return current;
}

async function holdGoalSourceState(session, { userId, profileId, state }) {
  const stateId = state?.provenance?.stateId;
  if (!stateId || !state.recommendation?._id || !state.allocationRevision?._id) throw goalStateConflict();
  const result = await RecommendationState.updateOne({
    _id: stateId,
    userId,
    profileId,
    currentRecommendationId: state.recommendation._id,
    currentAllocationRevision: state.allocationRevision.revision,
    currentAllocationRevisionId: state.allocationRevision._id,
    generationRevision: state.recommendation.recommendationGeneration,
    profileInputHash: state.recommendation.profileInputHash,
    portfolioFingerprint: state.portfolioFingerprint,
    returnAssumptionVersion: state.allocationRevision.returnAssumptionVersion,
    returnAssumptionHash: state.allocationRevision.returnAssumptionHash,
    returnAssumptionSource: state.allocationRevision.returnAssumptionSource,
  }, {
    // A no-op write makes the source pointer part of the same transaction as
    // the goal write, so a concurrent state transition causes a write conflict.
    $set: { portfolioFingerprint: state.portfolioFingerprint },
  }).session(session);
  if (result.matchedCount !== 1) throw goalStateConflict();
}

async function persistGoalWithSourceState(goalData, { userId, profileId, sourceState, testHooks = {} } = {}) {
  await Goal.init();
  const session = await mongoose.startSession();
  let created;
  try {
    await session.withTransaction(async () => {
      await holdGoalSourceState(session, { userId, profileId, state: sourceState });
      created = new Goal(goalData);
      await created.save({ session });
      await testHooks.afterGoalCreate?.(session, created);
    });
  } finally {
    await session.endSession();
  }
  return created;
}

async function saveGoalWithSourceState(goal, { userId, profileId, sourceState } = {}) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await holdGoalSourceState(session, { userId, profileId, state: sourceState });
      await goal.save({ session });
    });
  } finally {
    await session.endSession();
  }
  return goal;
}

async function calculateGoalPlan({ profile, profileId, userId, targetAmount, targetDate, currentSavings }) {
  const yearsRemaining = computeYearsRemaining(targetDate);
  const metrics = await _getBlendedPortfolioMetrics(userId, profileId, profile);
  const inflationAdjustedTarget = Math.round(targetAmount * (1 + GOAL_INFLATION_ASSUMPTION) ** yearsRemaining);
  const rawSip = reverseSIP(inflationAdjustedTarget, metrics.expectedReturn, yearsRemaining, currentSavings);
  if (!Number.isFinite(rawSip)) throw new Error('Unable to calculate required SIP');
  const requiredSip = Math.max(0, Math.round(rawSip));
  const simulatedMonthlyContribution = Math.min(requiredSip, profile.monthlySavings);
  const result = runMonteCarloWithGoal({
    monthlyInvestment: simulatedMonthlyContribution,
    annualExpectedReturn: metrics.expectedReturn,
    annualVolatility: metrics.volatility,
    years: yearsRemaining,
    simulations: 5000,
    inflationRate: GOAL_INFLATION_ASSUMPTION,
    targetAmount: inflationAdjustedTarget,
    currentSavings,
  });
  const lastIndex = validateMonteCarlo(result);
  await assertGoalPlanStateCurrent({ userId, profileId, profile, plannedState: metrics.state });
  const gap = Math.max(0, requiredSip - profile.monthlySavings);
  return {
    yearsRemaining,
    metrics,
    inflationAdjustedTarget,
    requiredSip,
    simulatedMonthlyContribution,
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
    simulated_monthly_contribution: plan.simulatedMonthlyContribution,
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
    simulation_classification: 'PROFILE_GROUNDED_GOAL_PLAN',
    return_basis: plan.metrics.returnBasis,
    return_data_class: plan.metrics.returnDataClass,
    return_assumption_version: plan.metrics.returnAssumptionVersion,
    return_assumption_source: plan.metrics.returnAssumptionSource,
    sourceRecommendationId: plan.metrics.state?.recommendation?._id || null,
    sourceAllocationRevision: plan.metrics.state?.allocationRevision?.revision || null,
    sourceProfileInputHash: plan.metrics.state?.recommendation?.profileInputHash || null,
    sourceModelVersion: plan.metrics.state?.recommendation?.modelVersion || null,
    sourceRecommendationPolicyVersion: plan.metrics.state?.recommendation?.recommendationPolicyVersion || null,
    sourceRegulatoryRuleVersion: plan.metrics.state?.recommendation?.regulatoryRuleVersion || null,
    sourceReturnAssumptionVersion: plan.metrics.state?.allocationRevision?.returnAssumptionVersion || plan.metrics.returnAssumptionVersion,
    sourceReturnAssumptionHash: plan.metrics.state?.allocationRevision?.returnAssumptionHash || plan.metrics.returnAssumptionHash,
    sourceReturnAssumptionSource: plan.metrics.state?.allocationRevision?.returnAssumptionSource || plan.metrics.returnAssumptionSource,
    sourceRecommendationFingerprint: plan.metrics.state?.recommendationFingerprint || plan.metrics.recommendationFingerprint,
    sourcePortfolioFingerprint: plan.metrics.state?.portfolioFingerprint || null,
    calculationFreshness: { fresh: true, reasonCodes: [], checkedAt: new Date() },
    observed_market_fact: false,
    provider_forecast: false,
    inflation_assumption: GOAL_INFLATION_ASSUMPTION,
  };
  data.gemini_advice = await generateGoalAdvice(data, profile);
  let goal;
  try {
    const currentState = await assertGoalPlanStateCurrent({
      userId: req.user.userId,
      profileId,
      profile,
      plannedState: plan.metrics.state,
    });
    goal = await persistGoalWithSourceState(data, {
      userId: req.user.userId,
      profileId,
      sourceState: currentState,
    });
  } catch (error) {
    if (error.code === 11000) throw createError(409, `Duplicate goal name: ${goal_name}`, 'A goal with this name already exists.');
    throw error;
  }
  void triggerPlanHealthCheck({ userId: req.user.userId, profileId });
  res.status(201).json({ goal: { ...goal.toObject(), goalId: goal._id, chartData: data.chart_data } });
}));

router.get('/', verifyJWT, asyncHandler(async (req, res) => {
  // GET is deliberately read-only. Advice regeneration is an explicit
  // PATCH so a list request never fans out to LLM providers or writes goals.
  const goals = await Goal.find({ userId: req.user.userId }).sort({ target_date: 1 }).lean();
  const stateByProfile = new Map();
  await Promise.all([...new Set(goals.map(goal => String(goal.profileId)))].map(async profileId => {
    try {
      const state = await requireFreshRecommendationState({ userId: req.user.userId, profileId });
      stateByProfile.set(profileId, state);
    } catch (error) {
      stateByProfile.set(profileId, { error });
    }
  }));
  res.json({ goals: goals.map(goal => {
    const state = stateByProfile.get(String(goal.profileId));
    const freshness = state?.recommendation
      ? assessGoalCalculationFreshness(goal, state)
      : { fresh: false, reasonCodes: state?.error?.reasonCodes || ['SOURCE_MISSING'] };
    return ({
    ...goal,
    chartData: goal.chart_data,
    advice_stale: isStaleAdvice(goal.gemini_advice),
    calculation_freshness: freshness,
  }); }) });
}));

router.post('/:goalId/simulate', verifyJWT, validateStrict(goalSimulationSchema), asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.goalId)) throw createError(400, 'Invalid goalId', 'Invalid goal ID.');
  const goal = await Goal.findOne({ _id: req.params.goalId, userId: req.user.userId }).lean();
  if (!goal) throw createError(404, 'Goal not found', 'Goal not found.');
  const stored = await findOwnedProfile(goal.profileId, req.user.userId);
  if (!stored) throw createError(409, 'The goal profile is unavailable.', 'Financial profile unavailable.');
  const profile = buildRecommendationProfile(stored);
  const monthlyContribution = req.body.monthly_contribution;
  if (monthlyContribution > profile.monthlySavings) {
    throw createError(400, 'Monthly contribution exceeds the Financial Profile savings capacity.', 'Contribution exceeds monthly savings capacity.');
  }
  const yearsRemaining = computeYearsRemaining(goal.target_date);
  const metrics = await _getBlendedPortfolioMetrics(req.user.userId, goal.profileId, profile);
  const result = runMonteCarloWithGoal({
    monthlyInvestment: monthlyContribution,
    annualExpectedReturn: metrics.expectedReturn,
    annualVolatility: metrics.volatility,
    years: yearsRemaining,
    simulations: 5000,
    inflationRate: GOAL_INFLATION_ASSUMPTION,
    targetAmount: goal.inflation_adjusted_target,
    currentSavings: goal.current_savings,
  });
  const lastIndex = validateMonteCarlo(result);
  await assertGoalPlanStateCurrent({
    userId: req.user.userId,
    profileId: goal.profileId,
    profile,
    plannedState: metrics.state,
  });
  const gap = Math.max(0, goal.recommended_sip - monthlyContribution);
  res.json({
    goalId: goal._id,
    monthly_contribution: monthlyContribution,
    probability_of_success: result.goal_probability,
    status: determineGoalStatus(result.goal_probability, gap, profile.monthlySavings),
    gap_amount: gap,
    chartData: chartData(result),
    monte_carlo_summary: {
      p10: result.p10[lastIndex], p25: result.p25[lastIndex], p50: result.p50[lastIndex],
      p75: result.p75[lastIndex], p90: result.p90[lastIndex], simulations_run: result.simulations_run,
    },
    simulation_classification: 'NON_RECOMMENDATION_GOAL_WHAT_IF',
    return_basis: metrics.returnBasis,
    return_data_class: metrics.returnDataClass,
    return_assumption_version: metrics.returnAssumptionVersion,
    return_assumption_source: metrics.returnAssumptionSource,
    observed_market_fact: false,
    provider_forecast: false,
    inflation_assumption: GOAL_INFLATION_ASSUMPTION,
  });
}));

router.patch('/:goalId/refresh-advice', verifyJWT, asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.goalId)) throw createError(400, 'Invalid goalId', 'Invalid goal ID.');
  const goal = await Goal.findOne({ _id: req.params.goalId, userId: req.user.userId });
  if (!goal) throw createError(404, 'Goal not found', 'Goal not found.');
  const stored = await findOwnedProfile(goal.profileId, req.user.userId);
  if (!stored) throw createError(409, 'The goal profile is unavailable.', 'Financial profile unavailable.');
  const profile = buildRecommendationProfile(stored);
  const state = await requireFreshRecommendationState({ userId: req.user.userId, profileId: goal.profileId, profile });
  const existingFreshness = assessGoalCalculationFreshness(goal, state);
  if (!existingFreshness.fresh) {
    throw createError(409, 'Goal calculation is stale for the current financial state.', 'Recalculate the goal before refreshing its advisory.', {
      code: 'GOAL_CALCULATION_STALE', calculationFreshness: existingFreshness,
    });
  }
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

  let recalculationState = null;
  if (req.body.target_amount !== undefined || req.body.current_savings !== undefined) {
    const plan = await calculateGoalPlan({
      profile, profileId: goal.profileId, userId: req.user.userId,
      targetAmount: goal.target_amount, targetDate: goal.target_date,
      currentSavings: goal.current_savings,
    });
    recalculationState = plan.metrics.state;
    goal.inflation_adjusted_target = plan.inflationAdjustedTarget;
    goal.recommended_sip = plan.requiredSip;
    goal.simulated_monthly_contribution = plan.simulatedMonthlyContribution;
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
    goal.simulation_classification = 'PROFILE_GROUNDED_GOAL_PLAN';
    goal.return_basis = plan.metrics.returnBasis;
    goal.return_data_class = plan.metrics.returnDataClass;
    goal.return_assumption_version = plan.metrics.returnAssumptionVersion;
    goal.return_assumption_source = plan.metrics.returnAssumptionSource;
    goal.sourceRecommendationId = plan.metrics.state?.recommendation?._id || null;
    goal.sourceAllocationRevision = plan.metrics.state?.allocationRevision?.revision || null;
    goal.sourceProfileInputHash = plan.metrics.state?.recommendation?.profileInputHash || null;
    goal.sourceModelVersion = plan.metrics.state?.recommendation?.modelVersion || null;
    goal.sourceRecommendationPolicyVersion = plan.metrics.state?.recommendation?.recommendationPolicyVersion || null;
    goal.sourceRegulatoryRuleVersion = plan.metrics.state?.recommendation?.regulatoryRuleVersion || null;
    goal.sourceReturnAssumptionVersion = plan.metrics.state?.allocationRevision?.returnAssumptionVersion || plan.metrics.returnAssumptionVersion;
    goal.sourceReturnAssumptionHash = plan.metrics.state?.allocationRevision?.returnAssumptionHash || plan.metrics.returnAssumptionHash;
    goal.sourceReturnAssumptionSource = plan.metrics.state?.allocationRevision?.returnAssumptionSource || plan.metrics.returnAssumptionSource;
    goal.sourceRecommendationFingerprint = plan.metrics.state?.recommendationFingerprint || plan.metrics.recommendationFingerprint;
    goal.sourcePortfolioFingerprint = plan.metrics.state?.portfolioFingerprint || null;
    goal.calculationFreshness = { fresh: true, reasonCodes: [], checkedAt: new Date() };
    goal.observed_market_fact = false;
    goal.provider_forecast = false;
    goal.inflation_assumption = GOAL_INFLATION_ASSUMPTION;
    goal.gemini_advice = await generateGoalAdvice(goal, profile);
  }
  if (recalculationState) {
    const currentState = await assertGoalPlanStateCurrent({
      userId: req.user.userId,
      profileId: goal.profileId,
      profile,
      plannedState: recalculationState,
    });
    await saveGoalWithSourceState(goal, {
      userId: req.user.userId,
      profileId: goal.profileId,
      sourceState: currentState,
    });
  } else {
    await goal.save();
  }
  void triggerPlanHealthCheck({ userId: req.user.userId, profileId: goal.profileId });
  res.json({ success: true, goal });
}));

router.delete('/:goalId', verifyJWT, asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.goalId)) throw createError(400, 'Invalid goalId', 'Invalid goal ID.');
  const goal = await Goal.findOneAndDelete({ _id: req.params.goalId, userId: req.user.userId });
  if (!goal) throw createError(404, 'Goal not found', 'Goal not found.');
  void triggerPlanHealthCheck({ userId: req.user.userId, profileId: goal.profileId });
  res.json({ deleted: true, goalId: goal._id });
}));

export default router;
