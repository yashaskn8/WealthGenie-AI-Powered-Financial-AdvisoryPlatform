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
import { buildGoalCalculationInputFingerprint, GOAL_CALCULATION_POLICY_VERSION } from './goalCalculationProvenance.js';

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
  // Callers often pass the canonical allowlisted profile, which intentionally
  // excludes persistence metadata. Load the owned document when the version
  // token is absent so long-running financial work can bind to it.
  if (profile && profile.version !== null && profile.version !== undefined
      && Number.isInteger(Number(profile.version)) && Number(profile.version) > 0 && profile._id) return plain(profile);
  return modelQuery(profileModel, 'findOne', { _id: profileId, userId }).lean();
}

async function resolveRecommendation({ userId, profileId, recommendationId, recommendationModel, statePointer }) {
  if (recommendationId) return modelQuery(recommendationModel, 'findOne', { _id: recommendationId, userId, profileId }).lean();
  if (statePointer?.currentRecommendationId) {
    const pointed = await modelQuery(recommendationModel, 'findOne', { _id: statePointer.currentRecommendationId, userId, profileId }).lean();
    if (pointed) return pointed;
  }
  // This is the only timestamp fallback in the application. It exists solely
  // for legacy records before RecommendationState was introduced.
  return modelQuery(recommendationModel, 'findOne', { profileId, userId }).sort({ recommendationGeneration: -1, generatedAt: -1, _id: -1 }).lean();
}

function sameId(left, right) {
  return String(left ?? '') === String(right ?? '');
}

function integrityFailure(code, message) {
  return { code, message };
}

function verifyPersistedStateGraph({
  state,
  recommendation,
  allocationRevision,
  recomputedFingerprint,
  recomputedRecommendationFingerprint,
}) {
  if (!state) return integrityFailure('FINANCIAL_STATE_MISSING', 'The canonical financial state pointer is missing.');
  if (!sameId(state.userId, recommendation.userId) || !sameId(state.profileId, recommendation.profileId)) {
    return integrityFailure('FINANCIAL_STATE_POINTER_INVALID', 'The canonical financial state owner binding is invalid.');
  }
  if (!sameId(state.currentRecommendationId, recommendation._id)) {
    return integrityFailure('CURRENT_RECOMMENDATION_MISMATCH', 'The requested recommendation is no longer current.');
  }
  if (!allocationRevision) return integrityFailure('ALLOCATION_REVISION_MISSING', 'The canonical allocation revision is missing.');
  if (!sameId(state.currentAllocationRevisionId, allocationRevision._id)) {
    return integrityFailure('ALLOCATION_REVISION_ID_MISMATCH', 'The canonical allocation revision binding is invalid.');
  }
  if (Number(state.currentAllocationRevision) !== Number(allocationRevision.revision)) {
    return integrityFailure('ALLOCATION_REVISION_NUMBER_MISMATCH', 'The canonical allocation revision number is invalid.');
  }
  if (!sameId(allocationRevision.recommendationId, recommendation._id)) {
    return integrityFailure('ALLOCATION_RECOMMENDATION_MISMATCH', 'The allocation is bound to another recommendation.');
  }
  if (!sameId(allocationRevision.profileId, recommendation.profileId)
      || !sameId(allocationRevision.userId, recommendation.userId)) {
    return integrityFailure('FINANCIAL_STATE_POINTER_INVALID', 'The allocation ownership binding is invalid.');
  }
  if (state.profileInputHash !== recommendation.profileInputHash
      || allocationRevision.profileInputHash !== recommendation.profileInputHash) {
    return integrityFailure('PROFILE_HASH_MISMATCH', 'The financial state profile hash binding is invalid.');
  }
  if (Number(state.generationRevision) !== Number(recommendation.recommendationGeneration)) {
    return integrityFailure('MODEL_VERSION_MISMATCH', 'The financial state generation binding is invalid.');
  }
  if (allocationRevision.modelVersion !== recommendation.modelVersion
      || allocationRevision.recommendationPolicyVersion !== recommendation.recommendationPolicyVersion) {
    return integrityFailure('RECOMMENDATION_POLICY_MISMATCH', 'The allocation policy binding is invalid.');
  }
  if (allocationRevision.regulatoryRuleVersion !== recommendation.regulatoryRuleVersion) {
    return integrityFailure('REGULATORY_POLICY_MISMATCH', 'The allocation regulatory-policy binding is invalid.');
  }
  if (allocationRevision.returnAssumptionVersion !== PROJECTION_ASSUMPTION_VERSION
      || allocationRevision.returnAssumptionHash !== PROJECTION_ASSUMPTION_POLICY_HASH
      || allocationRevision.returnAssumptionSource !== PROJECTION_ASSUMPTION_SOURCE
      || state.returnAssumptionVersion !== allocationRevision.returnAssumptionVersion
      || state.returnAssumptionHash !== allocationRevision.returnAssumptionHash
      || state.returnAssumptionSource !== allocationRevision.returnAssumptionSource
      || recommendation.returnAssumptionHash !== PROJECTION_ASSUMPTION_POLICY_HASH) {
    return integrityFailure('ASSUMPTION_HASH_MISMATCH', 'The allocation assumption-policy binding is invalid.');
  }
  if (recomputedFingerprint !== allocationRevision.portfolioFingerprint
      || recomputedFingerprint !== state.portfolioFingerprint) {
    return integrityFailure('ALLOCATION_FINGERPRINT_MISMATCH', 'The allocation fingerprint does not match its contents.');
  }
  if (!allocationRevision.recommendationFingerprint
      || recomputedRecommendationFingerprint !== allocationRevision.recommendationFingerprint) {
    return integrityFailure('RECOMMENDATION_FINGERPRINT_MISMATCH', 'The recommendation fingerprint does not match its authoritative state.');
  }
  return null;
}

