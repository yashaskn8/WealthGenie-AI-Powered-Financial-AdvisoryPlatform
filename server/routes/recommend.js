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
import { generateAdvisory } from '../services/geminiService.js';
import {
  assertPortfolioSuitable,
  resolveConcentrationCap,
} from '../services/RecommendationPipeline.js';
import {
  buildRecommendationProfile,
  buildRecommendationProfileHash,
  buildLlmFinancialContext,
  RECOMMENDATION_POLICY_VERSION,
} from '../services/recommendationProfile.js';
import { assessSuitabilityRisk } from '../services/riskProfiler.js';
import { getCurrentRegulatoryRuleVersion } from '../services/taxEngine.js';
import { assessRecommendationFreshness } from '../services/recommendationFreshness.js';
import { claimAdvisoryIdempotency, releaseAdvisoryIdempotency } from '../middleware/idempotency.js';
import { persistAdvisoryAtomically } from '../services/advisoryPersistence.js';
import { setCache, delCache } from '../config/redis.js';
import {
  PROJECTION_ASSUMPTION_DATA_CLASS,
  PROJECTION_ASSUMPTION_SOURCE,
  PROJECTION_ASSUMPTION_VERSION,
} from '../services/instrumentConstants.js';
import { verifyAuditChain } from '../services/auditChain.js';
import {
  computeCoreRecommendation,
  buildRecommendationCacheKey,
  buildPortfolioReturnAssumption,
  buildAssetClassAllocation,
  buildDashboardProjection,
} from '../services/coreRecommendation.js';

export { buildRecommendationCacheKey, canonicalAuditInputs } from '../services/coreRecommendation.js';

const router = Router();

function plainMarketAdjustment(value) {
  if (!value) return null;
  return typeof value.toObject === 'function' ? value.toObject({ flattenMaps: true }) : value;
}

export function recommendationPayloadFromSnapshot(snapshot) {
  if (snapshot?.recommendation && snapshot?.completion) return snapshot.recommendation;
  return snapshot;
}

function advisoryExplanationFromMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Object.keys(metadata).length === 0) return null;
  return {
    status: metadata.status,
    provider: metadata.provider,
    model: metadata.model,
    prompt_version: metadata.promptVersion ?? metadata.prompt_version,
    grounding_version: metadata.groundingVersion ?? metadata.grounding_version,
    evidence_ids_used: metadata.evidenceIdsUsed ?? metadata.evidence_ids_used ?? [],
    unavailable_facts: metadata.unavailableFacts ?? metadata.unavailable_facts ?? [],
    citations: metadata.citations ?? [],
    validation_status: metadata.validation?.status ?? metadata.validation_status,
    generated_at: metadata.generatedAt ?? metadata.generated_at,
  };
}

router.post('/', verifyJWT, validateStrict(recommendationRequestSchema), asyncHandler(async (req, res) => {
  const tTotalStart = performance.now();
  const { profileId } = req.body;
  const tProfileStart = performance.now();
  const stored = await FinancialProfile.findOne({ _id: profileId, userId: req.user.userId }).lean();
  const tProfile = performance.now() - tProfileStart;
  if (!stored) throw createError(404, 'Profile not found or access denied', 'Profile not found.');

  const profile = buildRecommendationProfile(stored);
  const tIdempotencyStart = performance.now();
  const idempotencyClaim = await claimAdvisoryIdempotency({
    key: req.headers['idempotency-key'],
    userId: req.user.userId,
    profileId: stored._id,
    payload: { profileId },
  });
  const tIdempotency = performance.now() - tIdempotencyStart;
  if (idempotencyClaim.state === 'REPLAY') {
    res.setHeader('X-Cache-Lookup', 'HIT - Idempotent');
    return res.status(idempotencyClaim.response.status).json(idempotencyClaim.response.body);
  }

  try {
    const core = await computeCoreRecommendation({
      canonicalProfile: profile,
      userId: req.user.userId,
      profileId: stored._id,
      correlationId: req.correlationId,
      traceId: req.traceId || req.correlationId,
      userRole: req.user.role,
    });
    const tPersistStart = performance.now();
    const persisted = await persistAdvisoryAtomically({
      recommendation: core.recommendationData,
      auditRecord: core.auditRecordData,
      response: core.response,
      idempotencyClaim,
    });
    const tPersist = performance.now() - tPersistStart;
    const tCacheStart = performance.now();
    const cacheKey = buildRecommendationCacheKey(req.user.userId, stored._id, profile, core.modelVersion);
    await setCache(cacheKey, persisted, 86400).catch(error => {
      logger.warn('Recommendation cache write failed after committed advisory', { error: error.message });
    });
    const tCache = performance.now() - tCacheStart;
    const tTotal = performance.now() - tTotalStart;
    const timings = core.timings || {};

    res.setHeader('Server-Timing', [
      `profile;dur=${tProfile.toFixed(2)}`,
      `idempotency;dur=${tIdempotency.toFixed(2)}`,
      `ml;dur=${Number(timings.ml || 0).toFixed(2)}`,
      `pipeline;dur=${Number(timings.pipeline || 0).toFixed(2)}`,
      `market-context;dur=${Number(timings.marketContext || 0).toFixed(2)}`,
      `projection;dur=${Number(timings.projection || 0).toFixed(2)}`,
      `persistence;dur=${tPersist.toFixed(2)}`,
      `cache;dur=${tCache.toFixed(2)}`,
      `total;dur=${tTotal.toFixed(2)}`,
    ].join(', '));

    return res.json(persisted);
  } catch (error) {
    await releaseAdvisoryIdempotency(idempotencyClaim).catch(releaseError => {
      logger.error('Failed to release advisory idempotency claim', { error: releaseError.message });
    });
    throw error;
  }
}));

