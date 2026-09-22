import mongoose from 'mongoose';
import crypto from 'node:crypto';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';
import RecommendationState from '../models/RecommendationState.js';
import RecommendationAllocationRevision from '../models/RecommendationAllocationRevision.js';
import AuditRecord from '../models/AuditRecord.js';
import { prepareAuditChainEntry, advanceAuditChainHead } from './auditChain.js';
import { buildRecommendationProfile, buildRecommendationProfileHash, RECOMMENDATION_POLICY_VERSION } from './recommendationProfile.js';
import { getCurrentRegulatoryRuleVersion } from './taxEngine.js';
import { PROJECTION_ASSUMPTION_POLICY_HASH, PROJECTION_ASSUMPTION_SOURCE, PROJECTION_ASSUMPTION_VERSION } from './instrumentConstants.js';
import { assessRecommendationFreshness, RECOMMENDATION_FRESHNESS_REASON_CODES } from './recommendationFreshness.js';
import { buildPortfolioFingerprint, buildRecommendationFingerprint } from './recommendationFingerprint.js';

export const ALLOCATION_SOURCES = Object.freeze({
  ORIGINAL_RECOMMENDATION: 'ORIGINAL_RECOMMENDATION',
  MARKET_CONTEXT_ADJUSTED: 'MARKET_CONTEXT_ADJUSTED',
  USER_REBALANCED: 'USER_REBALANCED',
});

function plain(value) {
  return value && typeof value.toObject === 'function' ? value.toObject({ flattenMaps: true }) : value;
}

function snapshotResponse(snapshot) {
  if (snapshot?.recommendation && snapshot?.completion) return snapshot.recommendation;
  return snapshot;
}

function sameAllocation(left = [], right = []) {
  try {
    return buildPortfolioFingerprint(left) === buildPortfolioFingerprint(right);
  } catch {
    return false;
  }
}

function hasFingerprintableAllocation(instruments) {
  return Array.isArray(instruments)
    && instruments.length > 0
    && instruments.every(instrument => (
      instrument
      && typeof instrument.id === 'string'
      && instrument.id.length > 0
      && Number.isFinite(Number(instrument.allocationWeight))
      && Number.isFinite(Number(instrument.nominalReturn))
      && Number.isFinite(Number(instrument.riskScore))
    ));
}

function errorWithCode(message, code, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.clientMessage = message;
  return error;
}

function modelQuery(model, operation, ...args) {
  return model[operation](...args);
}

async function resolveProfile({ userId, profileId, profile, profileModel }) {
  if (profile) return plain(profile);
  return modelQuery(profileModel, 'findOne', { _id: profileId, userId }).lean();
}

async function resolveRecommendation({ userId, profileId, recommendationId, recommendationModel, stateModel }) {
  if (recommendationId) return modelQuery(recommendationModel, 'findOne', { _id: recommendationId, userId, profileId }).lean();
  const pointer = await modelQuery(stateModel, 'findOne', { userId, profileId }).lean();
  if (pointer?.currentRecommendationId) {
    const pointed = await modelQuery(recommendationModel, 'findOne', { _id: pointer.currentRecommendationId, userId, profileId }).lean();
    if (pointed) return pointed;
  }
  // This is the only timestamp fallback in the application. It exists solely
  // for legacy records before RecommendationState was introduced.
  return modelQuery(recommendationModel, 'findOne', { profileId, userId }).sort({ recommendationGeneration: -1, generatedAt: -1, _id: -1 }).lean();
}

