import { requireFreshRecommendationState } from './recommendationState.js';
import { buildCurrentRecommendationResponse } from './recommendationResponse.js';
import { formatProfileResponse } from './profileResponse.js';
import { assessAdvisoryStateBinding } from './advisoryBinding.js';
import { PrometheusMetrics } from './metricsCollector.js';
import { resolveCurrentFinancialProfile } from './currentFinancialProfile.js';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';

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

    const state = await requireFreshRecommendationState({ userId, profileId });
    const currentId = String(state.recommendation._id);
    const committedId = String(committedRecommendationId);
    const currentGeneration = Number(state.recommendation.recommendationGeneration);
    const superseded = currentId !== committedId;
    const generationIsConsistent = Number.isSafeInteger(currentGeneration)
      && (superseded ? currentGeneration > committedGeneration : currentGeneration === committedGeneration);
    if (!generationIsConsistent) {
      const error = new Error('The verified current pointer is inconsistent with the committed recommendation generation.');
      error.code = 'POST_COMMIT_GENERATION_ORDER_INVALID';
      throw error;
    }

    const body = responseFromFreshState({ state, responseTemplate, replayed });
    if (!superseded) return body;

    PrometheusMetrics.inc('post_commit_reconciled_to_newer_recommendation_total');
    return {
      ...body,
      operation_result: {
        committed: true,
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
    const current = await resolveCurrentFinancialProfile({ userId });
    if (!current.profile || !current.recommendationState) {
      const error = new Error('No complete current profile is available after the committed profile operation.');
      error.code = 'CURRENT_FINANCIAL_PROFILE_UNAVAILABLE';
      throw error;
    }
    const state = await requireFreshRecommendationState({
      userId,
      profileId: current.profile._id,
      profile: current.profile,
    });
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
