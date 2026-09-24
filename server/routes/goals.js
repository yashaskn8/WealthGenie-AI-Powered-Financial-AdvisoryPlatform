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
import {
  completeMutationIdempotency,
  idempotency,
  resolveCommittedMutationForClaim,
} from '../middleware/idempotency.js';
import {
  PROJECTION_ASSUMPTION_DATA_CLASS,
  PROJECTION_ASSUMPTION_SOURCE,
  PROJECTION_ASSUMPTION_VERSION,
} from '../services/instrumentConstants.js';
import { triggerPlanHealthCheck } from '../services/planHealthMonitor.js';
import {
  assessGoalCalculationFreshness,
  requireFreshRecommendationState,
  resolveCurrentRecommendationState,
} from '../services/recommendationState.js';
import { buildCurrentGoalResponse, buildGoalAdvisoryMetadata } from '../services/goalResponse.js';
import { buildGoalCalculationInputFingerprint, GOAL_CALCULATION_POLICY_VERSION } from '../services/goalCalculationProvenance.js';
import { reachFinancialStateTestHook } from '../services/financialStateTestHooks.js';

const router = Router();
const GOAL_INFLATION_ASSUMPTION = 0.05;

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
export async function _getBlendedPortfolioMetrics(userId, profileId, profile = undefined) {
  const state = await requireFreshRecommendationState({ userId, profileId, profile });
  const recommendation = state.currentRecommendationView;
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
    returnAssumptionHash: state.allocationRevision?.returnAssumptionHash || null,
    recommendationFingerprint: state.recommendationFingerprint || null,
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

function goalVersionConflict(expectedVersion) {
  return createError(
    409,
    'The goal changed while this request was in progress.',
    'This goal was updated elsewhere. Refresh it and retry your change.',
    { code: 'GOAL_VERSION_CONFLICT', details: { expectedVersion } },
  );
}

function goalVersionCondition(version) {
  return version === 1
    ? { $or: [{ version: 1 }, { version: { $exists: false } }] }
    : { version };
}

async function updateGoalWithCAS(goal, { userId, expectedVersion, session = null } = {}) {
  const update = goal.toObject({ depopulate: true, flattenMaps: true });
  delete update._id;
  delete update.__v;
  delete update.version;
  delete update.createdAt;
  delete update.updatedAt;
  delete update.userId;
  delete update.profileId;
  delete update.idempotencyOperationId;
  delete update.idempotencyRequestHash;
  const filter = { _id: goal._id, userId, ...goalVersionCondition(expectedVersion) };
  let query = Goal.findOneAndUpdate(filter, { $set: { ...update, version: expectedVersion + 1 } }, {
    new: true,
    runValidators: true,
    context: 'query',
  });
  if (session) query = query.session(session);
  const updated = await query;
  if (!updated) throw goalVersionConflict(expectedVersion);
  return updated;
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

function committedGoalReconciliationError(goal, cause) {
  const error = createError(
    503,
    'The goal operation committed, but its current response could not be safely reconciled.',
    'Your goal change was saved, but its current status could not be verified. Refresh before continuing.',
    {
      code: 'COMMITTED_BUT_RESPONSE_RECONCILIATION_FAILED',
      details: { operation_committed: true, resource_type: 'Goal', goalId: String(goal._id) },
    },
  );
  error.cause = cause;
  return error;
}

async function resolveGoalResponseAfterCommit(goal, userId) {
  let state;
  try {
    state = await resolveCurrentRecommendationState({
      userId,
      profileId: goal.profileId,
      requireFresh: false,
    });
  } catch (error) {
    throw committedGoalReconciliationError(goal, error);
  }
  if (state.provenance?.status !== 'PERSISTED_REVISION') {
    throw committedGoalReconciliationError(goal, Object.assign(new Error('Canonical recommendation state integrity check failed.'), {
      code: state.provenance?.reasonCode || state.provenance?.status || 'FINANCIAL_STATE_UNVERIFIABLE',
    }));
  }
  return state;
}

async function holdGoalSourceState(session, { userId, profileId, state }) {
  const stateId = state?.provenance?.stateId;
  if (!stateId || !state.recommendation?._id || !state.allocationRevision?._id) throw goalStateConflict();
  if (state.profileVersion !== null && state.profileVersion !== undefined) {
    const profileResult = await FinancialProfile.updateOne({
      _id: profileId,
      userId,
      version: state.profileVersion,
    }, {
      // A real write fence makes overlapping profile edits conflict under
      // Mongo snapshot isolation; a no-op update is not a reliable lock.
      $inc: { financialStateFence: 1 },
    }).session(session);
    if (profileResult.matchedCount !== 1) throw goalStateConflict();
  }
  const result = await RecommendationState.updateOne({
    _id: stateId,
    userId,
    profileId,
    currentRecommendationId: state.recommendation._id,
    currentAllocationRevision: state.allocationRevision.revision,
    currentAllocationRevisionId: state.allocationRevision._id,
    generationRevision: state.recommendation.recommendationGeneration,
    profileInputHash: state.recommendation.profileInputHash,
    profileVersion: state.profileVersion,
    portfolioFingerprint: state.portfolioFingerprint,
    returnAssumptionVersion: state.allocationRevision.returnAssumptionVersion,
    returnAssumptionHash: state.allocationRevision.returnAssumptionHash,
    returnAssumptionSource: state.allocationRevision.returnAssumptionSource,
  }, {
    // A real write fence binds this calculation to the resolved pointer.
    $inc: { financialStateFence: 1 },
  }).session(session);
  if (result.matchedCount !== 1) throw goalStateConflict();
}

async function persistGoalWithSourceState(goalData, { userId, profileId, sourceState, idempotencyClaim = null, testHooks = {} } = {}) {
  const session = await mongoose.startSession();
  let created;
  let transactionCommitted = false;
  try {
    await session.withTransaction(async () => {
      await holdGoalSourceState(session, { userId, profileId, state: sourceState });
      created = new Goal(goalData);
      await created.save({ session });
      await reachFinancialStateTestHook('goal.create.afterInsertBeforeCommit', {
        goalId: String(created._id),
        session,
        transactionActive: session.inTransaction(),
      });
      await testHooks.afterGoalCreate?.(session, created);
      if (idempotencyClaim) {
        await completeMutationIdempotency(session, idempotencyClaim, {
          resourceType: 'Goal', resourceId: created._id, status: 201,
        });
      }
    });
    transactionCommitted = true;
  } finally {
    try {
      await session.endSession();
    } catch (error) {
      if (!transactionCommitted) throw error;
      console.warn('[Goals] Session cleanup failed after committed create.', { error: error.message });
    }
  }
  return created;
}

async function saveGoalWithSourceState(goal, { userId, profileId, sourceState, expectedGoalVersion } = {}) {
  const session = await mongoose.startSession();
  let updatedGoal;
  let transactionCommitted = false;
  try {
    await session.withTransaction(async () => {
      await holdGoalSourceState(session, { userId, profileId, state: sourceState });
      updatedGoal = await updateGoalWithCAS(goal, { userId, expectedVersion: expectedGoalVersion, session });
    });
    transactionCommitted = true;
  } finally {
    try {
      await session.endSession();
    } catch (error) {
      if (!transactionCommitted) throw error;
      console.warn('[Goals] Session cleanup failed after committed update.', { error: error.message });
    }
  }
  return updatedGoal;
}

async function resolveGoalCreateReplay(req, operation) {
  const goal = await Goal.findOne({
    _id: operation.resourceId,
    userId: req.user.userId,
    idempotencyOperationId: operation._id,
    idempotencyRequestHash: operation.requestHash,
  }).lean();
  if (!goal) {
    throw createError(503, 'Committed goal operation has no matching owned goal.', 'Refresh your goals before continuing.', { code: 'IDEMPOTENCY_STATE_CORRUPT' });
  }
  const state = await resolveCurrentRecommendationState({
    userId: req.user.userId,
    profileId: goal.profileId,
    requireFresh: false,
  });
  return { goal: buildCurrentGoalResponse(goal, { state: state.recommendation ? state : null }) };
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
  await reachFinancialStateTestHook('goal.calculation.beforeStateRecheck', { userId, profileId, state: metrics.state });
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

router.post('/create', verifyJWT, validateStrict(customGoalSchema), idempotency({ operation: 'goals.create', resolveReplay: resolveGoalCreateReplay }), asyncHandler(async (req, res) => {
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
    _id: new mongoose.Types.ObjectId(),
    userId: req.user.userId,
    version: 1,
    idempotencyOperationId: req.idempotencyClaim.operationId,
    idempotencyRequestHash: req.idempotencyClaim.requestHash,
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
    sourceAllocationRevisionId: plan.metrics.state?.allocationRevision?._id || null,
    sourceProfileInputHash: plan.metrics.state?.recommendation?.profileInputHash || null,
    sourceProfileVersion: plan.metrics.state?.profileVersion || null,
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
  data.sourceGoalCalculationInputFingerprint = buildGoalCalculationInputFingerprint(data);
  data.sourceGoalCalculationPolicyVersion = GOAL_CALCULATION_POLICY_VERSION;
  if (!data.sourceGoalCalculationInputFingerprint) {
    throw new Error('Could not establish the goal calculation input fingerprint.');
  }
  let goal;
  try {
    const currentState = await assertGoalPlanStateCurrent({
      userId: req.user.userId,
      profileId,
      profile,
      plannedState: plan.metrics.state,
    });
    data.gemini_advice = await generateGoalAdvice(data, profile);
    await reachFinancialStateTestHook('goal.advisory.beforePersistence', {
      userId: req.user.userId, profileId, goalId: data._id, sourceState: currentState,
    });
    data.advisoryMetadata = buildGoalAdvisoryMetadata({ goal: data, state: currentState });
    goal = await persistGoalWithSourceState(data, {
      userId: req.user.userId,
      profileId,
      sourceState: currentState,
      idempotencyClaim: req.idempotencyClaim,
    });
  } catch (error) {
    const committedReplay = await resolveCommittedMutationForClaim(req, req.idempotencyClaim);
    if (committedReplay) {
      req.idempotencyCommitted = true;
      clearInterval(req.idempotencyClaim.heartbeat);
      res.setHeader('X-Cache-Lookup', 'HIT - Idempotent');
      return res.status(committedReplay.status).json(committedReplay.body);
    }
    if (error.code === 11000) throw createError(409, `Duplicate goal name: ${goal_name}`, 'A goal with this name already exists.');
    throw error;
  }
  req.idempotencyCommitted = true;
  clearInterval(req.idempotencyClaim.heartbeat);
  await reachFinancialStateTestHook('goal.create.afterCommitBeforeResponse', {
    userId: String(req.user.userId),
    goalId: String(goal._id),
    operationId: req.idempotencyClaim.operationId,
  });
  void triggerPlanHealthCheck({ userId: req.user.userId, profileId });
  const currentState = await resolveGoalResponseAfterCommit(goal, req.user.userId);
  res.status(201).json({ goal: buildCurrentGoalResponse(goal, { state: currentState }) });
}));

router.get('/', verifyJWT, asyncHandler(async (req, res) => {
  // GET is deliberately read-only. Advice regeneration is an explicit
  // PATCH so a list request never fans out to LLM providers or writes goals.
  const goals = await Goal.find({ userId: req.user.userId }).sort({ target_date: 1 }).lean();
  const stateByProfile = new Map();
  await Promise.all([...new Set(goals.map(goal => String(goal.profileId)))].map(async profileId => {
    try {
      const state = await resolveCurrentRecommendationState({
        userId: req.user.userId,
        profileId,
        requireFresh: false,
      });
      stateByProfile.set(profileId, state);
    } catch (error) {
      stateByProfile.set(profileId, { error });
    }
  }));
  res.json({ goals: goals.map(goal => {
    const state = stateByProfile.get(String(goal.profileId));
    return buildCurrentGoalResponse(goal, { state: state?.recommendation ? state : null });
  }) });
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
  const goalFreshness = assessGoalCalculationFreshness(goal, metrics.state);
  if (!goalFreshness.fresh) {
    throw createError(
      409,
      'Goal calculation is stale for the current financial state.',
      'Recalculate the goal before running this simulation.',
      { code: 'GOAL_CALCULATION_STALE', calculationFreshness: goalFreshness },
    );
  }
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
    allocation_revision: metrics.state.allocationRevision.revision,
    allocation_revision_id: metrics.state.allocationRevision._id,
    portfolio_fingerprint: metrics.state.portfolioFingerprint,
    observed_market_fact: false,
    provider_forecast: false,
    inflation_assumption: GOAL_INFLATION_ASSUMPTION,
  });
}));

router.patch('/:goalId/refresh-advice', verifyJWT, asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.goalId)) throw createError(400, 'Invalid goalId', 'Invalid goal ID.');
  let goal = await Goal.findOne({ _id: req.params.goalId, userId: req.user.userId });
  if (!goal) throw createError(404, 'Goal not found', 'Goal not found.');
  const expectedGoalVersion = Number(goal.version ?? 1);
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
  await reachFinancialStateTestHook('goal.advisory.beforePersistence', {
    userId: req.user.userId, profileId: goal.profileId, goalId: goal._id, sourceState: state,
  });
  goal.version = expectedGoalVersion + 1;
  goal.advisoryMetadata = buildGoalAdvisoryMetadata({ goal, state });
  goal = await saveGoalWithSourceState(goal, {
    userId: req.user.userId,
    profileId: goal.profileId,
    sourceState: state,
    expectedGoalVersion,
  });
  await reachFinancialStateTestHook('goal.advisory.afterCommitBeforeResponse', {
    userId: String(req.user.userId), goalId: String(goal._id), sourceState: state,
  });
  const currentState = await resolveGoalResponseAfterCommit(goal, req.user.userId);
  const currentGoal = buildCurrentGoalResponse(goal, { state: currentState.recommendation ? currentState : null });
  res.json({
    goal: currentGoal,
    goalId: goal._id,
    gemini_advice: currentGoal.gemini_advice,
    operation_result: {
      committed: true,
      goal_version: Number(goal.version),
      response_state: currentGoal.calculation_freshness?.fresh ? 'CURRENT' : 'STALE',
    },
  });
}));