function legacyRevision(recommendation) {
  const response = snapshotResponse(recommendation?.responseSnapshot);
  const snapshotInstruments = response?.instruments;
  if (Array.isArray(snapshotInstruments) && snapshotInstruments.length > 0 && !sameAllocation(snapshotInstruments, recommendation.instruments)) {
    return { conflict: true };
  }
  const instruments = Array.isArray(recommendation?.instruments) ? recommendation.instruments : snapshotInstruments;
  if (!hasFingerprintableAllocation(instruments)) return { conflict: true };
  const assumptionVersion = instruments.find(item => item.returnAssumptionVersion)?.returnAssumptionVersion || PROJECTION_ASSUMPTION_VERSION;
  return {
    _id: null,
    recommendationId: recommendation._id,
    profileId: recommendation.profileId,
    userId: recommendation.userId,
    revision: 1,
    previousRevision: null,
    source: recommendation.currentAllocationSource || ALLOCATION_SOURCES.ORIGINAL_RECOMMENDATION,
    instruments,
    profileInputHash: recommendation.profileInputHash,
    modelVersion: recommendation.modelVersion,
    recommendationPolicyVersion: recommendation.recommendationPolicyVersion || RECOMMENDATION_POLICY_VERSION,
    regulatoryRuleVersion: recommendation.regulatoryRuleVersion,
    returnAssumptionVersion: assumptionVersion,
    returnAssumptionSource: instruments.find(item => item.returnSource)?.returnSource || PROJECTION_ASSUMPTION_SOURCE,
    portfolioFingerprint: buildPortfolioFingerprint(instruments),
    provenanceStatus: 'LEGACY_GENERATION_STATE',
  };
}

export async function resolveCurrentRecommendationState({
  userId,
  profileId,
  recommendationId = null,
  profile = null,
  requireFresh = false,
  dependencies = {},
} = {}) {
  const profileModel = dependencies.profileModel || FinancialProfile;
  const recommendationModel = dependencies.recommendationModel || Recommendation;
  const stateModel = dependencies.stateModel || RecommendationState;
  const revisionModel = dependencies.revisionModel || RecommendationAllocationRevision;
  const currentRegulatoryRuleVersion = (dependencies.getCurrentRegulatoryRuleVersion || getCurrentRegulatoryRuleVersion)();
  const currentProfile = await resolveProfile({ userId, profileId, profile, profileModel });
  const recommendation = await resolveRecommendation({ userId, profileId, recommendationId, recommendationModel, stateModel });
  if (!recommendation) {
    const freshness = assessRecommendationFreshness({ profile: currentProfile, recommendation: null, currentRegulatoryRuleVersion });
    if (requireFresh) throw errorWithCode('No authoritative recommendation is available.', 'RECOMMENDATION_REQUIRED', 409);
    return { profile: currentProfile, recommendation: null, generationSnapshot: null, currentAllocation: null, allocationRevision: null, freshness, provenance: { status: 'MISSING' } };
  }

  const pointer = await modelQuery(stateModel, 'findOne', {
    userId,
    profileId,
    currentRecommendationId: recommendation._id,
  }).lean();
  let allocationRevision = null;
  if (pointer?.currentAllocationRevision) {
    allocationRevision = await modelQuery(revisionModel, 'findOne', {
      recommendationId: recommendation._id,
      revision: pointer.currentAllocationRevision,
    }).lean();
  }
  if (!allocationRevision) {
    allocationRevision = await modelQuery(revisionModel, 'findOne', { recommendationId: recommendation._id }).sort({ revision: -1 }).lean();
  }
  let provenance = { status: 'PERSISTED_REVISION', stateId: pointer?._id || null };
  if (!allocationRevision) {
    allocationRevision = legacyRevision(recommendation);
    if (allocationRevision?.conflict) {
      allocationRevision = null;
      provenance = { status: 'LEGACY_GENERATION_STATE_CONFLICT' };
    } else if (allocationRevision) {
      provenance = { status: allocationRevision.provenanceStatus, stateId: null };
    }
  }

  const currentAllocation = allocationRevision
    ? { ...plain(allocationRevision), instruments: allocationRevision.instruments }
    : null;
  const strictProvenance = provenance.status === 'PERSISTED_REVISION';
  let freshness = assessRecommendationFreshness({
    profile: currentProfile,
    recommendation,
    currentRegulatoryRuleVersion,
    allocationRevision,
    currentAllocation,
    currentAllocationSource: allocationRevision?.source || recommendation.currentAllocationSource,
    requirePolicyVersion: strictProvenance,
    requireAllocationState: strictProvenance,
    requireAssumptionProvenance: strictProvenance,
  });
  if (provenance.status === 'LEGACY_GENERATION_STATE_CONFLICT') {
    const reasonCodes = [...freshness.reasonCodes, RECOMMENDATION_FRESHNESS_REASON_CODES.LEGACY_GENERATION_STATE_CONFLICT];
    freshness = Object.freeze({ ...freshness, fresh: false, reasonCodes: [...new Set(reasonCodes)] });
  }
  const generationSnapshot = {
    instruments: recommendation.instruments || [],
    response: snapshotResponse(recommendation.responseSnapshot),
  };
  const currentRecommendationView = {
    ...plain(recommendation),
    instruments: currentAllocation?.instruments || recommendation.instruments || [],
    currentAllocationSource: currentAllocation?.source || recommendation.currentAllocationSource,
  };
  const result = {
    profile: currentProfile,
    recommendation,
    currentRecommendationView,
    generationSnapshot,
    currentAllocation,
    allocationRevision,
    freshness,
    provenance,
    portfolioFingerprint: currentAllocation?.portfolioFingerprint || null,
    recommendationFingerprint: currentAllocation
      ? buildRecommendationFingerprint({
        recommendationId: recommendation._id,
        profileInputHash: recommendation.profileInputHash,
        modelVersion: recommendation.modelVersion,
        recommendationPolicyVersion: recommendation.recommendationPolicyVersion || RECOMMENDATION_POLICY_VERSION,
        regulatoryRuleVersion: recommendation.regulatoryRuleVersion,
        returnAssumptionVersion: currentAllocation.returnAssumptionVersion,
        allocationRevision: currentAllocation.revision,
        instruments: currentAllocation.instruments,
      })
      : null,
  };
  if (requireFresh && !freshness.fresh) {
    const error = errorWithCode('Authoritative recommendation state is stale or unavailable.', 'RECOMMENDATION_STALE', currentRegulatoryRuleVersion ? 409 : 503);
    error.reasonCodes = freshness.reasonCodes;
    error.freshness = freshness;
    error.provenance = provenance;
    throw error;
  }
  return result;
}

