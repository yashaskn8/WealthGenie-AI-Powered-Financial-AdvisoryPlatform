import mongoose from 'mongoose';
import { requireFreshRecommendationState } from './recommendationState.js';
import { buildCurrentRecommendationResponse } from './recommendationResponse.js';
import { formatProfileResponse } from './profileResponse.js';
import { assessAdvisoryStateBinding } from './advisoryBinding.js';
import { PrometheusMetrics } from './metricsCollector.js';
import { resolveCurrentFinancialProfile } from './currentFinancialProfile.js';
import { reachFinancialStateTestHook } from './financialStateTestHooks.js';
import { buildRecommendationProfile, buildRecommendationProfileHash } from './recommendationProfile.js';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';

const POST_COMMIT_RECONCILIATION_ATTEMPTS = 3;
const CURRENT_RECOMMENDATION_POINTER_FIELDS = Object.freeze([
  'currentRecommendationId',
  'currentAllocationRevision',
  'currentAllocationRevisionId',
  'generationRevision',
  'profileInputHash',
  'profileVersion',
  'portfolioFingerprint',
  'returnAssumptionVersion',
  'returnAssumptionHash',
  'returnAssumptionSource',
]);

function sameIdentity(left, right) {
  return String(left ?? '') === String(right ?? '');
}

function sameCanonicalRecommendationPointer(left, right) {
  return Boolean(left && right)
    && CURRENT_RECOMMENDATION_POINTER_FIELDS.every(field => sameIdentity(left[field], right[field]));
}

function sameCurrentProfileState(left, right) {
  return Boolean(left?.state && right?.state && left?.profile && right?.profile)
    && sameIdentity(left.state.userId, right.state.userId)
    && sameIdentity(left.state.currentProfileId, right.state.currentProfileId)
    && Number(left.state.revision) === Number(right.state.revision)
    && Number(left.state.promotionFence) === Number(right.state.promotionFence)
    && left.state.resolutionStatus === right.state.resolutionStatus
    && sameIdentity(left.profile._id, right.profile._id)
    && Number(left.profile.version ?? 1) === Number(right.profile.version ?? 1);
}

function profileHash(profile, modelVersion) {
  return buildRecommendationProfileHash(buildRecommendationProfile(profile), { modelVersion });
}

function isStableCurrentState({ initial, resolved, confirmed }) {
  const recommendation = resolved?.recommendation;
  const recommendationPointer = resolved?.statePointer;
  const confirmedPointer = confirmed?.recommendationState;
  if (!recommendation || !recommendationPointer || !confirmedPointer
      || !sameCurrentProfileState(initial, confirmed)
      || !sameCurrentProfileState(initial, { state: initial.state, profile: resolved.profile })
      || !sameIdentity(resolved.profile?._id, initial.profile?._id)
      || !sameCanonicalRecommendationPointer(recommendationPointer, confirmedPointer)
      || !sameIdentity(recommendationPointer.currentRecommendationId, recommendation._id)
      || Number(recommendationPointer.profileVersion) !== Number(resolved.profileVersion)
      || Number(recommendation.profileVersion) !== Number(resolved.profileVersion)) {
    return false;
  }
  try {
    const confirmedProfileHash = profileHash(confirmed.profile, recommendation.modelVersion);
    const resolvedProfileHash = profileHash(resolved.profile, recommendation.modelVersion);
    return confirmedProfileHash === recommendation.profileInputHash
      && resolvedProfileHash === recommendation.profileInputHash;
  } catch {
    return false;
  }
}

/**
 * Read the user profile pointer, resolve its authoritative recommendation state,
 * and verify that neither pointer moved during reconstruction. This is a
 * post-commit reconciliation fence: valid supersession is retried, while an
 * unstable/corrupt state fails closed rather than returning historical data as
 * current.
 */
export async function resolveStablePostCommitCurrentState({ userId } = {}) {
  for (let attempt = 1; attempt <= POST_COMMIT_RECONCILIATION_ATTEMPTS; attempt += 1) {
    const initial = await resolveCurrentFinancialProfile({ userId, requireRecommendation: false });
    if (!initial.profile) {
      const error = new Error('No complete current profile is available after the committed recommendation operation.');
      error.code = 'CURRENT_FINANCIAL_PROFILE_UNAVAILABLE';
      throw error;
    }
    await reachFinancialStateTestHook('post_commit.after_current_profile_read', {
      userId: String(userId),
      profileId: String(initial.profile._id),
      profileStateRevision: Number(initial.state.revision),
      attempt,
    });

    const session = await mongoose.startSession();
    let reconciled = null;
    let retry = false;
    try {
      await session.withTransaction(async () => {
        reconciled = null;
        retry = false;
        const snapshotCurrent = await resolveCurrentFinancialProfile({
          userId,
          session,
          requireRecommendation: false,
        });
        // The user-level pointer changed after the preflight read and before
        // this snapshot. Start a new attempt from that newer state.
        if (!sameCurrentProfileState(initial, snapshotCurrent)) {
          retry = true;
          return;
        }
        const state = await requireFreshRecommendationState({
          userId,
          profileId: snapshotCurrent.profile._id,
          profile: snapshotCurrent.profile,
          session,
        });
        const confirmed = await resolveCurrentFinancialProfile({ userId, session });
        if (!isStableCurrentState({ initial, resolved: state, confirmed })) {
          retry = true;
          return;
        }
        reconciled = { current: confirmed, state };
      }, {
        readPreference: 'primary',
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
      });
    } finally {
      await session.endSession();
    }
    if (reconciled) return reconciled;
    if (!retry) break;
  }

  const error = new Error('The canonical financial state changed during post-commit response reconciliation.');
  error.code = 'POST_COMMIT_CURRENT_STATE_UNSTABLE';
  error.status = 503;
  throw error;
}

