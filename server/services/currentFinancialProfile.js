import mongoose from 'mongoose';
import FinancialProfile from '../models/FinancialProfile.js';
import FinancialProfileState from '../models/FinancialProfileState.js';
import RecommendationState from '../models/RecommendationState.js';
import IdempotencyKey from '../models/IdempotencyKey.js';
import { createError } from '../middleware/errorHandler.js';

function stateError(code = 'FINANCIAL_PROFILE_STATE_UNAVAILABLE') {
  return createError(
    503,
    'The canonical financial profile state cannot be verified.',
    'Your financial profile is temporarily unavailable. Please retry after the account state is reconciled.',
    { code },
  );
}

/** Resolve currentness only from the persisted user-level pointer; never infer it from timestamps. */
export async function resolveCurrentFinancialProfile({
  userId,
  stateModel = FinancialProfileState,
  profileModel = FinancialProfile,
  recommendationStateModel = RecommendationState,
  session = null,
  requireRecommendation = true,
} = {}) {
  if (!mongoose.isValidObjectId(userId)) throw stateError();
  let stateQuery = stateModel.findOne({ userId });
  if (session && stateQuery.session) stateQuery = stateQuery.session(session);
  const state = await stateQuery.lean();
  if (!state || state.resolutionStatus === 'LEGACY_AMBIGUOUS') throw stateError();
  if (!Number.isSafeInteger(Number(state.revision)) || Number(state.revision) < 0
      || !Number.isSafeInteger(Number(state.promotionFence)) || Number(state.promotionFence) < 0) throw stateError();
  if (!state.currentProfileId) {
    if (state.resolutionStatus !== 'NO_CURRENT') throw stateError();
    return { state, profile: null, recommendationState: null };
  }
  if (state.resolutionStatus !== 'CURRENT' || Number(state.revision) < 1) throw stateError();

  let profileQuery = profileModel.findOne({ _id: state.currentProfileId, userId });
  if (session && profileQuery.session) profileQuery = profileQuery.session(session);
  const profile = await profileQuery.lean();
  if (!profile) throw stateError();

  let recommendationState = null;
  if (requireRecommendation) {
    let recommendationQuery = recommendationStateModel.findOne({
      userId,
      profileId: state.currentProfileId,
    });
    if (session && recommendationQuery.session) recommendationQuery = recommendationQuery.session(session);
    recommendationState = await recommendationQuery.lean();
    if (!recommendationState?.currentRecommendationId
        || !recommendationState?.currentAllocationRevisionId
        || !Number.isSafeInteger(Number(recommendationState.currentAllocationRevision))) {
      throw stateError('FINANCIAL_PROFILE_STATE_INCOMPLETE');
    }
  }
  return { state, profile, recommendationState };
}

export async function requireCurrentFinancialProfile({ userId, profileId, ...options } = {}) {
  const profileModel = options.profileModel || FinancialProfile;
  if (profileId && !await profileModel.exists({ _id: profileId, userId })) {
    throw createError(404, 'Profile not found or access denied.', 'Financial profile not found.', { code: 'PROFILE_NOT_FOUND' });
  }
  const current = await resolveCurrentFinancialProfile({
    userId,
    requireRecommendation: false,
    ...options,
  });
  if (!current.profile || String(current.profile._id) !== String(profileId)) {
    throw createError(
      409,
      'The requested profile is no longer the user’s canonical current profile.',
      'Refresh the current financial profile before continuing.',
      {
        code: 'PROFILE_STATE_VERSION_CONFLICT',
        details: {
          requestedProfileId: profileId ? String(profileId) : null,
          currentProfileId: current.profile?._id ? String(current.profile._id) : null,
          profileStateRevision: current.state?.revision ?? null,
        },
      },
    );
  }
  return current;
}

/** Safe initial state creation is permitted only for an account with no profile history. */
export async function captureProfileStateForCompletion({ userId, stateModel = FinancialProfileState, profileModel = FinancialProfile } = {}) {
  let state = await stateModel.findOne({ userId }).lean();
  if (!state) {
    const [hasUnprovenLegacyProfile, hasPreviouslyCompletedProfile] = await Promise.all([
      profileModel.exists({
        userId,
        $or: [
          { idempotencyOperationId: { $exists: false } },
          { idempotencyOperationId: null },
        ],
      }),
      IdempotencyKey.exists({ userId, operation: 'profile.complete', status: 'DONE' }),
    ]);
    // A profile/build operation creates a durable draft, not a canonical
    // current profile. It is safe to initialize NO_CURRENT when all existing
    // records are proven drafts and there is no prior completed profile.
    // Unproven legacy profiles and lost pointers after a completion fail closed.
    if (hasUnprovenLegacyProfile || hasPreviouslyCompletedProfile) {
      throw stateError('FINANCIAL_PROFILE_STATE_MIGRATION_REQUIRED');
    }
    try {
      state = await stateModel.findOneAndUpdate(
        { userId },
        { $setOnInsert: { userId, currentProfileId: null, revision: 0, resolutionStatus: 'NO_CURRENT' } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();
    } catch (error) {
      if (error?.code !== 11000) throw error;
      state = await stateModel.findOne({ userId }).lean();
    }
  }
  if (!state || state.resolutionStatus === 'LEGACY_AMBIGUOUS') throw stateError();
  return { revision: Number(state.revision), currentProfileId: state.currentProfileId || null };
}
