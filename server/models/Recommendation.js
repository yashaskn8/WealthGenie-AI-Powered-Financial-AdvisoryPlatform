import mongoose from 'mongoose';

const instrumentDetailSchema = new mongoose.Schema({
  id: String,
  name: String,
  type: String,
  assetClass: String,
  nominalReturn: Number,
  postTaxReturn: Number,
  effectiveYield: Number,
  returnBasis: String,
  expenseRatio: Number,
  riskLevel: String,
  riskScore: Number,
  lockIn: Number,
  tags: [String],
  taxNotes: String,
  sharpeRatio: Number,
  score: Number,
  scoreFactors: mongoose.Schema.Types.Mixed,
  allocation_pct: Number,
  allocationWeight: Number,
}, { _id: false });

const recommendationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialProfile', required: true },
  instruments: [instrumentDetailSchema],
  advisoryText: { type: String },
  confidenceScores: {
    type: Map,
    of: { type: Number, min: 0, max: 1 },
    default: {},
  },
  mlFallback: { type: Boolean, default: false },
  modelVersion: { type: String, default: '1.0' },
  idempotencyOperationId: { type: String, default: null },
  idempotencyRequestHash: { type: String, default: null },
  responseSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  generatedAt: { type: Date, default: Date.now },
});

recommendationSchema.index({ userId: 1, generatedAt: -1 });
recommendationSchema.index({ profileId: 1 });
recommendationSchema.index(
  { idempotencyOperationId: 1 },
  {
    name: 'unique_advisory_idempotency_operation',
    unique: true,
    partialFilterExpression: { idempotencyOperationId: { $type: 'string' } },
  },
);

export default mongoose.model('Recommendation', recommendationSchema);
