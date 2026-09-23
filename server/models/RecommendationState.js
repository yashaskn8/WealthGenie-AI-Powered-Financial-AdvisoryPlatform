import mongoose from 'mongoose';

const recommendationStateSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialProfile', required: true, index: true },
  currentRecommendationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recommendation', required: true },
  currentAllocationRevision: { type: Number, required: true, min: 1 },
  currentAllocationRevisionId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecommendationAllocationRevision', required: true },
  generationRevision: { type: Number, required: true, min: 1 },
  profileInputHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  portfolioFingerprint: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  returnAssumptionVersion: { type: String, required: true },
  returnAssumptionHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  returnAssumptionSource: { type: String, required: true },
  financialStateFence: { type: Number, min: 0, default: 0 },
}, { timestamps: true, strict: 'throw' });

recommendationStateSchema.index({ userId: 1, profileId: 1 }, { unique: true });

export default mongoose.model('RecommendationState', recommendationStateSchema);
