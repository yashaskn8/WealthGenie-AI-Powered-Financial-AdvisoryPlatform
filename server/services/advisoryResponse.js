import { requireFreshRecommendationState } from './recommendationState.js';
import { buildCurrentRecommendationResponse } from './recommendationResponse.js';
import { formatProfileResponse } from './profileResponse.js';
import { assessAdvisoryStateBinding } from './advisoryBinding.js';

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

/** Rebuild a request/replay response from the canonical pointer, never a cached snapshot. */
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

  if (responseTemplate?.completion && responseTemplate?.profile) {
    return {
      profile: formatProfileResponse(state.profile),
      recommendation: recommendationBody,
      completion: {
        ...responseTemplate.completion,
        status: 'COMMITTED',
        replayed,
        profileId: String(state.profile._id),
        recommendationId: String(recommendation._id),
      },
    };
  }
  return recommendationBody;
}
