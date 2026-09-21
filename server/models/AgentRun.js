import mongoose from 'mongoose';

const agentRunSchema = new mongoose.Schema({
  runId: { type: String, required: true, unique: true, immutable: true, index: true },
  agentType: { type: String, enum: ['PLAN_REVIEW'], required: true, immutable: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true, index: true },
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialProfile', default: null, immutable: true },
  recommendationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recommendation', default: null, immutable: true },
  status: { type: String, enum: ['COMPLETED', 'FAILED', 'FEATURE_UNAVAILABLE'], required: true },
  recommendedAction: { type: String, required: true },
  findingCodes: { type: [String], default: [] },
  evidenceIds: { type: [String], default: [] },
  provider: { type: String, default: 'DETERMINISTIC_FALLBACK' },
  model: { type: String, default: null },
  plannerVersion: { type: String, required: true },
  policyVersion: { type: String, required: true },
  groundingVersion: { type: String, default: null },
  traceId: { type: String, default: null },
  correlationId: { type: String, default: null },
  stepCount: { type: Number, min: 0, max: 6, required: true },
  toolCallCount: { type: Number, min: 0, max: 8, required: true },
  result: { type: mongoose.Schema.Types.Mixed, required: true },
  startedAt: { type: Date, required: true, immutable: true },
  completedAt: { type: Date, required: true },
}, {
  strict: 'throw',
  timestamps: true,
});

agentRunSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('AgentRun', agentRunSchema);
