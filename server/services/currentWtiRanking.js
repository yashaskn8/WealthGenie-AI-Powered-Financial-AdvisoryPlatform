import { buildRecommendationProfile } from './recommendationProfile.js';
import { requireFreshRecommendationState } from './recommendationState.js';
import { rankWhereToInvestBackend } from './RecommendationPipeline.js';

export function currentWtiBinding(state) {
  return {
    profileId: String(state.profile?._id || ''),
    profileVersion: Number(state.profileVersion),
    recommendationId: String(state.recommendation?._id || ''),
    allocationRevision: Number(state.allocationRevision?.revision),
    allocationRevisionId: String(state.allocationRevision?._id || ''),
    portfolioFingerprint: state.portfolioFingerprint || null,
    recommendationFingerprint: state.recommendationFingerprint || null,
  };
}

export function sameWtiBinding(left, right) {
  return Boolean(left && right)
    && left.profileId === right.profileId
    && left.profileVersion === right.profileVersion
    && left.recommendationId === right.recommendationId
    && left.allocationRevision === right.allocationRevision
    && left.allocationRevisionId === right.allocationRevisionId
    && left.portfolioFingerprint === right.portfolioFingerprint
    && left.recommendationFingerprint === right.recommendationFingerprint;
}

function conflict(code, message) {
  const error = new Error(message);
  error.status = 409;
  error.code = code;
  error.clientMessage = message;
  return error;
}

/**
 * Rank a selected parent only inside a verified current recommendation state.
 * The state is checked again after ranking so a delayed provider result cannot
 * be returned as if it belonged to a newer profile or allocation.
 */
export async function rankWtiAgainstCurrentState({
  userId,
  profileId,
  parentInstrumentId,
  expectedBinding,
  taxCalculationContext = null,
  dependencies = {},
} = {}) {
  const resolveState = dependencies.requireFreshRecommendationState || requireFreshRecommendationState;
  const rankProducts = dependencies.rankWhereToInvestBackend || rankWhereToInvestBackend;
  const profileBuilder = dependencies.buildRecommendationProfile || buildRecommendationProfile;

  const state = await resolveState({ userId, profileId });
  const initialBinding = currentWtiBinding(state);
  if (!sameWtiBinding(expectedBinding, initialBinding)) {
    throw conflict('FINANCIAL_STATE_CHANGED', 'The recommendation or allocation changed. Refresh the current plan before comparing products.');
  }

  const isCurrentRecommendationInstrument = state.currentAllocation?.instruments?.some(
    instrument => instrument?.id === parentInstrumentId,
  );
  if (!isCurrentRecommendationInstrument) {
    throw conflict('RECOMMENDATION_PARENT_MISMATCH', 'The selected category is not part of the current authoritative recommendation.');
  }

  const ranked = await rankProducts(profileBuilder(state.profile), { parentInstrumentId, taxCalculationContext });
  const finalState = await resolveState({ userId, profileId });
  const finalBinding = currentWtiBinding(finalState);
  if (!sameWtiBinding(initialBinding, finalBinding)) {
    throw conflict('FINANCIAL_STATE_CHANGED', 'The financial state changed while products were being ranked. Refresh the current plan and try again.');
  }

  return { ranked, financialStateBinding: finalBinding };
}
