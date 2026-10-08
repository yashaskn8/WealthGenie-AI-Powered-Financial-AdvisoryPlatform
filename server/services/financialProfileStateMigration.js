import User from '../models/User.js';
import FinancialProfile from '../models/FinancialProfile.js';
import FinancialProfileState from '../models/FinancialProfileState.js';
import RecommendationState from '../models/RecommendationState.js';
import Recommendation from '../models/Recommendation.js';
import RecommendationAllocationRevision from '../models/RecommendationAllocationRevision.js';
import AuditRecord from '../models/AuditRecord.js';

/**
 * Explicit, idempotent legacy reconciliation. It never uses timestamps to
 * choose authority and records ambiguity instead of guessing.
 */
export async function reconcileLegacyFinancialProfileStates({
  userModel = User,
  profileModel = FinancialProfile,
  stateModel = FinancialProfileState,
  recommendationStateModel = RecommendationState,
  recommendationModel = Recommendation,
  revisionModel = RecommendationAllocationRevision,
  auditModel = AuditRecord,
} = {}) {
  const users = await userModel.find({}, { _id: 1 }).lean();
  const report = { examined: users.length, created: 0, current: 0, noCurrent: 0, ambiguous: [] };
  // Complete the read-only graph validation for every user before publishing any
  // valid current-state decisions. Ambiguity markers remain explicit fail-closed writes.
  const pendingStates = [];
  for (const user of users) {
    const existing = await stateModel.findOne({ userId: user._id }).lean();
    if (existing) {
      let invalidExisting = existing.resolutionStatus === 'LEGACY_AMBIGUOUS';
      if (!invalidExisting && existing.currentProfileId) {
        const [profile, pointer] = await Promise.all([
          profileModel.findOne({ _id: existing.currentProfileId, userId: user._id }).lean(),
          recommendationStateModel.findOne({ userId: user._id, profileId: existing.currentProfileId }).lean(),
        ]);
        if (!profile || !pointer) invalidExisting = true;
        else {
          const [recommendation, revision, audit] = await Promise.all([
            recommendationModel.findOne({
              _id: pointer.currentRecommendationId, userId: user._id, profileId: existing.currentProfileId,
            }).lean(),
            revisionModel.findOne({
              _id: pointer.currentAllocationRevisionId,
              recommendationId: pointer.currentRecommendationId,
              profileId: existing.currentProfileId,
              userId: user._id,
              revision: pointer.currentAllocationRevision,
            }).lean(),
            auditModel.findOne({
              userId: user._id, profileId: existing.currentProfileId, recommendationId: pointer.currentRecommendationId,
            }).lean(),
          ]);
          invalidExisting = !recommendation || !revision || !audit
            || existing.resolutionStatus !== 'CURRENT'
            || !Number.isSafeInteger(Number(existing.revision))
            || Number(existing.revision) < 1;
        }
      } else if (!invalidExisting && (existing.currentProfileId || existing.resolutionStatus !== 'NO_CURRENT'
          || !Number.isSafeInteger(Number(existing.revision)) || Number(existing.revision) < 0)) {
        invalidExisting = true;
      }
      if (invalidExisting) {
        report.ambiguous.push({
          userId: String(user._id),
          provenProfileIds: [],
          invalidProfileIds: [],
          existingAmbiguousState: true,
        });
      }
      continue;
    }
    const profiles = await profileModel.find({ userId: user._id }, { _id: 1 }).lean();
    const profileIds = profiles.map(profile => profile._id);
    const pointerRows = profileIds.length
      ? await recommendationStateModel.find({ userId: user._id, profileId: { $in: profileIds } }).lean()
      : [];
    const proven = [];
    const invalid = [];
    for (const pointer of pointerRows) {
      const recommendation = await recommendationModel.findOne({
        _id: pointer.currentRecommendationId, userId: user._id, profileId: pointer.profileId,
      }).lean();
      const revision = await revisionModel.findOne({
        _id: pointer.currentAllocationRevisionId,
        recommendationId: pointer.currentRecommendationId,
        profileId: pointer.profileId,
        userId: user._id,
        revision: pointer.currentAllocationRevision,
      }).lean();
      const audit = await auditModel.findOne({
        userId: user._id, profileId: pointer.profileId, recommendationId: pointer.currentRecommendationId,
      }).lean();
      if (recommendation && revision && audit) proven.push(pointer.profileId);
      else invalid.push(String(pointer.profileId));
    }
    if (invalid.length || proven.length > 1 || (profileIds.length > 0 && proven.length !== 1)) {
      const details = { userId: String(user._id), provenProfileIds: proven.map(String), invalidProfileIds: invalid };
      report.ambiguous.push(details);
      pendingStates.push({
        userId: user._id, currentProfileId: null, revision: 0, promotionFence: 0,
        resolutionStatus: 'LEGACY_AMBIGUOUS',
      });
      continue;
    }
    const currentProfileId = proven[0] || null;
    pendingStates.push({
      userId: user._id,
      currentProfileId,
      revision: currentProfileId ? 1 : 0,
      promotionFence: 0,
      resolutionStatus: currentProfileId ? 'CURRENT' : 'NO_CURRENT',
    });
  }
  if (report.ambiguous.length) {
    for (const state of pendingStates) {
      if (state.resolutionStatus !== 'LEGACY_AMBIGUOUS') continue;
      await stateModel.create(state);
      report.created += 1;
    }
    const error = new Error('Legacy FinancialProfileState reconciliation found ambiguous or incomplete authoritative graphs. Operator review is required.');
    error.code = 'FINANCIAL_PROFILE_STATE_LEGACY_AMBIGUOUS';
    error.report = report;
    throw error;
  }
  for (const state of pendingStates) {
    await stateModel.create(state);
    report.created += 1;
    if (state.resolutionStatus === 'CURRENT') report.current += 1;
    else report.noCurrent += 1;
  }
  return report;
}
