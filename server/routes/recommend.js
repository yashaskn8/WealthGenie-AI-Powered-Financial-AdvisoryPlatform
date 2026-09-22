import { Router } from 'express';
import crypto from 'node:crypto';
import { verifyJWT, isValidObjectId } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import {
  recommendationRequestSchema,
  recommendationWeightsSchema,
  validateStrict,
} from '../validation/financialSchemas.js';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';
import RecommendationState from '../models/RecommendationState.js';
import AuditRecord from '../models/AuditRecord.js';
import logger from '../utils/logger.js';
import { generateAdvisory } from '../services/geminiService.js';
import {
  assertPortfolioSuitable,
  resolveConcentrationCap,
} from '../services/RecommendationPipeline.js';
import {
  buildRecommendationProfile,
  buildLlmFinancialContext,
  RECOMMENDATION_POLICY_VERSION,
} from '../services/recommendationProfile.js';
import { assessSuitabilityRisk } from '../services/riskProfiler.js';
import { claimAdvisoryIdempotency, releaseAdvisoryIdempotency } from '../middleware/idempotency.js';
import { persistAdvisoryAtomically } from '../services/advisoryPersistence.js';
import { setCache, delCache } from '../config/redis.js';
import { verifyAuditChain } from '../services/auditChain.js';
import { triggerPlanHealthCheck } from '../services/planHealthMonitor.js';
import { requireFreshRecommendationState, createManualAllocationRevision } from '../services/recommendationState.js';
import { buildCurrentRecommendationResponse } from '../services/recommendationResponse.js';
import {
  computeCoreRecommendation,
  buildRecommendationCacheKey,
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

function advisoryBindingStatus(metadata, state) {
  const required = [
    'recommendationId', 'profileId', 'allocationRevision', 'allocationRevisionId',
    'portfolioFingerprint', 'profileInputHash', 'recommendationPolicyVersion',
    'regulatoryRuleVersion', 'returnAssumptionHash', 'generatedAt',
  ];
  if (!metadata || required.some(field => metadata[field] === null || metadata[field] === undefined || metadata[field] === '')) {
    return { fresh: false, reason: 'ADVISORY_PROVENANCE_MISSING' };
  }
  const matches = String(metadata.recommendationId) === String(state.recommendation._id)
    && String(metadata.profileId) === String(state.recommendation.profileId)
    && Number(metadata.allocationRevision) === Number(state.allocationRevision.revision)
    && String(metadata.allocationRevisionId) === String(state.allocationRevision._id)
    && metadata.portfolioFingerprint === state.portfolioFingerprint
    && metadata.profileInputHash === state.recommendation.profileInputHash
    && metadata.recommendationPolicyVersion === state.recommendation.recommendationPolicyVersion
    && metadata.regulatoryRuleVersion === state.recommendation.regulatoryRuleVersion
    && metadata.returnAssumptionHash === state.allocationRevision.returnAssumptionHash;
  return matches ? { fresh: true, reason: null } : { fresh: false, reason: 'ADVISORY_SOURCE_STATE_CHANGED' };
}

async function persistAdvisoryIfCurrent({ recommendationId, userId, state, claimToken, advisoryText, advisoryMetadata }) {
  const session = await Recommendation.startSession();
  try {
    await session.withTransaction(async () => {
      const pointer = await RecommendationState.findOne({
        _id: state.provenance?.stateId,
        userId,
        profileId: state.recommendation.profileId,
        currentRecommendationId: recommendationId,
        currentAllocationRevision: state.allocationRevision.revision,
        currentAllocationRevisionId: state.allocationRevision._id,
        profileInputHash: state.recommendation.profileInputHash,
        portfolioFingerprint: state.portfolioFingerprint,
      }).session(session);
      if (!pointer) {
        const error = new Error('The financial state changed while advisory text was being generated.');
        error.code = 'ADVISORY_SOURCE_STATE_CHANGED';
        error.status = 409;
        throw error;
      }
      const stateCas = await RecommendationState.updateOne({
        _id: pointer._id,
        userId,
        profileId: state.recommendation.profileId,
        currentRecommendationId: recommendationId,
        currentAllocationRevision: state.allocationRevision.revision,
        currentAllocationRevisionId: state.allocationRevision._id,
        profileInputHash: state.recommendation.profileInputHash,
        portfolioFingerprint: state.portfolioFingerprint,
      }, {
        $set: {
          currentRecommendationId: recommendationId,
          currentAllocationRevision: state.allocationRevision.revision,
          currentAllocationRevisionId: state.allocationRevision._id,
          profileInputHash: state.recommendation.profileInputHash,
          portfolioFingerprint: state.portfolioFingerprint,
          returnAssumptionVersion: state.allocationRevision.returnAssumptionVersion,
          returnAssumptionHash: state.allocationRevision.returnAssumptionHash,
          returnAssumptionSource: state.allocationRevision.returnAssumptionSource,
        },
      }, { session });
      if (stateCas.matchedCount !== 1) {
        const error = new Error('The financial state changed while advisory text was being generated.');
        error.code = 'ADVISORY_SOURCE_STATE_CHANGED';
        error.status = 409;
        throw error;
      }
      const result = await Recommendation.updateOne({
        _id: recommendationId,
        userId,
        'advisoryMetadata.status': 'GENERATING',
        'advisoryMetadata.claimToken': claimToken,
        'advisoryMetadata.allocationRevision': state.allocationRevision.revision,
        'advisoryMetadata.allocationRevisionId': String(state.allocationRevision._id),
        'advisoryMetadata.portfolioFingerprint': state.portfolioFingerprint,
      }, {
        $set: { advisoryText, advisoryMetadata },
      }, { session });
      if (result.matchedCount !== 1) {
        const error = new Error('The advisory generation claim is no longer current.');
        error.code = 'ADVISORY_SOURCE_STATE_CHANGED';
        error.status = 409;
        throw error;
      }
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  } finally {
    await session.endSession();
  }
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

    void triggerPlanHealthCheck({ userId: req.user.userId, profileId: stored._id });
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

  let state;
  try {
    state = await requireFreshRecommendationState({ userId: req.user.userId, profileId, profile });
  } catch (error) {
    if (error.code === 'RECOMMENDATION_REQUIRED') throw createError(404, error.message, 'Recommendation not found.');
    if (error.code === 'RECOMMENDATION_STALE') {
      throw createError(error.status || 409, error.message, 'Regenerate recommendations before opening the dashboard.', {
        code: error.reasonCodes?.includes('REGULATORY_VERSION_UNAVAILABLE') ? 'REGULATORY_POLICY_UNAVAILABLE' : 'STALE_RECOMMENDATION',
        reasonCodes: error.reasonCodes,
        freshness: error.freshness,
        provenance: error.provenance,
      });
    }
    if (['FINANCIAL_STATE_MISSING', 'FINANCIAL_STATE_POINTER_INVALID', 'ALLOCATION_REVISION_ID_MISMATCH', 'ALLOCATION_FINGERPRINT_MISMATCH'].includes(error.code)) {
      throw createError(503, error.message, 'Authoritative financial state is temporarily unavailable.', {
        code: error.code,
        reasonCodes: error.reasonCodes,
        provenance: error.provenance,
      });
    }
    throw error;
  }
  const { recommendation, allocationRevision, freshness, provenance, portfolioFingerprint } = state;
  const advisoryBinding = advisoryBindingStatus(recommendation.advisoryMetadata, state);
  const currentAdvisoryExplanation = advisoryBinding.fresh
    ? advisoryExplanationFromMetadata(recommendation.advisoryMetadata)
    : { status: 'STALE', unavailable_facts: [advisoryBinding.reason] };
  const currentResponse = buildCurrentRecommendationResponse({
    profile,
    recommendation,
    allocationRevision,
    freshness,
    provenance,
    portfolioFingerprint,
    advisoryExplanation: currentAdvisoryExplanation,
    advisoryText: advisoryBinding.fresh ? recommendation.advisoryText : null,
  });
  return res.json(currentResponse);
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

  let recommendationState;
  try {
    recommendationState = await requireFreshRecommendationState({
      userId: req.user.userId,
      profileId: recommendation.profileId,
      recommendationId,
    });
  } catch (error) {
    throw createError(error.status || 409, error.message, 'Regenerate recommendations before generating advisory text.', {
      code: error.code || 'RECOMMENDATION_STALE',
      reasonCodes: error.reasonCodes,
      freshness: error.freshness,
    });
  }
  const currentAllocationRevision = recommendationState.allocationRevision?.revision || 1;
  const currentPortfolioFingerprint = recommendationState.portfolioFingerprint;
  const advisoryBinding = advisoryBindingStatus(recommendation.advisoryMetadata, recommendationState);

  const isReady = advisoryBinding.fresh && (recommendation.advisoryMetadata?.status === 'READY'
    || recommendation.advisoryMetadata?.status === 'GROUNDED_EXPLANATION_AVAILABLE'
    || recommendation.advisoryMetadata?.status === 'GROUNDED_EXPLANATION_FALLBACK'
    || (Boolean(recommendation.advisoryText) && !['PENDING', 'GENERATING', 'FAILED'].includes(recommendation.advisoryMetadata?.status)));

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
        allocation_revision: currentAllocationRevision,
        portfolio_fingerprint: currentPortfolioFingerprint,
      },
    });
  }

  const claimToken = crypto.randomUUID();
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
        {
          'advisoryMetadata.status': { $in: ['READY', 'GROUNDED_EXPLANATION_AVAILABLE', 'GROUNDED_EXPLANATION_FALLBACK'] },
          $or: [
            { 'advisoryMetadata.recommendationId': { $exists: false } },
            { 'advisoryMetadata.profileId': { $exists: false } },
            { 'advisoryMetadata.allocationRevision': { $exists: false } },
            { 'advisoryMetadata.allocationRevisionId': { $exists: false } },
            { 'advisoryMetadata.portfolioFingerprint': { $exists: false } },
            { 'advisoryMetadata.profileInputHash': { $exists: false } },
            { 'advisoryMetadata.recommendationPolicyVersion': { $exists: false } },
            { 'advisoryMetadata.regulatoryRuleVersion': { $exists: false } },
            { 'advisoryMetadata.returnAssumptionHash': { $exists: false } },
          ],
        },
      ],
    },
    {
      $set: {
        'advisoryMetadata.status': 'GENERATING',
        'advisoryMetadata.claimedAt': new Date(),
        'advisoryMetadata.claimToken': claimToken,
        'advisoryMetadata.recommendationId': String(recommendation._id),
        'advisoryMetadata.profileId': String(recommendation.profileId),
        'advisoryMetadata.allocationRevision': currentAllocationRevision,
        'advisoryMetadata.allocationRevisionId': String(recommendationState.allocationRevision._id),
        'advisoryMetadata.portfolioFingerprint': currentPortfolioFingerprint,
        'advisoryMetadata.profileInputHash': recommendation.profileInputHash,
        'advisoryMetadata.recommendationPolicyVersion': recommendation.recommendationPolicyVersion || RECOMMENDATION_POLICY_VERSION,
        'advisoryMetadata.regulatoryRuleVersion': recommendation.regulatoryRuleVersion,
        'advisoryMetadata.returnAssumptionHash': recommendationState.allocationRevision.returnAssumptionHash,
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
      const currentBinding = advisoryBindingStatus(current.advisoryMetadata, recommendationState);
      if (!currentBinding.fresh) {
        throw createError(409, 'Advisory text describes an older allocation revision.', 'Refresh the advisory after reviewing the current portfolio.', {
          code: currentBinding.reason || 'ADVISORY_STALE',
          allocation_revision: currentAllocationRevision,
          portfolio_fingerprint: currentPortfolioFingerprint,
        });
      }
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
    const currentState = await requireFreshRecommendationState({
      userId: req.user.userId,
      profileId: recommendation.profileId,
      recommendationId,
      profile: storedProfile,
    });
    const suitability = assessSuitabilityRisk(profile);
    const recommendationSnapshot = recommendationPayloadFromSnapshot(recommendation.responseSnapshot);
    const shapExplanation = recommendationSnapshot?.explanation || null;

    const advisory = await generateAdvisory({
      profile: buildLlmFinancialContext(profile, suitability),
      instruments: currentState.currentAllocation.instruments.map(instrument => ({
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
      recommendationId: String(recommendation._id),
      profileId: String(recommendation.profileId),
      allocationRevision: currentState.allocationRevision.revision,
      allocationRevisionId: String(currentState.allocationRevision._id),
      portfolioFingerprint: currentState.portfolioFingerprint,
      profileInputHash: recommendation.profileInputHash,
      recommendationPolicyVersion: recommendation.recommendationPolicyVersion || RECOMMENDATION_POLICY_VERSION,
      regulatoryRuleVersion: recommendation.regulatoryRuleVersion,
      returnAssumptionHash: currentState.allocationRevision.returnAssumptionHash,
      claimToken,
    };

    await persistAdvisoryIfCurrent({
      recommendationId,
      userId: req.user.userId,
      state: currentState,
      claimToken,
      advisoryText: advisory.text,
      advisoryMetadata,
    });

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
      {
        _id: recommendationId,
        userId: req.user.userId,
        'advisoryMetadata.status': 'GENERATING',
        'advisoryMetadata.claimToken': claimToken,
      },
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
  const { profileId, recommendationId, weights, expectedAllocationRevision, expectedPortfolioFingerprint } = req.body;
  const stored = await FinancialProfile.findOne({ _id: profileId, userId: req.user.userId }).lean();
  if (!stored) throw createError(404, 'Profile not found or access denied', 'Profile not found.');
  const profile = buildRecommendationProfile(stored);
  let state;
  try {
    state = await requireFreshRecommendationState({ userId: req.user.userId, profileId, profile });
  } catch (error) {
    throw createError(error.status || 409, error.message, 'Regenerate recommendations before changing weights.', {
      code: error.code || 'RECOMMENDATION_STALE',
      reasonCodes: error.reasonCodes,
      freshness: error.freshness,
    });
  }
  const recommendation = state.recommendation;
  if (String(recommendationId) !== String(recommendation._id)) {
    throw createError(409, 'The requested recommendation has been superseded.', 'Refresh before changing weights.', { code: 'RECOMMENDATION_SUPERSEDED' });
  }
  const currentInstruments = state.currentAllocation?.instruments || [];
  const instrumentIds = currentInstruments.map(instrument => String(instrument.id));
  const suppliedIds = Object.keys(weights);
  if (instrumentIds.length !== suppliedIds.length || instrumentIds.some(id => !suppliedIds.includes(id))) {
    throw createError(400, 'Weights must identify every recommended instrument by id and may not add instruments.', 'Invalid instrument weights.');
  }
  assertPortfolioSuitable(profile, instrumentIds);

  const groupTotals = new Map();
  currentInstruments.forEach(instrument => {
    const cap = resolveConcentrationCap(instrument.toObject ? instrument.toObject() : instrument);
    if (cap) groupTotals.set(cap.key, (groupTotals.get(cap.key) || 0) + weights[instrument.id] * 100);
  });
  for (const [key, total] of groupTotals.entries()) {
    const cap = resolveConcentrationCap(currentInstruments.find(instrument => resolveConcentrationCap(instrument)?.key === key));
    if (cap && total > cap.maxPct + 0.0001) {
      throw createError(400, `Allocation exceeds ${key} concentration cap of ${cap.maxPct}%`, 'Allocation exceeds suitability limits.');
    }
  }

  const updatedInstruments = currentInstruments.map(instrument => ({
    ...instrument,
    allocationWeight: Number(weights[instrument.id].toFixed(4)),
    allocation_pct: Number((weights[instrument.id] * 100).toFixed(2)),
  }));
  if (Math.abs(updatedInstruments.reduce((sum, item) => sum + item.allocationWeight, 0) - 1) > 0.001) {
    throw createError(400, 'Allocation weights must total 100%.', 'Invalid allocation weights.');
  }
  const supersededAt = new Date();
  const generationMarketAdjustment = plainMarketAdjustment(recommendation.marketAdjustment);
  let revisionResult;
  try {
    revisionResult = await createManualAllocationRevision({
      userId: req.user.userId,
      profileId,
      recommendationId: recommendation._id,
      expectedRevision: expectedAllocationRevision,
      expectedRecommendationId: recommendationId,
      expectedPortfolioFingerprint,
      instruments: updatedInstruments,
      correlationId: req.correlationId,
      traceId: req.traceId,
    });
  } catch (error) {
    if (error.code === 'ALLOCATION_REVISION_CONFLICT') {
      throw createError(409, error.message, 'This portfolio changed before the rebalance completed. Refresh and retry.', { code: error.code });
    }
    if (error.code === 'RECOMMENDATION_STALE') {
      throw createError(409, error.message, 'Regenerate recommendations before changing weights.', { code: error.code });
    }
    if (error.code === 'ALLOCATION_STATE_CHANGED') {
      throw createError(409, error.message, 'This portfolio changed before the rebalance completed. Refresh and retry.', { code: error.code });
    }
    throw error;
  }
  await delCache(buildRecommendationCacheKey(req.user.userId, stored._id, profile, recommendation.modelVersion));
  const currentResponse = buildCurrentRecommendationResponse({
    profile,
    recommendation,
    allocationRevision: revisionResult.revision,
    freshness: { ...state.freshness, allocationRevision: revisionResult.revision.revision },
    provenance: { ...state.provenance, status: 'PERSISTED_REVISION' },
    portfolioFingerprint: revisionResult.revision.portfolioFingerprint,
    advisoryExplanation: { status: 'STALE', unavailable_facts: ['ADVISORY_SOURCE_STATE_CHANGED'] },
    advisoryText: null,
  });
  res.json({
    ...currentResponse,
    status: 'success',
    message: 'Recommendation weights updated.',
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
