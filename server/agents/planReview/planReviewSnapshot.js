import FinancialProfile from '../../models/FinancialProfile.js';
import FinancialProfileState from '../../models/FinancialProfileState.js';
import { buildRecommendationProfile } from '../../services/recommendationProfile.js';
import { resolveCurrentRecommendationState } from '../../services/recommendationState.js';
import { resolveCurrentFinancialProfile } from '../../services/currentFinancialProfile.js';
import { buildPlanReviewSnapshotBinding, hashPlanReviewSnapshot } from './planReviewRuntime.js';

function notFoundError() {
  const error = new Error('Financial profile not found or access denied.');
  error.status = 404;
  error.code = 'PROFILE_NOT_FOUND';
  return error;
}

export async function resolvePlanReviewSnapshot({
  userId,
  profileId,
  profileModel = FinancialProfile,
  profileStateModel = FinancialProfileState,
  session = null,
  dependencies = {},
} = {}) {
  if (!userId || !profileId) throw notFoundError();
  const canonical = await resolveCurrentFinancialProfile({
    userId,
    stateModel: profileStateModel,
    profileModel,
    session,
    requireRecommendation: false,
  });
  if (!canonical.profile || String(canonical.profile._id) !== String(profileId)) {
    const error = new Error('PlanReview source profile is no longer the canonical current profile.');
    error.status = 409;
    error.code = 'PLAN_REVIEW_SOURCE_SUPERSEDED';
    throw error;
  }
  let profileQuery = profileModel.findOne({ _id: profileId, userId });
  if (session && typeof profileQuery?.session === 'function') profileQuery = profileQuery.session(session);
  const storedProfile = await profileQuery.lean();
  if (!storedProfile) throw notFoundError();

  const canonicalProfile = buildRecommendationProfile(storedProfile);
  const resolveState = dependencies.resolveCurrentRecommendationState || resolveCurrentRecommendationState;
  const currentState = await resolveState({
    userId,
    profileId,
    profile: session ? null : storedProfile,
    session,
    requireFresh: false,
    dependencies: {
      ...dependencies,
      profileModel,
    },
  });
  const stateWithCanonicalProfile = {
    ...currentState,
    profile: currentState?.profile || storedProfile || canonicalProfile,
  };
  const sourceBinding = buildPlanReviewSnapshotBinding({
    userId,
    profileId,
    financialProfileStateRevision: canonical.state.revision,
    currentState: stateWithCanonicalProfile,
    freshness: currentState?.freshness,
  });
  return {
    profile: storedProfile,
    canonicalProfile,
    currentState: stateWithCanonicalProfile,
    sourceBinding,
    planReviewSnapshotHash: hashPlanReviewSnapshot(sourceBinding),
  };
}

export { notFoundError as planReviewProfileNotFoundError };