router.get('/current', verifyJWT, asyncHandler(async (req, res) => {
  const { profileId } = req.query;
  if (!isValidObjectId(profileId)) {
    throw createError(400, 'Invalid profile ID format', 'Invalid profile ID.');
  }

  const profile = await FinancialProfile.findOne({
    _id: profileId,
    userId: req.user.userId,
  }).lean();
  if (!profile) {
    throw createError(404, 'Profile not found or access denied', 'Recommendation not found.');
  }

  const recommendation = await Recommendation.findOne({
    profileId,
    userId: req.user.userId,
  }).sort({ generatedAt: -1 }).lean();
  if (!recommendation) {
    throw createError(404, 'No recommendation found for this profile', 'Recommendation not found.');
  }

  const snapshot = recommendation.responseSnapshot;
  const response = recommendationPayloadFromSnapshot(snapshot);
  if (!response || typeof response !== 'object' || !Array.isArray(response.instruments)) {
    throw createError(
      503,
      'The persisted recommendation response is unavailable.',
      'Recommendation restore is temporarily unavailable.',
      { code: 'RECOMMENDATION_SNAPSHOT_UNAVAILABLE' },
    );
  }

  const currentRegulatoryRuleVersion = getCurrentRegulatoryRuleVersion();
  if (!currentRegulatoryRuleVersion) {
    throw createError(
      503,
      'No verified regulatory policy is available for the current fiscal year.',
      'Regulatory policy metadata is temporarily unavailable.',
      { code: 'REGULATORY_POLICY_UNAVAILABLE' },
    );
  }
  let recommendationRegulatoryRuleVersion = recommendation.regulatoryRuleVersion;
  if (!recommendationRegulatoryRuleVersion) {
    // Legacy documents may lack the denormalized field. Read the immutable
    // audit source when available; if neither record has it, retain a
    // compatibility read-only path rather than inventing policy metadata.
    const audit = await AuditRecord.findOne({
      recommendationId: recommendation._id,
      userId: req.user.userId,
    }).select('regulatory_rule_version').lean();
    recommendationRegulatoryRuleVersion = audit?.regulatory_rule_version || null;
  }
  const freshness = assessRecommendationFreshness({
    profile,
    recommendation,
    currentRegulatoryRuleVersion,
    recommendationRegulatoryRuleVersion,
  });
  if (!freshness.fresh) {
    const regulatoryUnavailable = freshness.reasonCodes.includes('REGULATORY_VERSION_UNAVAILABLE');
    if (regulatoryUnavailable) {
      throw createError(
        503,
        'No verified regulatory policy is available for the current fiscal year.',
        'Regulatory policy metadata is temporarily unavailable.',
        { code: 'REGULATORY_POLICY_UNAVAILABLE' },
      );
    }
    throw createError(
      409,
      freshness.reasonCodes.includes('REGULATORY_POLICY_CHANGED')
        ? 'Recommendation was generated under an older regulatory policy version.'
        : 'Recommendation was generated from an older profile state.',
      'Regenerate recommendations before opening the dashboard.',
      { code: 'STALE_RECOMMENDATION' },
    );
  }

  const currentAdvisoryExplanation = advisoryExplanationFromMetadata(recommendation.advisoryMetadata);

  return res.json({
    ...response,
    profileId: String(profile._id),
    recommendationId: String(recommendation._id),
    audit_id: response.audit_id ? String(response.audit_id) : response.audit_id,
    audit_hash: response.audit_hash || snapshot.audit_hash || null,
    advisory_text: recommendation.advisoryText ?? response.advisory_text ?? null,
    advisory_explanation: currentAdvisoryExplanation || response.advisory_explanation || { status: 'PENDING' },
  });
}));

