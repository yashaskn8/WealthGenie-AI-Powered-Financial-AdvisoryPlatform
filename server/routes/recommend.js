import crypto from 'crypto';
import mongoose from 'mongoose';
import { Router } from 'express';
import { verifyJWT, isValidObjectId } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import {
  recommendationRequestSchema,
  recommendationWeightsSchema,
  validateStrict,
} from '../validation/financialSchemas.js';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';
import AuditRecord from '../models/AuditRecord.js';
import logger from '../utils/logger.js';
import { getIncompleteProfileFallback, getMLPrediction } from '../services/mlClient.js';
import { generateAdvisory } from '../services/geminiService.js';
import {
  runPipeline,
  assertPortfolioSuitable,
  resolveConcentrationCap,
} from '../services/RecommendationPipeline.js';
import {
  buildRecommendationProfile,
  buildRecommendationProfileHash,
  buildMlProfileInput,
  getMissingMlProfileFields,
  getUnknownOptionalProfileFields,
  buildLlmFinancialContext,
  deriveRecommendationMetrics,
  RECOMMENDATION_POLICY_VERSION,
  FINANCIAL_PROFILE_SCHEMA_VERSION,
} from '../services/recommendationProfile.js';
import { assessSuitabilityRisk, RISK_CAPACITY_POLICY } from '../services/riskProfiler.js';
import { claimAdvisoryIdempotency, releaseAdvisoryIdempotency } from '../middleware/idempotency.js';
import { persistAdvisoryAtomically } from '../services/advisoryPersistence.js';
import { setCache, delCache } from '../config/redis.js';
import { RISK_FREE_RATE, DISCLAIMER } from '../services/instrumentConstants.js';
import { verifyAuditChain } from '../services/auditChain.js';
import { generatePortfolioProjection } from '../services/projectionEngine.js';

const router = Router();

export function buildRecommendationCacheKey(userId, profileId, profile, modelVersion) {
  if (typeof modelVersion !== 'string' || !modelVersion.trim()) {
    throw new TypeError('A model version is required for recommendation cache keys');
  }
  return `recommendation:${userId}:${profileId}:${buildRecommendationProfileHash(profile, { modelVersion })}`;
}

function canonicalAuditInputs(profile, suitability, modelVersion) {
  const metrics = deriveRecommendationMetrics(profile);
  return {
    financial_profile_schema_version: FINANCIAL_PROFILE_SCHEMA_VERSION,
    recommendation_policy_version: RECOMMENDATION_POLICY_VERSION,
    risk_capacity_policy_version: RISK_CAPACITY_POLICY.version,
    model_version: modelVersion,
    monthly_take_home: profile.monthlyTakeHome,
    monthly_savings: profile.monthlySavings,
    age: profile.age,
    risk_tolerance: profile.riskTolerance,
    sold_property_proceeds: profile.soldPropertyProceeds,
    has_lump_sum: profile.hasLumpSum,
    lump_sum_amount: profile.lumpSumAmount,
    liquid_savings: profile.liquidSavings,
    emi_burden_pct: profile.emiBurdenPct,
    financial_dependents: profile.financialDependents,
    emergency_fund_months: profile.emergencyFundMonths,
    investment_goals: [...profile.investmentGoals],
    investment_horizon_years: profile.investmentHorizonYears,
    deployable_lump_sum: metrics.deployableLumpSum,
    risk_capacity_score: suitability.capacityScore,
    final_suitability_risk: suitability.finalRisk,
    suitability_reason_codes: [...suitability.reasonCodes],
  };
}

function buildPortfolioExpectedReturn(instruments) {
  return Number(instruments.reduce(
    (sum, instrument) => sum + Number(instrument.nominalReturn) * Number(instrument.allocationWeight),
    0,
  ).toFixed(2));
}

function buildAssetClassAllocation(instruments) {
  return Object.fromEntries(Object.entries(instruments.reduce((totals, instrument) => {
    const assetClass = instrument.assetClass || 'Other';
    totals[assetClass] = (totals[assetClass] || 0) + (Number(instrument.allocationWeight) * 100);
    return totals;
  }, {})).map(([assetClass, percentage]) => [assetClass, Number(percentage.toFixed(2))]));
}

function buildDashboardProjection(profile, instruments) {
  const metrics = deriveRecommendationMetrics(profile);
  return generatePortfolioProjection({
    monthlyContribution: profile.monthlySavings,
    initialLumpSum: metrics.deployableLumpSum ?? 0,
    horizonYears: profile.investmentHorizonYears,
    instruments,
  });
}

