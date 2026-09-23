import mongoose from 'mongoose';

// A revision is an append-only financial state transition.  The embedded
// instrument shape is intentionally permissive enough to preserve the
// recommendation contract while the route/service layer enforces the
// suitability and concentration invariants before a revision is created.
const allocationInstrumentSchema = new mongoose.Schema({}, {
  _id: false,
  strict: false,
});

const allocationRevisionSchema = new mongoose.Schema({
  recommendationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recommendation', required: true, index: true },
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialProfile', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  revision: { type: Number, required: true, min: 1 },
  previousRevision: { type: Number, default: null, min: 1 },
  previousAllocationRevisionId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecommendationAllocationRevision', default: null },
  source: {
    type: String,
    enum: ['ORIGINAL_RECOMMENDATION', 'MARKET_CONTEXT_ADJUSTED', 'USER_REBALANCED'],
    required: true,
  },
  instruments: { type: [allocationInstrumentSchema], required: true },
  profileInputHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  modelVersion: { type: String, required: true },
  recommendationPolicyVersion: { type: String, required: true },
  regulatoryRuleVersion: { type: String, required: true },
  returnAssumptionVersion: { type: String, required: true },
  returnAssumptionHash: { type: String, match: /^[a-f0-9]{64}$/, default: null },
  returnAssumptionSource: { type: String, required: true },
  profileVersion: { type: Number, required: true, min: 1, validate: Number.isInteger },
  portfolioFingerprint: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  recommendationFingerprint: { type: String, match: /^[a-f0-9]{64}$/, default: null },
  auditRecordId: { type: mongoose.Schema.Types.ObjectId, ref: 'AuditRecord', default: null },
  correlationId: { type: String, default: null },
  traceId: { type: String, default: null },
  createdAt: { type: Date, default: Date.now, immutable: true },
}, { strict: 'throw', versionKey: false });

allocationRevisionSchema.index({ recommendationId: 1, revision: 1 }, { unique: true });
allocationRevisionSchema.index({ userId: 1, profileId: 1, revision: -1 });

allocationRevisionSchema.pre('save', function rejectRevisionMutation(next) {
  if (!this.isNew) return next(new Error('Allocation revisions are immutable.'));
  return next();
});

for (const operation of [
  'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete', 'findByIdAndDelete', 'bulkWrite',
]) {
  allocationRevisionSchema.pre(operation, function rejectRevisionQueryMutation(next) {
    return next(new Error('Allocation revisions are append-only; query mutation is prohibited.'));
  });
}

export default mongoose.model('RecommendationAllocationRevision', allocationRevisionSchema);
