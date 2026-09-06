import mongoose from 'mongoose';

const CORE_GOALS = ['Retirement', 'Wealth Growth', 'Tax Saving', 'Emergency Fund'];
const RISK_LEVELS = ['Conservative', 'Conservative-Moderate', 'Moderate', 'Moderate-Aggressive', 'Aggressive'];

const financialProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Frozen canonical financial profile. API writes always populate these fields.
  monthlyTakeHome: { type: Number, min: 1000, max: 100000000, required: true },
  monthlySavings: { type: Number, min: 500, max: 100000000, required: true },
  age: { type: Number, min: 18, max: 80, required: true, validate: Number.isInteger },
  riskTolerance: { type: String, enum: ['Conservative', 'Moderate', 'Aggressive'], required: true },
  soldPropertyProceeds: { type: Number, min: 0, max: 10000000000, required: true },
  hasLumpSum: { type: Boolean, required: true },
  lumpSumAmount: { type: Number, min: 0, max: 10000000000, required: true },
  liquidSavings: { type: Number, min: 0, max: 1000000000, required: true },
  emiBurdenPct: { type: Number, min: 0, max: 100, required: true },
  financialDependents: { type: Number, min: 0, max: 15, required: true, validate: Number.isInteger },
  emergencyFundMonths: { type: Number, min: 0, max: 120, required: true },
  investmentGoals: { type: [{ type: String, enum: CORE_GOALS }], required: true },
  investmentHorizonYears: { type: Number, min: 1, max: 30, required: true, validate: Number.isInteger },
  recommendationProfileVersion: { type: String, required: true },

  // Auditable deterministic suitability output (not independent user inputs).
  riskCapacityScore: { type: Number, min: 0, max: 100 },
  riskCapacityLevel: { type: Number, min: 1, max: 5 },
  finalSuitabilityRisk: { type: String, enum: RISK_LEVELS },
  suitabilityReasonCodes: [{ type: String }],

  // Equivalent legacy aliases retained only for old readers/migration. Sensitive
  // recommendation code must go through buildRecommendationProfile().
  monthlyIncome: { type: Number, min: 0 },
  savings: { type: Number, min: 0 },
  investmentHorizon: { type: Number, min: 1, max: 40 },
  liquid_savings: { type: Number, min: 0 },
  existing_debt_emi_ratio_pct: { type: Number, min: 0, max: 100 },
  dependents: { type: Number, min: 0 },
  emergency_fund_months: { type: Number, min: 0 },
  risk_tolerance: { type: String, enum: ['Conservative', 'Moderate', 'Aggressive'] },
  goals: { type: [{ type: String }], default: undefined },
  soldPropertyAmount: { type: Number, min: 0, max: 10000000000 },
  investableAmount: { type: Number, min: 0 },
  oneTimeInvestableAmount: { type: Number, min: 0 },

  // Historical tax-module fields are preserved for old records, but excluded
  // from ordinary queries and never generated from the frozen profile.
  annualIncome: { type: Number, min: 0, select: false },
  totalCTC: { type: Number, min: 0, select: false },
  basicComponent: { type: Number, min: 0, select: false },
  taxRegime: { type: String, enum: ['new', 'old'], select: false },
  taxSlabDecimal: { type: Number, min: 0, max: 1, select: false },
  effectiveTaxRatePercent: { type: Number, min: 0, max: 100, select: false },
  section80C: { type: Number, min: 0, max: 150000, select: false },
  section80CCD1B: { type: Number, min: 0, max: 50000, select: false },
  section80D_self: { type: Number, min: 0, max: 50000, select: false },
  section80D_parents: { type: Number, min: 0, max: 50000, select: false },
  parentsSenior: { type: Boolean, select: false },
  hra: { type: Number, min: 0, max: 10000000, select: false },
  homeLoanInterest: { type: Number, min: 0, max: 200000, select: false },
  section80EEA: { type: Number, min: 0, max: 150000, select: false },
  incomeSource: { type: String, enum: ['salary', 'pension', 'family_pension', 'other'], select: false },

  // Removed second goal system: retained only to read historical documents.
  goal_type: { type: String, select: false },
  lastGoalCreatedAt: { type: Date, select: false },
  version: { type: Number, default: 1 },
  createdAt: { type: Date, default: Date.now },
}, {
  optimisticConcurrency: true,
  timestamps: false,
  toObject: { getters: true, virtuals: true },
  toJSON: { getters: true, virtuals: true },
});

financialProfileSchema.pre('validate', function validateFrozenRelationships(next) {
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
  if (Array.isArray(this.investmentGoals)
      && new Set(this.investmentGoals).size !== this.investmentGoals.length) {
    this.invalidate('investmentGoals', 'Investment goals must not contain duplicates.');
  }
  if (!Array.isArray(this.investmentGoals) || this.investmentGoals.length === 0) {
    this.invalidate('investmentGoals', 'At least one investment goal is required.');
  }
  next();
});

financialProfileSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('FinancialProfile', financialProfileSchema);