router.post('/', verifyJWT, validateStrict(recommendationRequestSchema), asyncHandler(async (req, res) => {
  const { profileId } = req.body;
  const stored = await FinancialProfile.findOne({ _id: profileId, userId: req.user.userId }).lean();
  if (!stored) throw createError(404, 'Profile not found or access denied', 'Profile not found.');

  const profile = buildRecommendationProfile(stored);
  const suitability = assessSuitabilityRisk(profile);
  const idempotencyClaim = await claimAdvisoryIdempotency({
    key: req.headers['idempotency-key'],
    userId: req.user.userId,
    profileId: stored._id,
    payload: { profileId },
  });
  if (idempotencyClaim.state === 'REPLAY') {
    res.setHeader('X-Cache-Lookup', 'HIT - Idempotent');
    return res.status(idempotencyClaim.response.status).json(idempotencyClaim.response.body);
  }

  try {
    const missingMlProfileFields = getMissingMlProfileFields(profile);
    const unknownOptionalProfileFields = getUnknownOptionalProfileFields(profile);
    const mlResult = missingMlProfileFields.length > 0
      ? getIncompleteProfileFallback(profile, suitability)
      : await getMLPrediction(
        buildMlProfileInput(profile, suitability),
        req.correlationId,
        req.user.userId,
        req.user.role,
      );
    const modelVersion = mlResult.model_version;
    if (typeof modelVersion !== 'string' || !modelVersion.trim()) {
      throw createError(502, 'ML result did not include a model version', 'Recommendation model metadata is unavailable.');
    }
    const { instruments, confidenceScores, riskReconciliation, computedWeights } = runPipeline(profile, mlResult);
    if (!instruments.length) {
      throw createError(422, 'No instruments passed the suitability boundary', 'No suitable instruments were found for this profile.');
    }

    const portfolioExpectedReturn = buildPortfolioExpectedReturn(instruments);
    const assetClassAllocation = buildAssetClassAllocation(instruments);
    const dashboardProjection = buildDashboardProjection(profile, instruments);
    const advisory = await generateAdvisory({
      profile: buildLlmFinancialContext(profile, suitability),
      instruments: instruments.map(instrument => ({
        id: instrument.id,
        name: instrument.name,
        type: instrument.type,
        nominalReturn: instrument.nominalReturn,
        allocationWeight: instrument.allocationWeight,
      })),
      shapExplanation: mlResult.explanation || null,
      modelVersion,
      policyVersion: RECOMMENDATION_POLICY_VERSION,
    });

    const recommendationId = new mongoose.Types.ObjectId();
    const auditId = new mongoose.Types.ObjectId();
    const inputs = canonicalAuditInputs(profile, suitability, modelVersion);
    const inputHash = buildRecommendationProfileHash(profile, { modelVersion });
    const correlationId = req.correlationId || req.traceId || crypto.randomUUID();
    const timestamp = new Date();
    const recommendationData = {
      _id: recommendationId,
      userId: req.user.userId,
      profileId: stored._id,
      instruments,
      advisoryText: advisory.text,
      confidenceScores,
      mlFallback: Boolean(mlResult.fallback),
      modelVersion,
      profileInputHash: inputHash,
    };
    const auditRecordData = {
      _id: auditId,
      userId: req.user.userId,
      profileId: stored._id,
      recommendationId,
      correlationId,
      traceId: req.traceId || req.correlationId || '',
      version_id: modelVersion,
      regulatory_rule_version: RECOMMENDATION_POLICY_VERSION,
      input_hash: inputHash,
      inputs,
      recommendations: {
        instruments,
        confidenceScores,
        portfolioExpectedReturn,
        modelVersion,
        recommendationPolicyVersion: RECOMMENDATION_POLICY_VERSION,
        advisorySummary: advisory.text ? advisory.text.slice(0, 500) : '',
      },
      cited_rag_chunk_ids: advisory.cited_chunks || mlResult.cited_chunk_ids || [],
      engine: mlResult.fallback ? 'rule_fallback' : 'ml_service',
      timestamp,
    };
    const response = {
      recommendationId,
      audit_id: auditId,
      audit_hash: inputHash,
      instruments,
      ranked: true,
      advisory_text: advisory.text,
      confidence_scores: confidenceScores,
      decision_path: mlResult.decision_path,
      explanation: mlResult.explanation || null,
      ml_fallback: Boolean(mlResult.fallback),
      model_version: modelVersion,
      recommendation_policy_version: RECOMMENDATION_POLICY_VERSION,
      financial_profile_schema_version: FINANCIAL_PROFILE_SCHEMA_VERSION,
      portfolio_expected_return: portfolioExpectedReturn,
      asset_class_allocation: assetClassAllocation,
      dashboard_projection: dashboardProjection,
      return_basis: 'PRE_TAX_NOMINAL',
      risk_free_rate: Number((RISK_FREE_RATE * 100).toFixed(2)),
      disclaimer: DISCLAIMER,
      final_risk_tier: riskReconciliation.final_risk_tier,
      capacity_score: riskReconciliation.capacity_score,
      preference_score: riskReconciliation.preference_score,
      reconciliation_note: riskReconciliation.reconciliation_note,
      advisory_note: riskReconciliation.advisory_note,
      suitability_reason_codes: riskReconciliation.reason_codes,
      optional_profile_fields_unknown: unknownOptionalProfileFields,
      ml_input_fields_unknown: missingMlProfileFields,
      excluded_due_to_eligibility: riskReconciliation.excluded_due_to_eligibility,
      computed_weights: computedWeights,
    };

    const persisted = await persistAdvisoryAtomically({
      recommendation: recommendationData,
      auditRecord: auditRecordData,
      response,
      idempotencyClaim,
    });
    const cacheKey = buildRecommendationCacheKey(req.user.userId, stored._id, profile, modelVersion);
    await setCache(cacheKey, persisted, 86400).catch(error => {
      logger.warn('Recommendation cache write failed after committed advisory', { error: error.message });
    });
    return res.json(persisted);
  } catch (error) {
    await releaseAdvisoryIdempotency(idempotencyClaim).catch(releaseError => {
      logger.error('Failed to release advisory idempotency claim', { error: releaseError.message });
    });
    throw error;
  }
}));