function fingerprintForRevision(recommendation, allocationRevision) {
  if (!recommendation || !allocationRevision) return null;
  return buildRecommendationFingerprint({
    recommendationId: recommendation._id,
    profileInputHash: recommendation.profileInputHash,
    modelVersion: recommendation.modelVersion,
    recommendationPolicyVersion: recommendation.recommendationPolicyVersion || RECOMMENDATION_POLICY_VERSION,
    regulatoryRuleVersion: recommendation.regulatoryRuleVersion,
    returnAssumptionVersion: allocationRevision.returnAssumptionVersion,
    returnAssumptionHash: allocationRevision.returnAssumptionHash,
    allocationRevision: allocationRevision.revision,
    instruments: allocationRevision.instruments,
  });
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
  const statePointer = await modelQuery(stateModel, 'findOne', { userId, profileId }).lean();
  if (statePointer && (!statePointer.currentRecommendationId
    || !statePointer.currentAllocationRevision
    || !statePointer.currentAllocationRevisionId
    || !statePointer.generationRevision
    || !statePointer.profileInputHash
    || !statePointer.portfolioFingerprint
    || !statePointer.returnAssumptionVersion
    || !statePointer.returnAssumptionHash
    || !statePointer.returnAssumptionSource)) {
    const failure = errorWithCode('The canonical financial state pointer is invalid.', 'FINANCIAL_STATE_POINTER_INVALID', 503);
    failure.reasonCodes = ['FINANCIAL_STATE_POINTER_INVALID'];
    if (requireFresh) throw failure;
  }
  const recommendation = await resolveRecommendation({ userId, profileId, recommendationId, recommendationModel, statePointer });
  if (!recommendation) {
    if (statePointer) {
      const failure = errorWithCode('The canonical financial recommendation is unavailable.', 'FINANCIAL_STATE_POINTER_INVALID', 503);
      failure.reasonCodes = ['FINANCIAL_STATE_POINTER_INVALID'];
      if (requireFresh) throw failure;
    }
    const freshness = assessRecommendationFreshness({ profile: currentProfile, recommendation: null, currentRegulatoryRuleVersion });
    if (requireFresh) throw errorWithCode('No authoritative recommendation is available.', 'RECOMMENDATION_REQUIRED', 409);
    return { profile: currentProfile, recommendation: null, generationSnapshot: null, currentAllocation: null, allocationRevision: null, freshness, provenance: { status: 'MISSING' } };
  }

  if (recommendationId && statePointer && !sameId(statePointer.currentRecommendationId, recommendationId)) {
    const failure = errorWithCode('The requested recommendation has been superseded.', 'RECOMMENDATION_SUPERSEDED', 409);
    failure.reasonCodes = ['CURRENT_RECOMMENDATION_MISMATCH'];
    if (requireFresh) throw failure;
    return {
      profile: currentProfile,
      recommendation,
      generationSnapshot: { instruments: recommendation.instruments || [], response: snapshotResponse(recommendation.responseSnapshot) },
      currentAllocation: null,
      allocationRevision: null,
      freshness: { fresh: false, reasonCodes: ['CURRENT_RECOMMENDATION_MISMATCH'] },
      provenance: { status: 'SUPERSEDED', stateId: statePointer._id || null },
    };
  }

  const pointer = statePointer;
  const hasState = Boolean(pointer);
  const persistedRevision = await modelQuery(revisionModel, 'findOne', {
    recommendationId: recommendation._id,
    profileId,
    userId,
  }).sort({ revision: -1 }).lean();
  if (!hasState && persistedRevision) {
    const failure = errorWithCode('The canonical financial state pointer is missing.', 'FINANCIAL_STATE_MISSING', 503);
    failure.reasonCodes = ['FINANCIAL_STATE_MISSING'];
    if (requireFresh) throw failure;
  }
  let allocationRevision = null;
  if (pointer?.currentAllocationRevision && pointer?.currentAllocationRevisionId) {
    allocationRevision = await modelQuery(revisionModel, 'findOne', {
      _id: pointer.currentAllocationRevisionId,
      recommendationId: recommendation._id,
      profileId,
      userId,
      revision: pointer.currentAllocationRevision,
    }).lean();
  }
  if (pointer && !allocationRevision) {
    const failure = errorWithCode('The canonical allocation revision pointer is invalid.', 'ALLOCATION_REVISION_ID_MISMATCH', 503);
    failure.reasonCodes = ['ALLOCATION_REVISION_ID_MISMATCH'];
    if (requireFresh) throw failure;
  }
  let provenance = { status: 'PERSISTED_REVISION', stateId: pointer?._id || null };
  if (!pointer && !persistedRevision) {
    allocationRevision = legacyRevision(recommendation);
    if (allocationRevision?.conflict) {
      allocationRevision = null;
      provenance = { status: 'LEGACY_GENERATION_STATE_CONFLICT' };
    } else if (allocationRevision) {
      provenance = { status: allocationRevision.provenanceStatus, stateId: null };
    }
  } else if (!pointer) {
    provenance = { status: 'FINANCIAL_STATE_MISSING', stateId: null };
  }

  const recomputedFingerprint = allocationRevision?.instruments
    ? buildPortfolioFingerprint(allocationRevision.instruments)
    : null;
  const persistedIntegrityFailure = provenance.status === 'PERSISTED_REVISION'
    ? verifyPersistedStateGraph({
      state: pointer,
      recommendation,
      allocationRevision,
      recomputedFingerprint,
      recomputedRecommendationFingerprint: fingerprintForRevision(recommendation, allocationRevision),
    })
    : null;
  const currentAllocation = allocationRevision && !persistedIntegrityFailure
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
    assumptionHash: PROJECTION_ASSUMPTION_POLICY_HASH,
    assumptionSource: PROJECTION_ASSUMPTION_SOURCE,
  });
  if (provenance.status === 'LEGACY_GENERATION_STATE_CONFLICT') {
    const reasonCodes = [...freshness.reasonCodes, RECOMMENDATION_FRESHNESS_REASON_CODES.LEGACY_GENERATION_STATE_CONFLICT];
    freshness = Object.freeze({ ...freshness, fresh: false, reasonCodes: [...new Set(reasonCodes)] });
  }
  if (persistedIntegrityFailure) {
    freshness = Object.freeze({
      ...freshness,
      fresh: false,
      reasonCodes: [...new Set([...freshness.reasonCodes, persistedIntegrityFailure.code])],
    });
    provenance = { status: 'INTEGRITY_ERROR', stateId: pointer?._id || null, reasonCode: persistedIntegrityFailure.code };
  }
  // A legacy generation can be inspected for migration/audit purposes, but it
  // is never a current financial state without the durable canonical pointer.
  // Do not let a read-time timestamp fallback become personalized authority.
  if (!pointer) {
    freshness = Object.freeze({
      ...freshness,
      fresh: false,
      reasonCodes: [...new Set([...freshness.reasonCodes, 'FINANCIAL_STATE_MISSING'])],
    });
  }
  if (requireFresh && provenance.status !== 'PERSISTED_REVISION' && freshness.fresh) {
    const error = errorWithCode('This legacy financial state has no verified canonical pointer. Regenerate the recommendation.', 'LEGACY_STATE_UNVERIFIABLE', 503);
    error.reasonCodes = [...new Set([...(freshness.reasonCodes || []), 'LEGACY_STATE_UNVERIFIABLE'])];
    error.freshness = freshness;
    error.provenance = provenance;
    throw error;
  }
  const generationSnapshot = {
    instruments: recommendation.instruments || [],
    response: snapshotResponse(recommendation.responseSnapshot),
  };
  const currentRecommendationView = {
    ...plain(recommendation),
    instruments: currentAllocation?.instruments || [],
    currentAllocationSource: currentAllocation?.source || recommendation.currentAllocationSource,
  };
  const result = {
    profile: currentProfile,
    profileVersion: currentProfile?.version !== null && currentProfile?.version !== undefined
      && Number.isInteger(Number(currentProfile.version)) && Number(currentProfile.version) > 0
      ? Number(currentProfile.version)
      : null,
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
        returnAssumptionHash: currentAllocation.returnAssumptionHash,
        allocationRevision: currentAllocation.revision,
        instruments: currentAllocation.instruments,
      })
      : null,
  };
  if (requireFresh && !freshness.fresh) {
    const integrityCodes = new Set([
      'FINANCIAL_STATE_MISSING',
      'FINANCIAL_STATE_POINTER_INVALID',
      'CURRENT_RECOMMENDATION_MISMATCH',
      'ALLOCATION_REVISION_ID_MISMATCH',
      'ALLOCATION_REVISION_NUMBER_MISMATCH',
      'ALLOCATION_FINGERPRINT_MISMATCH',
      'RECOMMENDATION_FINGERPRINT_MISMATCH',
      'RECOMMENDATION_SUPERSEDED',
    ]);
    const primaryCode = freshness.reasonCodes.find(code => integrityCodes.has(code));
    const profileStateChanged = freshness.reasonCodes.includes(RECOMMENDATION_FRESHNESS_REASON_CODES.PROFILE_CHANGED)
      || freshness.reasonCodes.includes('PROFILE_CHANGED');
    const error = errorWithCode(
      primaryCode ? 'Authoritative recommendation state integrity verification failed.' : 'Authoritative recommendation state is stale or unavailable.',
      primaryCode || 'RECOMMENDATION_STALE',
      profileStateChanged ? 409 : (primaryCode ? 503 : (currentRegulatoryRuleVersion ? 409 : 503)),
    );
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
  if (String(goal.sourceAllocationRevisionId || '') !== String(state.allocationRevision._id || '')) reasonCodes.push('STALE_ALLOCATION');
  if (goal.sourceProfileInputHash !== state.recommendation.profileInputHash) reasonCodes.push('STALE_PROFILE');
  if (goal.sourceModelVersion !== state.recommendation.modelVersion) reasonCodes.push('STALE_RECOMMENDATION');
  if (goal.sourceRecommendationPolicyVersion !== (state.recommendation.recommendationPolicyVersion || RECOMMENDATION_POLICY_VERSION)) reasonCodes.push('STALE_POLICY');
  if (goal.sourceRegulatoryRuleVersion !== state.recommendation.regulatoryRuleVersion) reasonCodes.push('STALE_POLICY');
  if (goal.sourceReturnAssumptionVersion !== state.allocationRevision.returnAssumptionVersion) reasonCodes.push('STALE_ASSUMPTION');
  if (goal.sourceReturnAssumptionHash !== state.allocationRevision.returnAssumptionHash) reasonCodes.push('STALE_ASSUMPTION');
  if (goal.return_assumption_source !== state.allocationRevision.returnAssumptionSource) reasonCodes.push('STALE_ASSUMPTION');
  if (goal.sourceRecommendationFingerprint !== state.recommendationFingerprint) reasonCodes.push('STALE_RECOMMENDATION');
  if (goal.sourcePortfolioFingerprint !== state.portfolioFingerprint) reasonCodes.push('STALE_ALLOCATION');
  const currentGoalInputFingerprint = buildGoalCalculationInputFingerprint(goal);
  if (!currentGoalInputFingerprint
      || goal.sourceGoalCalculationInputFingerprint !== currentGoalInputFingerprint
      || goal.sourceGoalCalculationPolicyVersion !== GOAL_CALCULATION_POLICY_VERSION) {
    reasonCodes.push(goal.sourceGoalCalculationInputFingerprint ? 'STALE_GOAL_INPUTS' : 'SOURCE_MISSING');
  }
  if (state.profileVersion !== null && state.profileVersion !== undefined
      && Number(goal.sourceProfileVersion) !== Number(state.profileVersion)) reasonCodes.push('STALE_PROFILE');
  if (!goal.sourceRecommendationId || !goal.sourceAllocationRevision || !goal.sourceProfileInputHash
      || !goal.sourceAllocationRevisionId || !goal.sourceReturnAssumptionHash
      || !goal.sourceReturnAssumptionVersion || !goal.return_assumption_source
      || !goal.sourceModelVersion || !goal.sourceRecommendationPolicyVersion
      || !goal.sourceRegulatoryRuleVersion || !goal.sourceRecommendationFingerprint || !goal.sourcePortfolioFingerprint
      || !goal.sourceGoalCalculationInputFingerprint || !goal.sourceGoalCalculationPolicyVersion
      || (state.profileVersion !== null && state.profileVersion !== undefined && !goal.sourceProfileVersion)) {
    reasonCodes.push('SOURCE_MISSING');
  }
  return { fresh: reasonCodes.length === 0 && state.freshness.fresh, reasonCodes: [...new Set(reasonCodes.concat(state.freshness.fresh ? [] : state.freshness.reasonCodes))] };
}

