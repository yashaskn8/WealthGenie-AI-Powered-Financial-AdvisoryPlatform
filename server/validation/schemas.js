import Joi from 'joi';
import { sendError } from '../middleware/errorHandler.js';
import {
  FISCAL_YEAR_PATTERN,
  incomeSourceValues,
  requireTaxDependencyFacts,
  taxDeductionFields,
  taxDeductionSchema,
} from './taxSchemas.js';

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
  incomeSource: Joi.string().valid(...incomeSourceValues).required(),
  ...taxDeductionFields,
  fiscalYear: Joi.string().pattern(FISCAL_YEAR_PATTERN).required(),
};

export const taxCompareSchema = Joi.object(taxFields).custom(requireTaxDependencyFacts).unknown(false);
export const taxComputeSchema = Joi.object({
  ...taxFields,
  regime: Joi.string().valid('new', 'old').required(),
}).custom(requireTaxDependencyFacts).unknown(false);

const transactionDateFields = {
  acquisitionDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  redemptionDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
};

function validatePostTaxTransactionDates(value, helpers) {
  const hasAcquisition = value.acquisitionDate !== undefined;
  const hasRedemption = value.redemptionDate !== undefined;
  if (hasAcquisition !== hasRedemption) {
    return helpers.message({ custom: 'acquisitionDate and redemptionDate must be supplied together' });
  }
  if (hasAcquisition && value.redemptionDate < value.acquisitionDate) {
    return helpers.message({ custom: 'redemptionDate cannot precede acquisitionDate' });
  }
  return value;
}

const postTaxInstrumentSchema = Joi.object({
  instrumentType: Joi.string().trim().min(1).max(50).required(),
  nominalRate: Joi.number().min(0).max(1).required(),
  holdingYears: Joi.number().min(0.01).max(100).required(),
  monthlySIP: Joi.number().min(0).max(100000000).required(),
  ...transactionDateFields,
  redemptionChannel: Joi.string().valid('RBI_REDEMPTION', 'MATURITY_REDEMPTION', 'SECONDARY_MARKET_SALE').optional(),
  couponRate: Joi.number().min(0).max(1).optional(),
  annuityFraction: Joi.number().min(0).max(1).optional(),
  retirementTiming: Joi.string().trim().min(2).max(100).optional(),
}).custom(validatePostTaxTransactionDates).unknown(false);

export const postTaxReturnSchema = postTaxInstrumentSchema.keys({
  annualIncome: Joi.number().min(0).max(1000000000).required(),
  regime: Joi.string().valid('new', 'old').required(),
  userAge: Joi.number().integer().min(18).max(120).required(),
  incomeSource: Joi.string().valid('salary', 'pension', 'family_pension', 'business', 'other').required(),
  fiscalYear: Joi.string().pattern(FISCAL_YEAR_PATTERN).required(),
  deductions: taxDeductionSchema.optional(),
  ...transactionDateFields,
  redemptionChannel: Joi.string().valid('RBI_REDEMPTION', 'MATURITY_REDEMPTION', 'SECONDARY_MARKET_SALE').optional(),
  couponRate: Joi.number().min(0).max(1).optional(),
  annuityFraction: Joi.number().min(0).max(1).optional(),
  retirementTiming: Joi.string().trim().min(2).max(100).optional(),
  section112AExemptionUsed: Joi.number().min(0).max(125000).optional(),
}).custom(validatePostTaxTransactionDates).unknown(false);

export const postTaxReturnBatchSchema = Joi.object({
  instruments: Joi.array().items(postTaxInstrumentSchema).min(1).max(50).required(),
  annualIncome: Joi.number().min(0).max(1000000000).required(),
  regime: Joi.string().valid('new', 'old').required(),
  userAge: Joi.number().integer().min(18).max(120).required(),
  incomeSource: Joi.string().valid('salary', 'pension', 'family_pension', 'business', 'other').required(),
  inflationRate: Joi.number().min(0).max(1).required(),
  fiscalYear: Joi.string().pattern(FISCAL_YEAR_PATTERN).required(),
  deductions: taxDeductionSchema.optional(),
  section112AExemptionUsed: Joi.number().min(0).max(125000).optional(),
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