router.get('/audit', verifyJWT, asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
  const skip = Math.max(Number.parseInt(req.query.skip, 10) || 0, 0);
  const query = { userId: req.user.userId };
  if (req.query.correlationId) query.correlationId = req.query.correlationId;
  if (req.query.profileId && isValidObjectId(req.query.profileId)) query.profileId = req.query.profileId;
  const [records, total] = await Promise.all([
    AuditRecord.find(query).sort({ timestamp: -1 }).skip(skip).limit(limit).lean(),
    AuditRecord.countDocuments(query),
  ]);
  res.json({ status: 'success', total, count: records.length, skip, limit, records });
}));

router.get('/audit/verify', verifyJWT, asyncHandler(async (req, res) => {
  const verification = await verifyAuditChain(req.user.userId);
  res.status(verification.valid ? 200 : 409).json({ status: verification.valid ? 'valid' : 'invalid', ...verification });
}));

router.get('/audit/:id', verifyJWT, asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw createError(400, 'Invalid audit ID format', 'Invalid audit ID.');
  const record = await AuditRecord.findById(req.params.id).lean();
  if (!record) throw createError(404, 'Audit record not found', 'Audit record not found.');
  if (record.userId.toString() !== req.user.userId.toString() && req.user.role !== 'admin') {
    throw createError(403, 'Access denied to audit record', 'Access denied.');
  }
  res.json({ status: 'success', record });
}));

router.post('/weights', verifyJWT, validateStrict(recommendationWeightsSchema), asyncHandler(async (req, res) => {
  const { profileId, weights } = req.body;
  const stored = await FinancialProfile.findOne({ _id: profileId, userId: req.user.userId }).lean();
  if (!stored) throw createError(404, 'Profile not found or access denied', 'Profile not found.');
  const profile = buildRecommendationProfile(stored);
  const recommendation = await Recommendation.findOne({ profileId, userId: req.user.userId }).sort({ generatedAt: -1 });
  if (!recommendation) throw createError(404, 'No recommendation found to update', 'No recommendation found.');
  const expectedProfileHash = buildRecommendationProfileHash(profile, { modelVersion: recommendation.modelVersion });
  if (recommendation.profileInputHash !== expectedProfileHash) {
    throw createError(409, 'Recommendation was generated from an older profile state.', 'Regenerate recommendations before changing weights.');
  }

  const instrumentIds = recommendation.instruments.map(instrument => String(instrument.id));
  const suppliedIds = Object.keys(weights);
  if (instrumentIds.length !== suppliedIds.length || instrumentIds.some(id => !suppliedIds.includes(id))) {
    throw createError(400, 'Weights must identify every recommended instrument by id and may not add instruments.', 'Invalid instrument weights.');
  }
  assertPortfolioSuitable(profile, instrumentIds);

  const groupTotals = new Map();
  recommendation.instruments.forEach(instrument => {
    const cap = resolveConcentrationCap(instrument.toObject ? instrument.toObject() : instrument);
    if (cap) groupTotals.set(cap.key, (groupTotals.get(cap.key) || 0) + weights[instrument.id] * 100);
  });
  for (const [key, total] of groupTotals.entries()) {
    const cap = resolveConcentrationCap(recommendation.instruments.find(instrument => resolveConcentrationCap(instrument)?.key === key));
    if (cap && total > cap.maxPct + 0.0001) {
      throw createError(400, `Allocation exceeds ${key} concentration cap of ${cap.maxPct}%`, 'Allocation exceeds suitability limits.');
    }
  }

  recommendation.instruments.forEach(instrument => {
    instrument.allocationWeight = Number(weights[instrument.id].toFixed(4));
    instrument.allocation_pct = Number((weights[instrument.id] * 100).toFixed(2));
  });
  await recommendation.save();
  await delCache(buildRecommendationCacheKey(req.user.userId, stored._id, profile, recommendation.modelVersion));
  const updatedInstruments = recommendation.instruments.map(instrument => (
    instrument.toObject ? instrument.toObject() : instrument
  ));
  res.json({
    status: 'success',
    message: 'Recommendation weights updated.',
    instruments: updatedInstruments,
    portfolio_expected_return: buildPortfolioExpectedReturn(updatedInstruments),
    asset_class_allocation: buildAssetClassAllocation(updatedInstruments),
    dashboard_projection: buildDashboardProjection(profile, updatedInstruments),
  });
}));

export default router;
