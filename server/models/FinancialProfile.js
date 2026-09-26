import mongoose from 'mongoose';
import { assessSuitabilityRisk } from '../services/riskProfiler.js';
import { optionalUniqueIndex } from '../config/mongoCompatibility.js';
import { protectImmutableIdentity } from './immutableIdentity.js';

const CORE_GOALS = ['Retirement', 'Wealth Growth', 'Tax Saving', 'Emergency Fund'];
const RISK_LEVELS = ['Conservative', 'Conservative-Moderate', 'Moderate', 'Moderate-Aggressive', 'Aggressive'];

const financialProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  idempotencyOperationId: { type: String, immutable: true },
  idempotencyRequestHash: { type: String, immutable: true, match: /^[a-f0-9]{64}$/ },

  // Frozen canonical profile. Supplemental facts are stored as explicit nulls
  // when users leave them unknown; they are never imputed as zero.
  monthlyTakeHome: { type: Number, min: 0, max: 100000000, required: true },
  monthlySavings: { type: Number, min: 0, max: 100000000, required: true },
  age: { type: Number, min: 18, max: 80, required: true, validate: Number.isInteger },
  riskTolerance: { type: String, enum: ['Conservative', 'Moderate', 'Aggressive'], required: true },
  soldPropertyProceeds: { type: Number, min: 0, max: 10000000000, default: null },
  hasLumpSum: { type: Boolean, default: null },
  lumpSumAmount: { type: Number, min: 0, max: 10000000000, default: null },
  liquidSavings: { type: Number, min: 0, max: 1000000000, default: null },
  emiBurdenPct: { type: Number, min: 0, max: 100, default: null },
  financialDependents: { type: Number, min: 0, max: 15, default: null, validate: {
    validator: value => value === null || Number.isInteger(value),
    message: 'Financial dependents must be a whole number when provided.',
  } },
  emergencyFundMonths: { type: Number, min: 0, max: 120, default: null },
  investmentGoals: { type: [{ type: String, enum: CORE_GOALS }], required: true },
  investmentHorizonYears: { type: Number, min: 1, max: 30, required: true, validate: Number.isInteger },
  recommendationProfileVersion: { type: String, enum: ['financial-profile-1.0.0', 'financial-profile-1.1.0'], required: true },

  // Auditable deterministic suitability output (not independent user inputs).
  riskCapacityScore: { type: Number, min: 0, max: 100, required: true },
  riskCapacityLevel: { type: Number, min: 1, max: 5, required: true },
  finalSuitabilityRisk: { type: String, enum: RISK_LEVELS, required: true },
  suitabilityReasonCodes: {
    type: [{ type: String }],
    required: true,
    validate: value => Array.isArray(value) && value.length > 0,
  },

  version: { type: Number, default: 1 },
  // Shared write fence for profile changes and financial work committed
  // against this source, so overlapping transactions conflict reliably.
  financialStateFence: { type: Number, min: 0, default: 0 },
  planReviewPublicationFence: { type: Number, min: 0, default: 0 },
  createdAt: { type: Date, default: Date.now },
}, {
  optimisticConcurrency: true,
  timestamps: false,
  toObject: { getters: true, virtuals: true },
  toJSON: { getters: true, virtuals: true },
  strict: 'throw',
});

financialProfileSchema.pre('validate', function validateFrozenRelationships(next) {
  if (this.monthlyTakeHome !== undefined && !(this.monthlyTakeHome > 0)) {
    this.invalidate('monthlyTakeHome', 'Monthly take-home must be greater than 0.');
  }
  if (this.monthlySavings !== undefined && !(this.monthlySavings > 0)) {
    this.invalidate('monthlySavings', 'Monthly savings must be greater than 0.');
  }
  if (this.monthlyTakeHome !== undefined && this.monthlySavings !== undefined
      && this.monthlySavings >= this.monthlyTakeHome) {
    this.invalidate('monthlySavings', 'Monthly savings must be less than monthly take-home.');
  }
  if (this.hasLumpSum === false && this.lumpSumAmount !== 0) {
    this.invalidate('lumpSumAmount', 'Lump sum amount must be 0 when no lump sum is available.');
  }
  if (this.hasLumpSum === true && !(this.lumpSumAmount > 0)) {
    this.invalidate('lumpSumAmount', 'Lump sum amount must be greater than 0 when a lump sum is available.');
  }
  if (this.hasLumpSum === null && this.lumpSumAmount !== null) {
    this.invalidate('lumpSumAmount', 'Lump sum amount must be null when one-time capital is unknown.');
  }
  if (Array.isArray(this.investmentGoals)
      && new Set(this.investmentGoals).size !== this.investmentGoals.length) {
    this.invalidate('investmentGoals', 'Investment goals must not contain duplicates.');
  }
  if (!Array.isArray(this.investmentGoals) || this.investmentGoals.length === 0) {
    this.invalidate('investmentGoals', 'At least one investment goal is required.');
  }
  try {
    const suitability = assessSuitabilityRisk(this.toObject({ virtuals: false }));
    this.riskCapacityScore = suitability.capacityScore;
    this.riskCapacityLevel = suitability.capacityLevel;
    this.finalSuitabilityRisk = suitability.finalRisk;
    this.suitabilityReasonCodes = [...suitability.reasonCodes];
  } catch (error) {
    this.invalidate('recommendationProfileVersion', `Canonical suitability could not be derived: ${error.message}`);
  }
  next();
});

financialProfileSchema.index({ userId: 1, createdAt: -1 });
const idempotencyIndex = optionalUniqueIndex('idempotencyOperationId', 'unique_profile_create_idempotency_operation');
financialProfileSchema.index(idempotencyIndex.key, idempotencyIndex.options);

protectImmutableIdentity(financialProfileSchema, ['userId'], {
  code: 'FINANCIAL_PROFILE_IDENTITY_IMMUTABLE',
  label: 'Financial profile ownership',
});

export default mongoose.model('FinancialProfile', financialProfileSchema);