router.patch('/:goalId', verifyJWT, validateStrict(customGoalUpdateSchema), asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.goalId)) throw createError(400, 'Invalid goalId', 'Invalid goal ID.');
  const goal = await Goal.findOne({ _id: req.params.goalId, userId: req.user.userId });
  if (!goal) throw createError(404, 'Goal not found', 'Goal not found.');
  const expectedGoalVersion = req.body.expectedVersion;
  if (Number(goal.version ?? 1) !== expectedGoalVersion) throw goalVersionConflict(expectedGoalVersion);
  const stored = await findOwnedProfile(goal.profileId, req.user.userId);
  if (!stored) throw createError(409, 'The goal profile is unavailable.', 'Financial profile unavailable.');
  const profile = buildRecommendationProfile(stored);
  if (req.body.priority !== undefined) goal.priority = req.body.priority;
  if (req.body.target_amount !== undefined) goal.target_amount = req.body.target_amount;
  if (req.body.current_savings !== undefined) goal.current_savings = req.body.current_savings;

  let recalculationState = null;
  let persistedGoal = goal;
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
    goal.sourceAllocationRevisionId = plan.metrics.state?.allocationRevision?._id || null;
    goal.sourceProfileInputHash = plan.metrics.state?.recommendation?.profileInputHash || null;
    goal.sourceProfileVersion = plan.metrics.state?.profileVersion || null;
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
    goal.sourceGoalCalculationInputFingerprint = buildGoalCalculationInputFingerprint(goal);
    goal.sourceGoalCalculationPolicyVersion = GOAL_CALCULATION_POLICY_VERSION;
    if (!goal.sourceGoalCalculationInputFingerprint) {
      throw new Error('Could not establish the goal calculation input fingerprint.');
    }
  }
  if (recalculationState) {
    const currentState = await assertGoalPlanStateCurrent({
      userId: req.user.userId,
      profileId: goal.profileId,
      profile,
      plannedState: recalculationState,
    });
    goal.gemini_advice = await generateGoalAdvice(goal, profile);
    await reachFinancialStateTestHook('goal.advisory.beforePersistence', {
      userId: req.user.userId, profileId: goal.profileId, goalId: goal._id, sourceState: currentState,
    });
    goal.version = expectedGoalVersion + 1;
    goal.advisoryMetadata = buildGoalAdvisoryMetadata({ goal, state: currentState });
    persistedGoal = await saveGoalWithSourceState(goal, {
      userId: req.user.userId,
      profileId: goal.profileId,
      sourceState: currentState,
      expectedGoalVersion,
    });
  } else {
    goal.version = expectedGoalVersion + 1;
    persistedGoal = await updateGoalWithCAS(goal, { userId: req.user.userId, expectedVersion: expectedGoalVersion });
  }
  await reachFinancialStateTestHook('goal.update.afterCommitBeforeResponse', {
    userId: String(req.user.userId), goalId: String(persistedGoal._id),
    goalVersion: Number(persistedGoal.version),
  });
  void triggerPlanHealthCheck({ userId: req.user.userId, profileId: goal.profileId });
  const currentState = await resolveGoalResponseAfterCommit(persistedGoal, req.user.userId);
  res.json({ success: true, goal: buildCurrentGoalResponse(persistedGoal, { state: currentState }) });
}));