async function ensurePersistedCurrentState({ session, recommendation }) {
  const state = await RecommendationState.findOne({
    userId: recommendation.userId,
    profileId: recommendation.profileId,
  }).session(session);
  if (!state) throw errorWithCode('The canonical financial state pointer is missing.', 'FINANCIAL_STATE_MISSING', 503);
  if (!sameId(state.currentRecommendationId, recommendation._id)) {
    throw errorWithCode('The requested recommendation has been superseded.', 'RECOMMENDATION_SUPERSEDED');
  }
  if (!state.currentAllocationRevisionId || !state.currentAllocationRevision) {
    throw errorWithCode('The canonical allocation revision pointer is invalid.', 'FINANCIAL_STATE_POINTER_INVALID', 503);
  }
  const revision = await RecommendationAllocationRevision.findOne({
    _id: state.currentAllocationRevisionId,
    recommendationId: recommendation._id,
    profileId: recommendation.profileId,
    userId: recommendation.userId,
    revision: state.currentAllocationRevision,
  }).session(session);
  if (!revision) throw errorWithCode('The canonical allocation revision is unavailable.', 'ALLOCATION_REVISION_ID_MISMATCH', 503);
  const graphFailure = verifyPersistedStateGraph({
    state,
    recommendation,
    allocationRevision: revision,
    recomputedFingerprint: buildPortfolioFingerprint(revision.instruments),
    recomputedRecommendationFingerprint: fingerprintForRevision(recommendation, revision),
  });
  if (graphFailure) throw errorWithCode(graphFailure.message, graphFailure.code, 503);
  return { state, revision };
}