function explanationFromMetadata(metadata) {
  if (!metadata) return { status: 'PENDING' };
  return {
    status: metadata.status || 'PENDING',
    provider: metadata.provider || null,
    model: metadata.model || null,
    prompt_version: metadata.promptVersion || null,
    grounding_version: metadata.groundingVersion || null,
    evidence_ids_used: metadata.evidenceIdsUsed || [],
    unavailable_facts: metadata.unavailableFacts || [],
    citations: metadata.citations || [],
    validation_status: metadata.validation?.status || null,
    generated_at: metadata.generatedAt || null,
  };
}

function responseFromFreshState({ state, responseTemplate, replayed }) {
  const recommendation = state.recommendation;
  const metadata = recommendation.advisoryMetadata;
  const binding = assessAdvisoryStateBinding(metadata, state);
  const status = metadata?.status || 'PENDING';
  const currentAdvisory = status === 'PENDING'
    ? { text: null, explanation: { status: 'PENDING' } }
    : status === 'GENERATING' && binding.fresh
      ? { text: null, explanation: { status: 'GENERATING' } }
      : binding.fresh
        ? { text: recommendation.advisoryText || null, explanation: explanationFromMetadata(metadata) }
        : { text: null, explanation: { status: 'STALE', unavailable_facts: [binding.reason] } };
  const recommendationBody = buildCurrentRecommendationResponse({
    profile: state.profile,
    recommendation,
    allocationRevision: state.allocationRevision,
    freshness: state.freshness,
    provenance: state.provenance,
    portfolioFingerprint: state.portfolioFingerprint,
    recommendationFingerprint: state.recommendationFingerprint,
    advisoryText: currentAdvisory.text,
    advisoryExplanation: currentAdvisory.explanation,
  });

  if (responseTemplate?.response_kind === 'PROFILE_UPDATE') {
    return {
      profile: formatProfileResponse(state.profile),
      recommendation: recommendationBody,
    };
  }

  if (responseTemplate?.completion && responseTemplate?.profile) {
    return {
      profile: formatProfileResponse(state.profile),
      recommendation: recommendationBody,
      completion: {
        ...responseTemplate.completion,
        status: 'COMMITTED',
        replayed,
        profileId: String(state.profile._id),
        // Identifies the recommendation in this response, not necessarily the
        // generation originally created by the operation.
        recommendationId: String(recommendation._id),
      },
    };
  }
  return recommendationBody;
}

export function committedResponseReconciliationError(cause) {
  if (cause?.code === 'COMMITTED_BUT_RESPONSE_RECONCILIATION_FAILED') return cause;
  const error = new Error(
    'The advisory operation committed, but its current financial state could not be safely reconstructed.',
    { cause },
  );
  error.status = 503;
  error.clientMessage = 'The operation committed, but current financial state could not be verified. Retry with the same Idempotency-Key.';
  error.code = 'COMMITTED_BUT_RESPONSE_RECONCILIATION_FAILED';
  error.committed = true;
  error.clientDetails = {
    committed: true,
    retryWithSameIdempotencyKey: true,
  };
  error.reasonCodes = [cause?.code || 'CURRENT_STATE_RECONCILIATION_FAILED'];
  return error;
}

/** Rebuild a current response, retaining strict expected-generation semantics. */
export async function buildCanonicalAdvisoryResponse({
  userId,
  profileId,
  responseTemplate = null,
  expectedRecommendationId = null,
  replayed = false,
} = {}) {
  const state = await requireFreshRecommendationState({ userId, profileId });
  if (expectedRecommendationId && String(state.recommendation._id) !== String(expectedRecommendationId)) {
    const error = new Error('A newer recommendation superseded this generation before its response could be reconciled.');
    error.code = 'RECOMMENDATION_SUPERSEDED';
    error.status = 409;
    error.reasonCodes = ['CURRENT_RECOMMENDATION_MISMATCH'];
    throw error;
  }
  return responseFromFreshState({ state, responseTemplate, replayed });
}

/**
 * Reconcile a known-committed operation to the verified current pointer.
 * A newer generation does not undo the operation; only the canonical current
 * financial state is returned. Integrity/freshness failures remain errors.
 */