export async function requireFreshRecommendationState(options = {}) {
  return resolveCurrentRecommendationState({ ...options, requireFresh: true });
}

export function assessGoalCalculationFreshness(goal, state) {
  const reasonCodes = [];
  if (!goal || !state?.recommendation || !state?.allocationRevision) {
    return { fresh: false, reasonCodes: ['SOURCE_MISSING'] };
  }
  if (String(goal.sourceRecommendationId || '') !== String(state.recommendation._id || '')) reasonCodes.push('STALE_RECOMMENDATION');
  if (Number(goal.sourceAllocationRevision) !== Number(state.allocationRevision.revision)) reasonCodes.push('STALE_ALLOCATION');
  if (goal.sourceProfileInputHash !== state.recommendation.profileInputHash) reasonCodes.push('STALE_PROFILE');
  if (goal.sourceModelVersion !== state.recommendation.modelVersion) reasonCodes.push('STALE_RECOMMENDATION');
  if (goal.sourceRecommendationPolicyVersion && goal.sourceRecommendationPolicyVersion !== (state.recommendation.recommendationPolicyVersion || RECOMMENDATION_POLICY_VERSION)) reasonCodes.push('STALE_POLICY');
  if (goal.sourceRegulatoryRuleVersion !== state.recommendation.regulatoryRuleVersion) reasonCodes.push('STALE_POLICY');
  if (goal.sourceReturnAssumptionVersion !== state.allocationRevision.returnAssumptionVersion) reasonCodes.push('STALE_ASSUMPTION');
  if (goal.sourcePortfolioFingerprint !== state.portfolioFingerprint) reasonCodes.push('STALE_ALLOCATION');
  if (!goal.sourceRecommendationId || !goal.sourceAllocationRevision || !goal.sourceProfileInputHash || !goal.sourcePortfolioFingerprint) reasonCodes.push('SOURCE_MISSING');
  return { fresh: reasonCodes.length === 0 && state.freshness.fresh, reasonCodes: [...new Set(reasonCodes.concat(state.freshness.fresh ? [] : state.freshness.reasonCodes))] };
}

