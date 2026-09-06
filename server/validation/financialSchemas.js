import Joi from 'joi';

const objectId = Joi.string().pattern(/^[0-9a-fA-F]{24}$/).message('Invalid ID format');
const investmentGoals = ['Retirement', 'Wealth Growth', 'Tax Saving', 'Emergency Fund'];

export const recommendationRequestSchema = Joi.object({
  profileId: objectId.required(),
}).unknown(false);

export const recommendationWeightsSchema = Joi.object({
  profileId: objectId.required(),
  weights: Joi.object().pattern(
    Joi.string().trim().min(1).max(100),
    Joi.number().min(0).max(1),
  ).min(1).max(30).required(),
}).custom((value, helpers) => {
  const total = Object.values(value.weights).reduce((sum, weight) => sum + weight, 0);
  return Math.abs(total - 1) <= 0.0001
    ? value
    : helpers.message({ custom: 'Recommendation weights must sum to exactly 1' });
}).unknown(false);

export const financialProfileSchema = Joi.object({
  monthly_take_home: Joi.number().min(1000).max(100000000).required(),
  monthly_savings: Joi.number().min(500).max(100000000).required(),
  age: Joi.number().integer().min(18).max(80).required(),
  risk_tolerance: Joi.string().valid('Conservative', 'Moderate', 'Aggressive').required(),
  sold_property_proceeds: Joi.number().min(0).max(10000000000).required(),
  has_lump_sum: Joi.boolean().required(),
  lump_sum_amount: Joi.when('has_lump_sum', {
    is: true,
    then: Joi.number().greater(0).max(10000000000).required(),
    otherwise: Joi.number().valid(0).required(),
  }),
  liquid_savings: Joi.number().min(0).max(1000000000).required(),
  emi_burden_pct: Joi.number().min(0).max(100).required(),
  financial_dependents: Joi.number().integer().min(0).max(15).required(),
  emergency_fund_months: Joi.number().min(0).max(120).required(),
  investment_goals: Joi.array()
    .items(Joi.string().valid(...investmentGoals))
    .min(1).max(investmentGoals.length).unique().required(),
  investment_horizon_years: Joi.number().integer().min(1).max(30).required(),
  version: Joi.number().integer().min(1).optional(),
}).custom((value, helpers) => {
  if (value.monthly_savings >= value.monthly_take_home) {
    return helpers.message({ custom: 'Monthly savings must be less than monthly take-home' });
  }
  return value;
}).unknown(false);

export const financialProfileUpdateSchema = financialProfileSchema.keys({
  version: Joi.number().integer().min(1).required(),
});

export const rankWtiProfileSchema = Joi.object({
  profileId: objectId.required(),
  parentInstrumentId: Joi.string().trim().max(50).required(),
  candidates: Joi.array().items(Joi.object({
    id: Joi.string().trim().max(100).optional(),
    name: Joi.string().trim().max(100).required(),
    highlight: Joi.string().max(200).optional(),
    badge: Joi.string().max(100).optional(),
    provider: Joi.string().max(100).optional(),
    platform: Joi.string().max(100).optional(),
    minInvestment: Joi.string().max(50).optional(),
    tenure: Joi.string().max(50).optional(),
  }).unknown(false)).min(1).max(50).required(),
}).unknown(false);

export const personalizedProjectionSchema = Joi.object({
  profileId: objectId.required(),
  instruments: Joi.array().items(Joi.string().trim().max(50)).min(1).max(10).required(),
  monthly_investment: Joi.number().min(500).max(10000000).required(),
  years: Joi.array().items(Joi.number().integer().min(1).max(30)).min(1).max(10).unique().required(),
}).unknown(false);

export const personalizedMonteCarloSchema = Joi.object({
  profileId: objectId.required(),
  instrument: Joi.string().trim().max(50).required(),
  monthly_investment: Joi.number().min(500).max(10000000).required(),
  years: Joi.number().integer().min(1).max(30).required(),
  target_amount: Joi.number().min(1000).max(10000000000).optional(),
}).unknown(false);

export const personalizedOptimiseSchema = Joi.object({
  profileId: objectId.required(),
  assets: Joi.array().items(Joi.string().trim().max(50)).min(2).max(20).unique().required(),
  strategy: Joi.string().valid('min_variance', 'max_sharpe', 'risk_parity').required(),
}).unknown(false);

export const personalizedRebalanceSchema = Joi.object({
  profileId: objectId.required(),
  current_allocation: Joi.object().pattern(Joi.string(), Joi.number().min(0).max(1000000000)).min(1).max(30).required(),
  target_allocation: Joi.object().pattern(Joi.string(), Joi.number().min(0).max(100)).min(1).max(30).required(),
  threshold: Joi.number().min(0).max(50).required(),
  partial_ratio: Joi.number().min(0.1).max(1).required(),
  holding_months: Joi.number().min(0).max(600).required(),
}).unknown(false);

export const customGoalSchema = Joi.object({
  goal_name: Joi.string().trim().min(2).max(100).required(),
  target_amount: Joi.number().min(1000).max(10000000000).required(),
  target_date: Joi.date().iso().required(),
  current_savings: Joi.number().min(0).max(10000000000).required(),
  profileId: objectId.required(),
  priority: Joi.string().valid('Critical', 'High', 'Medium', 'Low').required(),
}).unknown(false);

export const customGoalUpdateSchema = Joi.object({
  target_amount: Joi.number().min(1000).max(10000000000).optional(),
  current_savings: Joi.number().min(0).max(10000000000).optional(),
  priority: Joi.string().valid('Critical', 'High', 'Medium', 'Low').optional(),
}).min(1).unknown(false);

export function validateStrict(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: false,
      convert: true,
    });
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: error.details.map(detail => detail.message),
      });
    }
    req.body = value;
    next();
  };
}