export async function buildPostCommitAdvisoryResponse({
  userId,
  profileId,
  responseTemplate = null,
  committedRecommendationId,
  committedRecommendationGeneration,
  replayed = false,
} = {}) {
  try {
    const committedGeneration = Number(committedRecommendationGeneration);
    if (!committedRecommendationId || !Number.isSafeInteger(committedGeneration) || committedGeneration < 1) {
      const error = new Error('The committed operation is missing its immutable recommendation identity.');
      error.code = 'POST_COMMIT_OPERATION_BINDING_INVALID';
      throw error;
    }

    const committedRecommendation = await Recommendation.findOne({
      _id: committedRecommendationId,
      userId,
      profileId,
    }).select('_id profileId recommendationGeneration').lean();
    if (!committedRecommendation
        || Number(committedRecommendation.recommendationGeneration) !== committedGeneration) {
      const error = new Error('The committed operation does not resolve to its immutable owned recommendation generation.');
      error.code = 'POST_COMMIT_OPERATION_BINDING_INVALID';
      throw error;
    }

    // A committed generation may have been superseded by promotion of a
    // different profile. Reconcile from the user's current-profile pointer,
    // then from that profile's strict recommendation/allocation pointer.
    const { current, state } = await resolveStablePostCommitCurrentState({ userId });
    const currentId = String(state.recommendation._id);
    const committedId = String(committedRecommendationId);
    const currentGeneration = Number(state.recommendation.recommendationGeneration);
    const profileSuperseded = String(current.profile._id) !== String(profileId);
    const superseded = profileSuperseded || currentId !== committedId;
    const generationIsConsistent = profileSuperseded
      || (Number.isSafeInteger(currentGeneration)
        && (currentId !== committedId ? currentGeneration > committedGeneration : currentGeneration === committedGeneration));
    if (!generationIsConsistent) {
      const error = new Error('The verified current pointer is inconsistent with the committed recommendation generation.');
      error.code = 'POST_COMMIT_GENERATION_ORDER_INVALID';
      throw error;
    }

    const body = {
      ...responseFromFreshState({ state, responseTemplate, replayed }),
      current_profile_id: String(current.profile._id),
      financial_profile_state_revision: Number(current.state.revision),
    };
    if (!superseded) return body;

    PrometheusMetrics.inc(profileSuperseded
      ? 'post_commit_reconciled_to_newer_profile_total'
      : 'post_commit_reconciled_to_newer_recommendation_total');
    return {
      ...body,
      operation_result: {
        committed: true,
        ...(profileSuperseded ? { generated_profile_id: String(profileId) } : {}),
        generated_recommendation_id: committedId,
        superseded_before_response: true,
      },
    };
  } catch (cause) {
    throw committedResponseReconciliationError(cause);
  }
}

/** Reconcile a committed profile promotion/update against the user's profile pointer. */
export async function buildPostCommitProfileResponse({
  userId,
  responseTemplate = null,
  committedProfileId,
  committedRecommendationId,
  replayed = false,
} = {}) {
  try {
    if (!committedProfileId || !committedRecommendationId) {
      const error = new Error('The committed profile operation is missing its immutable identity.');
      error.code = 'POST_COMMIT_OPERATION_BINDING_INVALID';
      throw error;
    }
    const committedProfile = await FinancialProfile.findOne({
      _id: committedProfileId,
      userId,
    }).select('_id').lean();
    const committedRecommendation = await Recommendation.findOne({
      _id: committedRecommendationId,
      profileId: committedProfileId,
      userId,
    }).select('_id recommendationGeneration').lean();
    if (!committedProfile || !committedRecommendation
        || !Number.isSafeInteger(Number(committedRecommendation.recommendationGeneration))
        || Number(committedRecommendation.recommendationGeneration) < 1) {
      const error = new Error('The committed profile operation does not resolve to its immutable owned generation.');
      error.code = 'POST_COMMIT_OPERATION_BINDING_INVALID';
      throw error;
    }
    const { current, state } = await resolveStablePostCommitCurrentState({ userId });
    const body = responseFromFreshState({ state, responseTemplate, replayed });
    const profileSuperseded = String(current.profile._id) !== String(committedProfileId);
    const recommendationSuperseded = String(state.recommendation._id) !== String(committedRecommendationId);
    if (recommendationSuperseded && !profileSuperseded
        && Number(state.recommendation.recommendationGeneration) <= Number(committedRecommendation.recommendationGeneration)) {
      const error = new Error('The current recommendation generation does not follow the committed operation generation.');
      error.code = 'POST_COMMIT_GENERATION_ORDER_INVALID';
      throw error;
    }
    const superseded = profileSuperseded || recommendationSuperseded;
    const result = {
      ...body,
      current_profile_id: String(current.profile._id),
      financial_profile_state_revision: Number(current.state.revision),
    };
    if (superseded) {
      PrometheusMetrics.inc('post_commit_reconciled_to_newer_profile_total');
      result.operation_result = {
        committed: true,
        ...(profileSuperseded ? { generated_profile_id: String(committedProfileId) } : {}),
        generated_recommendation_id: String(committedRecommendationId),
        superseded_before_response: true,
      };
    }
    return result;
  } catch (cause) {
    throw committedResponseReconciliationError(cause);
  }
}