router.post('/:recommendationId/advisory', verifyJWT, asyncHandler(async (req, res) => {
  const { recommendationId } = req.params;
  if (!isValidObjectId(recommendationId)) {
    throw createError(400, 'Invalid recommendation ID format', 'Invalid recommendation ID.');
  }

  const recommendation = await Recommendation.findById(recommendationId);
  if (!recommendation) {
    throw createError(404, 'Recommendation not found or access denied', 'Recommendation not found.');
  }
  if (recommendation.userId.toString() !== req.user.userId.toString() && req.user.role !== 'admin') {
    throw createError(403, 'Access denied to recommendation', 'Access denied.');
  }

  const isReady = recommendation.advisoryMetadata?.status === 'READY'
    || recommendation.advisoryMetadata?.status === 'GROUNDED_EXPLANATION_AVAILABLE'
    || recommendation.advisoryMetadata?.status === 'GROUNDED_EXPLANATION_FALLBACK'
    || (Boolean(recommendation.advisoryText) && !['PENDING', 'GENERATING', 'FAILED'].includes(recommendation.advisoryMetadata?.status));

  if (isReady) {
    return res.json({
      recommendationId: recommendation._id,
      advisory_text: recommendation.advisoryText,
      advisory_explanation: {
        status: recommendation.advisoryMetadata?.status || 'GROUNDED_EXPLANATION_AVAILABLE',
        provider: recommendation.advisoryMetadata?.provider,
        model: recommendation.advisoryMetadata?.model,
        prompt_version: recommendation.advisoryMetadata?.promptVersion || recommendation.advisoryMetadata?.prompt_version,
        grounding_version: recommendation.advisoryMetadata?.groundingVersion || recommendation.advisoryMetadata?.grounding_version,
        evidence_ids_used: recommendation.advisoryMetadata?.evidenceIdsUsed || recommendation.advisoryMetadata?.evidence_ids_used || [],
        unavailable_facts: recommendation.advisoryMetadata?.unavailableFacts || recommendation.advisoryMetadata?.unavailable_facts || [],
        citations: recommendation.advisoryMetadata?.citations || [],
        validation_status: recommendation.advisoryMetadata?.validation?.status || recommendation.advisoryMetadata?.validation_status,
        generated_at: recommendation.advisoryMetadata?.generatedAt || recommendation.advisoryMetadata?.generated_at,
      },
    });
  }

  // Atomic PENDING/FAILED -> GENERATING claim via conditional update
  const claimed = await Recommendation.findOneAndUpdate(
    {
      _id: recommendationId,
      userId: req.user.userId,
      $or: [
        { 'advisoryMetadata.status': 'PENDING' },
        { 'advisoryMetadata.status': 'FAILED' },
        { advisoryMetadata: null },
        { advisoryMetadata: { $exists: false } },
      ],
    },
    {
      $set: {
        'advisoryMetadata.status': 'GENERATING',
        'advisoryMetadata.claimedAt': new Date(),
      },
    },
    { new: true },
  );

  if (!claimed) {
    const current = await Recommendation.findById(recommendationId);
    const currentIsReady = current?.advisoryMetadata?.status === 'READY'
      || current?.advisoryMetadata?.status === 'GROUNDED_EXPLANATION_AVAILABLE'
      || current?.advisoryMetadata?.status === 'GROUNDED_EXPLANATION_FALLBACK'
      || (Boolean(current?.advisoryText) && !['PENDING', 'GENERATING', 'FAILED'].includes(current?.advisoryMetadata?.status));

    if (currentIsReady) {
      return res.json({
        recommendationId: current._id,
        advisory_text: current.advisoryText,
        advisory_explanation: {
          status: current.advisoryMetadata?.status || 'GROUNDED_EXPLANATION_AVAILABLE',
          provider: current.advisoryMetadata?.provider,
          model: current.advisoryMetadata?.model,
          prompt_version: current.advisoryMetadata?.promptVersion || current.advisoryMetadata?.prompt_version,
          grounding_version: current.advisoryMetadata?.groundingVersion || current.advisoryMetadata?.grounding_version,
          evidence_ids_used: current.advisoryMetadata?.evidenceIdsUsed || current.advisoryMetadata?.evidence_ids_used || [],
          unavailable_facts: current.advisoryMetadata?.unavailableFacts || current.advisoryMetadata?.unavailable_facts || [],
          citations: current.advisoryMetadata?.citations || [],
          validation_status: current.advisoryMetadata?.validation?.status || current.advisoryMetadata?.validation_status,
          generated_at: current.advisoryMetadata?.generatedAt || current.advisoryMetadata?.generated_at,
        },
      });
    }

    return res.status(409).json({
      error: 'Advisory generation already in progress',
      status: 'GENERATING',
    });
  }

  try {
    const storedProfile = await FinancialProfile.findOne({
      _id: recommendation.profileId,
      userId: req.user.userId,
    }).lean();
    if (!storedProfile) {
      throw createError(404, 'Source financial profile not found', 'Profile not found.');
    }

    const profile = buildRecommendationProfile(storedProfile);
    const suitability = assessSuitabilityRisk(profile);
    const recommendationSnapshot = recommendationPayloadFromSnapshot(recommendation.responseSnapshot);
    const shapExplanation = recommendationSnapshot?.explanation || null;

    const advisory = await generateAdvisory({
      profile: buildLlmFinancialContext(profile, suitability),
      instruments: recommendation.instruments.map(instrument => ({
        id: instrument.id,
        name: instrument.name,
        type: instrument.type,
        nominalReturn: instrument.nominalReturn,
        allocationWeight: instrument.allocationWeight,
      })),
      shapExplanation,
      modelVersion: recommendation.modelVersion,
      policyVersion: RECOMMENDATION_POLICY_VERSION,
    });

    const advisoryMetadata = {
      status: advisory.status,
      provider: advisory.provider,
      model: advisory.model,
      promptVersion: advisory.promptVersion,
      groundingVersion: advisory.groundingVersion,
      evidenceIdsUsed: advisory.evidenceIdsUsed,
      unavailableFacts: advisory.unavailableFacts,
      citations: advisory.citations,
      validation: advisory.validation,
      generatedAt: advisory.generatedAt,
    };

    // Update ONLY advisoryText and advisoryMetadata fields on the Recommendation document
    // Instruments, allocation weights, and original AuditRecord are NEVER mutated
    await Recommendation.updateOne(
      { _id: recommendationId, userId: req.user.userId },
      {
        $set: {
          advisoryText: advisory.text,
          advisoryMetadata,
        },
      },
    );

    return res.json({
      recommendationId: recommendation._id,
      advisory_text: advisory.text,
      advisory_explanation: {
        status: advisory.status,
        provider: advisory.provider,
        model: advisory.model,
        prompt_version: advisory.promptVersion,
        grounding_version: advisory.groundingVersion,
        evidence_ids_used: advisory.evidenceIdsUsed,
        unavailable_facts: advisory.unavailableFacts,
        citations: advisory.citations,
        validation_status: advisory.validation?.status,
        generated_at: advisory.generatedAt,
      },
    });
  } catch (error) {
    await Recommendation.updateOne(
      { _id: recommendationId, userId: req.user.userId },
      {
        $set: {
          'advisoryMetadata.status': 'FAILED',
          'advisoryMetadata.error': error.message,
        },
      },
    ).catch(() => {});
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
  const supersededAt = new Date();
  const generationMarketAdjustment = plainMarketAdjustment(recommendation.marketAdjustment);
  recommendation.currentAllocationSource = 'USER_REBALANCED';
  recommendation.marketAdjustmentSupersededAt = supersededAt;
  await recommendation.save();
  await delCache(buildRecommendationCacheKey(req.user.userId, stored._id, profile, recommendation.modelVersion));
  const updatedInstruments = recommendation.instruments.map(instrument => (
    instrument.toObject ? instrument.toObject() : instrument
  ));
  res.json({
    status: 'success',
    message: 'Recommendation weights updated.',
    instruments: updatedInstruments,
    portfolio_return_assumption: buildPortfolioReturnAssumption(updatedInstruments),
    return_data_class: PROJECTION_ASSUMPTION_DATA_CLASS,
    return_assumption_version: PROJECTION_ASSUMPTION_VERSION,
    return_assumption_source: PROJECTION_ASSUMPTION_SOURCE,
    observed_market_fact: false,
    provider_forecast: false,
    asset_class_allocation: buildAssetClassAllocation(updatedInstruments),
    dashboard_projection: buildDashboardProjection(profile, updatedInstruments),
    current_allocation_source: 'USER_REBALANCED',
    generation_market_adjustment: generationMarketAdjustment,
    market_adjustment: generationMarketAdjustment
      ? {
        ...generationMarketAdjustment,
        currentAllocationSource: 'USER_REBALANCED',
        supersededByManualRebalanceAt: supersededAt.toISOString(),
      }
      : null,
  });
}));

export default router;