export async function createAllocationRevision({ session, data } = {}) {
  const revision = new RecommendationAllocationRevision(data);
  await revision.save({ session });
  return revision;
}

export async function createManualAllocationRevision({
  userId, profileId, recommendationId, expectedRevision, expectedPortfolioFingerprint, expectedRecommendationId,
  instruments, correlationId = null, traceId = null,
} = {}) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const profileDocument = await FinancialProfile.findOne({ _id: profileId, userId }).session(session).lean();
      const recommendation = await Recommendation.findOne({ _id: recommendationId, profileId, userId }).session(session);
      if (!profileDocument || !recommendation) throw errorWithCode('Recommendation state is unavailable.', 'RECOMMENDATION_REQUIRED');
      const profileCas = await FinancialProfile.updateOne(
        { _id: profileId, userId, version: profileDocument.version },
        { $inc: { financialStateFence: 1 } },
        { session },
      );
      if (profileCas.matchedCount !== 1) {
        throw errorWithCode('The financial profile changed before the rebalance completed.', 'PROFILE_STATE_CHANGED');
      }
      const { state, revision: current } = await ensurePersistedCurrentState({ session, recommendation });
      if (!expectedRecommendationId || !sameId(expectedRecommendationId, recommendationId)) {
        throw errorWithCode('A recommendation identity is required for rebalance concurrency.', 'ALLOCATION_STATE_CHANGED');
      }
      if (String(expectedPortfolioFingerprint || '') !== String(current.portfolioFingerprint || '')) {
        throw errorWithCode('The portfolio changed before the rebalance completed.', 'ALLOCATION_STATE_CHANGED');
      }
      if (Number(expectedRevision) !== Number(current.revision)) throw errorWithCode('Allocation revision conflict. Refresh before retrying.', 'ALLOCATION_REVISION_CONFLICT');
      const profile = buildRecommendationProfile(profileDocument);
      const currentPolicy = getCurrentRegulatoryRuleVersion();
      const expectedHash = buildRecommendationProfileHash(profile, { modelVersion: recommendation.modelVersion });
      if (expectedHash !== recommendation.profileInputHash) throw errorWithCode('Recommendation was generated from an older profile state.', 'RECOMMENDATION_STALE');
      if (!currentPolicy || recommendation.regulatoryRuleVersion !== currentPolicy) throw errorWithCode('Recommendation uses an older regulatory policy version.', 'RECOMMENDATION_STALE');
      const nextRevision = Number(current.revision) + 1;
      const fingerprint = buildPortfolioFingerprint(instruments);
      const recommendationFingerprint = buildRecommendationFingerprint({
        recommendationId,
        profileInputHash: recommendation.profileInputHash,
        modelVersion: recommendation.modelVersion,
        recommendationPolicyVersion: recommendation.recommendationPolicyVersion || RECOMMENDATION_POLICY_VERSION,
        regulatoryRuleVersion: recommendation.regulatoryRuleVersion,
        returnAssumptionVersion: PROJECTION_ASSUMPTION_VERSION,
        returnAssumptionHash: PROJECTION_ASSUMPTION_POLICY_HASH,
        allocationRevision: nextRevision,
        instruments,
      });
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
          recommendationFingerprint,
        },
        cited_rag_chunk_ids: [],
        engine: 'rule_based',
        timestamp: new Date(),
      }, session);
      await AuditRecord.create([auditEntry.record], { session });
      const revision = await createAllocationRevision({
        session,
        data: {
          _id: revisionId, recommendationId, profileId, userId, revision: nextRevision, previousRevision: current.revision,
          source: ALLOCATION_SOURCES.USER_REBALANCED, instruments, profileInputHash: recommendation.profileInputHash,
          modelVersion: recommendation.modelVersion, recommendationPolicyVersion: recommendation.recommendationPolicyVersion || RECOMMENDATION_POLICY_VERSION,
          regulatoryRuleVersion: recommendation.regulatoryRuleVersion, returnAssumptionVersion: PROJECTION_ASSUMPTION_VERSION,
          returnAssumptionHash: PROJECTION_ASSUMPTION_POLICY_HASH,
          returnAssumptionSource: PROJECTION_ASSUMPTION_SOURCE, portfolioFingerprint: fingerprint,
          recommendationFingerprint,
          auditRecordId: auditId, correlationId: auditEntry.record.correlationId, traceId,
        },
      });
      const advanced = await RecommendationState.updateOne({ _id: state._id, currentRecommendationId: recommendationId, currentAllocationRevision: current.revision, profileInputHash: recommendation.profileInputHash }, {
        $set: {
          currentAllocationRevision: nextRevision,
          currentAllocationRevisionId: revision._id,
          portfolioFingerprint: fingerprint,
          returnAssumptionVersion: revision.returnAssumptionVersion,
          returnAssumptionHash: revision.returnAssumptionHash,
          returnAssumptionSource: revision.returnAssumptionSource,
        },
        $inc: { financialStateFence: 1 },
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
