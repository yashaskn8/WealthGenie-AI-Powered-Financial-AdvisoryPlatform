import Joi from 'joi';
import { sendError } from '../middleware/errorHandler.js';

/**
 * Validation for non-Financial-Profile APIs.
 * Profile, recommendation, WTI, portfolio, projection, Monte Carlo, and goal
 * schemas live in financialSchemas.js so legacy fields cannot re-enter those paths.
 */
export const registerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  email: Joi.string().trim().lowercase().email().max(254).required(),
  mobile: Joi.string().trim().pattern(/^[6-9]\d{9}$/).optional(),
  password: Joi.string().min(8).max(128).required()
    .pattern(/[A-Z]/, 'uppercase')
    .pattern(/[a-z]/, 'lowercase')
    .pattern(/[0-9]/, 'digit')
    .pattern(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/, 'special character'),
}).unknown(false);

export const loginSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required(),
  password: Joi.string().min(1).required(),
}).unknown(false);

export const chatMessageSchema = Joi.object({
  message: Joi.string().trim().min(1).max(1000).required(),
  session_id: Joi.string().max(100).optional(),
}).unknown(false);

const taxFields = {
  income: Joi.number().min(0).max(1000000000).required(),
  incomeSource: Joi.string().valid('salary', 'pension', 'family_pension', 'business', 'other').required(),
  section80C: Joi.number().min(0).max(150000).optional(),
  nps80CCD1B: Joi.number().min(0).max(50000).optional(),
  nps80CCD2: Joi.number().min(0).max(100000000).optional(),
  basicSalary: Joi.number().min(0).max(1000000000).optional(),
  isGovtEmployee: Joi.boolean().optional(),
  section80D: Joi.number().min(0).max(100000).optional(),
  section80D_self: Joi.number().min(0).max(50000).optional(),
  section80D_parents: Joi.number().min(0).max(50000).optional(),
  parents_senior: Joi.boolean().optional(),
  self_senior: Joi.boolean().optional(),
  hra: Joi.number().min(0).max(100000000).optional(),
  homeLoanInterest: Joi.number().min(0).max(200000).optional(),
  other: Joi.number().min(0).max(100000000).optional(),
  age: Joi.number().integer().min(18).max(120).optional(),
  fiscalYear: Joi.string().valid('FY2025-26', 'FY2026-27').optional(),
};

function requireTaxDependencyFacts(value, helpers) {
  if (Number(value.nps80CCD2) > 0
      && (!Number.isFinite(value.basicSalary) || typeof value.isGovtEmployee !== 'boolean')) {
    return helpers.message({ custom: 'basicSalary and isGovtEmployee are required when nps80CCD2 is claimed' });
  }
  const healthDeduction = Number(value.section80D || 0)
    + Number(value.section80D_self || 0) + Number(value.section80D_parents || 0);
  if (healthDeduction > 0 && !Number.isInteger(value.age)) {
    return helpers.message({ custom: 'age is required when a Section 80D deduction is claimed' });
  }
  if (Number(value.section80D_parents) > 0 && typeof value.parents_senior !== 'boolean') {
    return helpers.message({ custom: 'parents_senior is required when a parents Section 80D deduction is claimed' });
  }
  return value;
}

export const taxCompareSchema = Joi.object(taxFields).custom(requireTaxDependencyFacts).unknown(false);
export const taxComputeSchema = Joi.object({
  ...taxFields,
  regime: Joi.string().valid('new', 'old').required(),
}).custom(requireTaxDependencyFacts).unknown(false);

const postTaxInstrumentSchema = Joi.object({
  instrumentType: Joi.string().trim().min(1).max(50).required(),
  nominalRate: Joi.number().min(0).max(1).required(),
  holdingYears: Joi.number().min(0.01).max(100).required(),
  monthlySIP: Joi.number().min(0).max(100000000).required(),
}).unknown(false);

export const postTaxReturnSchema = postTaxInstrumentSchema.keys({
  annualIncome: Joi.number().min(0).max(1000000000).required(),
  regime: Joi.string().valid('new', 'old').required(),
  userAge: Joi.number().integer().min(0).max(120).required(),
  incomeSource: Joi.string().valid('salary', 'pension', 'family_pension', 'business', 'other').required(),
});

export const postTaxReturnBatchSchema = Joi.object({
  instruments: Joi.array().items(postTaxInstrumentSchema).min(1).max(50).required(),
  annualIncome: Joi.number().min(0).max(1000000000).required(),
  regime: Joi.string().valid('new', 'old').required(),
  userAge: Joi.number().integer().min(0).max(120).required(),
  incomeSource: Joi.string().valid('salary', 'pension', 'family_pension', 'business', 'other').required(),
  inflationRate: Joi.number().min(0).max(1).required(),
}).unknown(false);

export const marketContextQuerySchema = Joi.object({}).unknown(false);

export const marketNavQuerySchema = Joi.object({
  schemeCodes: Joi.string()
    .trim()
    .pattern(/^\d+(,\d+){0,49}$/)
    .max(600)
    .required(),
}).unknown(false);

export const regimeAdjustSchema = Joi.object({
  profileId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).message('Invalid ID format').required(),
}).unknown(false);

function createValidator(schema, property) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: false,
      convert: true,
    });
    if (error) {
      return sendError(
        req,
        res,
        400,
        'Validation failed',
        'VALIDATION_ERROR',
        error.details.map(detail => detail.message),
      );
    }
    req[property] = value;
    next();
  };
}

export function validate(schema) {
  return createValidator(schema, 'body');
}

export function validateQuery(schema) {
  return createValidator(schema, 'query');
}