router.delete('/:goalId', verifyJWT, asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.goalId)) throw createError(400, 'Invalid goalId', 'Invalid goal ID.');
  const expectedVersion = parseGoalIfMatch(req.get('If-Match'));
  const current = await Goal.findOne({ _id: req.params.goalId, userId: req.user.userId });
  if (!current) throw createError(404, 'Goal not found', 'Goal not found.');
  if (Number(current.version ?? 1) !== expectedVersion) throw goalVersionConflict(expectedVersion);
  const goal = await Goal.findOneAndDelete({
    _id: req.params.goalId,
    userId: req.user.userId,
    ...goalVersionCondition(expectedVersion),
  });
  if (!goal) {
    const stillOwned = await Goal.exists({ _id: req.params.goalId, userId: req.user.userId });
    if (stillOwned) throw goalVersionConflict(expectedVersion);
    throw createError(404, 'Goal not found', 'Goal not found.');
  }
  void triggerPlanHealthCheck({ userId: req.user.userId, profileId: goal.profileId });
  res.json({ deleted: true, goalId: goal._id });
}));

function parseGoalIfMatch(value) {
  const match = typeof value === 'string' ? value.match(/^(?:W\/)?"?([1-9]\d*)"?$/) : null;
  if (!match || !Number.isSafeInteger(Number(match[1]))) {
    throw createError(428, 'A valid If-Match goal version is required.', 'Refresh the goal before deleting it.', { code: 'GOAL_VERSION_REQUIRED' });
  }
  return Number(match[1]);
}

export default router;