async function ensurePersistedCurrentState({ session, recommendation }) {
  const stateModel = RecommendationState;
  const revisionModel = RecommendationAllocationRevision;
  let state = await stateModel.findOne({ userId: recommendation.userId, profileId: recommendation.profileId }).session(session);
  if (state?.currentRecommendationId?.toString() === recommendation._id.toString()) {
    const current = await revisionModel.findOne({ recommendationId: recommendation._id, revision: state.currentAllocationRevision }).session(session);
    if (current) return { state, revision: current };
  }
  const existing = await revisionModel.findOne({ recommendationId: recommendation._id }).sort({ revision: -1 }).session(session);
  if (existing) {
    state = await stateModel.findOneAndUpdate({ userId: recommendation.userId, profileId: recommendation.profileId }, {
      $set: { currentRecommendationId: recommendation._id, currentAllocationRevision: existing.revision, currentAllocationRevisionId: existing._id, generationRevision: recommendation.recommendationGeneration || 1, profileInputHash: recommendation.profileInputHash, portfolioFingerprint: existing.portfolioFingerprint },
    }, { new: true, upsert: true, session, setDefaultsOnInsert: true });
    return { state, revision: existing };
  }
  const instruments = recommendation.instruments || [];
  const revision = new revisionModel({
    recommendationId: recommendation._id,
    profileId: recommendation.profileId,
    userId: recommendation.userId,
    revision: 1,
    source: recommendation.currentAllocationSource || ALLOCATION_SOURCES.ORIGINAL_RECOMMENDATION,
    instruments,
    profileInputHash: recommendation.profileInputHash,
    modelVersion: recommendation.modelVersion,
    recommendationPolicyVersion: recommendation.recommendationPolicyVersion || RECOMMENDATION_POLICY_VERSION,
    regulatoryRuleVersion: recommendation.regulatoryRuleVersion,
    returnAssumptionVersion: instruments.find(item => item.returnAssumptionVersion)?.returnAssumptionVersion || PROJECTION_ASSUMPTION_VERSION,
    returnAssumptionHash: instruments.find(item => item.returnAssumptionHash)?.returnAssumptionHash || PROJECTION_ASSUMPTION_POLICY_HASH,
    returnAssumptionSource: instruments.find(item => item.returnSource)?.returnSource || PROJECTION_ASSUMPTION_SOURCE,
    portfolioFingerprint: buildPortfolioFingerprint(instruments),
  });
  await revision.save({ session });
  state = await stateModel.findOneAndUpdate({ userId: recommendation.userId, profileId: recommendation.profileId }, {
    $set: { currentRecommendationId: recommendation._id, currentAllocationRevision: 1, currentAllocationRevisionId: revision._id, generationRevision: recommendation.recommendationGeneration || 1, profileInputHash: recommendation.profileInputHash, portfolioFingerprint: revision.portfolioFingerprint },
  }, { new: true, upsert: true, session, setDefaultsOnInsert: true });
  return { state, revision };
}

