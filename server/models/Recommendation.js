import mongoose from 'mongoose';

const scoreFactorSchema = new mongoose.Schema({
  expectedReturn: { type: Number, min: 0, max: 100, required: true },
  riskFit: { type: Number, min: 0, max: 100, required: true },
  liquidity: { type: Number, min: 0, max: 100, required: true },
  goalFit: { type: Number, min: 0, max: 100, required: true },
  horizonFit: { type: Number, min: 0, max: 100, required: true },
  cost: { type: Number, min: 0, max: 100, required: true },
  mlConfidence: { type: Number, min: 0, max: 100, required: true },
}, { _id: false, strict: 'throw' });

const instrumentDetailSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  type: { type: String, required: true },
  assetClass: { type: String, required: true },
  nominalReturn: { type: Number, min: -100, max: 100, required: true },
  postTaxReturn: { type: Number, default: null },
  effectiveYield: { type: Number, min: -100, max: 100, required: true },
  returnBasis: { type: String, enum: ['PRE_TAX_NOMINAL'], required: true },
  returnDataClass: { type: String, enum: ['MODEL_ASSUMPTION'], default: 'MODEL_ASSUMPTION', required: true },
  returnAssumptionVersion: { type: String, default: 'wealthgenie-projection-assumptions-1.0.0', required: true },
  returnSource: { type: String, enum: ['WEALTHGENIE_MODEL_POLICY'], default: 'WEALTHGENIE_MODEL_POLICY', required: true },
  observedMarketFact: { type: Boolean, enum: [false], default: false, required: true },
  providerForecast: { type: Boolean, enum: [false], default: false, required: true },
  expenseRatio: { type: Number, min: 0, max: 1, required: true },
  riskLevel: { type: String, required: true },
  riskScore: { type: Number, min: 1, max: 5, required: true },
  lockIn: { type: Number, min: 0, max: 100, required: true },
  tags: { type: [String], required: true },
  taxNotes: String,
  sharpeRatio: Number,
  score: { type: Number, min: 0, max: 100, required: true },
  scoreFactors: { type: scoreFactorSchema, required: true },
  allocation_pct: { type: Number, min: 0, max: 100, required: true },
  allocationWeight: { type: Number, min: 0, max: 1, required: true },
}, { _id: false, strict: 'throw' });

const recommendationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialProfile', required: true },
  instruments: [instrumentDetailSchema],
  advisoryText: { type: String },
  advisoryMetadata: { type: mongoose.Schema.Types.Mixed, default: null },
  confidenceScores: {
    type: Map,
    of: { type: Number, min: 0, max: 1 },
    default: {},
  },
  mlFallback: { type: Boolean, required: true },
  modelVersion: { type: String, required: true },
  profileInputHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  idempotencyOperationId: { type: String, default: null },
  idempotencyRequestHash: { type: String, default: null },
  responseSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  marketAdjustment: { type: mongoose.Schema.Types.Mixed, default: null },
  generatedAt: { type: Date, default: Date.now },
}, { strict: 'throw' });

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

recommendationSchema.pre('validate', function validateAuthoritativeRecommendation(next) {
  if (!Array.isArray(this.instruments) || this.instruments.length === 0) {
    this.invalidate('instruments', 'At least one authoritative instrument is required.');
    return next();
  }
  const ids = this.instruments.map(instrument => instrument.id);
  if (new Set(ids).size !== ids.length) this.invalidate('instruments', 'Instrument ids must be unique.');
  const totalWeight = this.instruments.reduce((sum, instrument) => sum + Number(instrument.allocationWeight), 0);
  if (!Number.isFinite(totalWeight) || Math.abs(totalWeight - 1) > 0.001) {
    this.invalidate('instruments', 'Instrument allocation weights must total 1.');
  }
  for (const instrument of this.instruments) {
    if (instrument.postTaxReturn !== null) {
      this.invalidate('instruments', 'Personalized recommendations must not persist post-tax returns.');
    }
    if (Math.abs(Number(instrument.allocation_pct) - Number(instrument.allocationWeight) * 100) > 0.011) {
      this.invalidate('instruments', `Allocation representations disagree for ${instrument.id}.`);
    }
    if (Number(instrument.effectiveYield) !== Number(instrument.nominalReturn)) {
      this.invalidate('instruments', `Effective yield must remain pre-tax nominal for ${instrument.id}.`);
    }
  }
  next();
});

export default mongoose.model('Recommendation', recommendationSchema);