export async function createManualAllocationRevision({
  userId, profileId, recommendationId, expectedRevision, instruments, correlationId = null, traceId = null,
} = {}) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const profileDocument = await FinancialProfile.findOne({ _id: profileId, userId }).session(session).lean();
      const recommendation = await Recommendation.findOne({ _id: recommendationId, profileId, userId }).session(session);
      if (!profileDocument || !recommendation) throw errorWithCode('Recommendation state is unavailable.', 'RECOMMENDATION_REQUIRED');
      const { state, revision: current } = await ensurePersistedCurrentState({ session, recommendation });
      if (Number(expectedRevision) !== Number(current.revision)) throw errorWithCode('Allocation revision conflict. Refresh before retrying.', 'ALLOCATION_REVISION_CONFLICT');
      const profile = buildRecommendationProfile(profileDocument);
      const currentPolicy = getCurrentRegulatoryRuleVersion();
      const expectedHash = buildRecommendationProfileHash(profile, { modelVersion: recommendation.modelVersion });
      if (expectedHash !== recommendation.profileInputHash) throw errorWithCode('Recommendation was generated from an older profile state.', 'RECOMMENDATION_STALE');
      if (!currentPolicy || recommendation.regulatoryRuleVersion !== currentPolicy) throw errorWithCode('Recommendation uses an older regulatory policy version.', 'RECOMMENDATION_STALE');
      const nextRevision = Number(current.revision) + 1;
      const fingerprint = buildPortfolioFingerprint(instruments);
      const revisionId = new mongoose.Types.ObjectId();
      const auditId = new mongoose.Types.ObjectId();
      const auditEntry = await prepareAuditChainEntry({
        _id: auditId,
        userId,
        profileId,
        recommendationId,
        correlationId: correlationId || crypto.randomUUID?.() || String(auditId),
        traceId: traceId || '',
        version_id: recommendation.modelVersion,
        regulatory_rule_version: recommendation.regulatoryRuleVersion,
        input_hash: recommendation.profileInputHash,
        inputs: { profileInputHash: recommendation.profileInputHash, allocationRevision: current.revision },
        recommendations: {
          event: 'ALLOCATION_REVISION_CREATED',
          source: ALLOCATION_SOURCES.USER_REBALANCED,
          previousRevision: current.revision,
          allocationRevision: nextRevision,
          oldWeights: current.instruments.map(item => ({ id: item.id, allocationWeight: item.allocationWeight })),
          newWeights: instruments.map(item => ({ id: item.id, allocationWeight: item.allocationWeight })),
          portfolioFingerprint: fingerprint,
          recommendationFingerprint: buildRecommendationFingerprint({ recommendationId, profileInputHash: recommendation.profileInputHash, modelVersion: recommendation.modelVersion, recommendationPolicyVersion: recommendation.recommendationPolicyVersion || RECOMMENDATION_POLICY_VERSION, regulatoryRuleVersion: recommendation.regulatoryRuleVersion, returnAssumptionVersion: PROJECTION_ASSUMPTION_VERSION, allocationRevision: nextRevision, instruments }),
        },
        cited_rag_chunk_ids: [],
        engine: 'rule_based',
        timestamp: new Date(),
      }, session);
      await AuditRecord.create([auditEntry.record], { session });
      const revision = new RecommendationAllocationRevision({
        _id: revisionId, recommendationId, profileId, userId, revision: nextRevision, previousRevision: current.revision,
        source: ALLOCATION_SOURCES.USER_REBALANCED, instruments, profileInputHash: recommendation.profileInputHash,
        modelVersion: recommendation.modelVersion, recommendationPolicyVersion: recommendation.recommendationPolicyVersion || RECOMMENDATION_POLICY_VERSION,
        regulatoryRuleVersion: recommendation.regulatoryRuleVersion, returnAssumptionVersion: PROJECTION_ASSUMPTION_VERSION,
        returnAssumptionHash: PROJECTION_ASSUMPTION_POLICY_HASH,
        returnAssumptionSource: PROJECTION_ASSUMPTION_SOURCE, portfolioFingerprint: fingerprint,
        auditRecordId: auditId, correlationId: auditEntry.record.correlationId, traceId,
      });
      await revision.save({ session });
      const advanced = await RecommendationState.updateOne({ _id: state._id, currentRecommendationId: recommendationId, currentAllocationRevision: current.revision, profileInputHash: recommendation.profileInputHash }, {
        $set: { currentAllocationRevision: nextRevision, currentAllocationRevisionId: revision._id, portfolioFingerprint: fingerprint },
      }, { session });
      if (advanced.matchedCount !== 1) throw errorWithCode('Allocation revision conflict. Refresh before retrying.', 'ALLOCATION_REVISION_CONFLICT');
      await advanceAuditChainHead(auditEntry, session);
      result = { revision: revision.toObject(), audit: auditEntry.record, recommendation: recommendation.toObject(), profile: profileDocument };
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return result;
  } catch (error) {
    if (/WriteConflict|TransientTransactionError|ALLOCATION_REVISION_CONFLICT/.test(`${error.code || ''} ${error.message || ''}`)) {
      throw errorWithCode('Allocation revision conflict. Refresh before retrying.', 'ALLOCATION_REVISION_CONFLICT');
    }
    throw error;
  } finally {
    await session.endSession();
  }
}
