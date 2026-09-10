import Joi from 'joi';

export const FISCAL_YEAR_PATTERN = /^FY\d{4}-\d{2}$/;
export const incomeSourceValues = ['salary', 'pension', 'family_pension', 'business', 'other'];

export const taxDeductionFields = {
  section80C: Joi.number().min(0).max(150000).optional(),
  nps80CCD1B: Joi.number().min(0).max(50000).optional(),
  section80CCD: Joi.number().min(0).max(50000).optional(),
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
  section80EEA: Joi.number().min(0).max(150000).optional(),
  savingsInterest: Joi.number().min(0).max(100000000).optional(),
  section80TTA: Joi.number().min(0).max(10000).optional(),
  section80TTB: Joi.number().min(0).max(50000).optional(),
  other: Joi.number().min(0).max(100000000).optional(),
  age: Joi.number().integer().min(18).max(120).optional(),
};

export const taxDeductionSchema = Joi.object(taxDeductionFields).unknown(false);

export function requireTaxDependencyFacts(value, helpers) {
  // Regime comparison always computes the old regime, while a single new-regime
  // request may omit age because the new slabs are age-neutral.
  if (value.regime !== 'new' && !Number.isInteger(value.age)) {
    return helpers.message({ custom: 'USER_AGE_REQUIRED_FOR_OLD_REGIME' });
  }
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

export const taxFields = {
  income: Joi.number().min(0).max(1000000000).required(),
  incomeSource: Joi.string().valid(...incomeSourceValues).required(),
  ...taxDeductionFields,
  fiscalYear: Joi.string().pattern(FISCAL_YEAR_PATTERN).required(),
};

export const taxCalculationContextSchema = Joi.object({
  fiscalYear: Joi.string().pattern(FISCAL_YEAR_PATTERN).optional(),
  incomeSource: Joi.string().valid(...incomeSourceValues).optional(),
  annualGrossIncome: Joi.number().min(0).max(1000000000).optional(),
  regime: Joi.string().valid('new', 'old').optional(),
  userAge: Joi.number().integer().min(18).max(120).optional(),
  deductions: taxDeductionSchema.optional(),
  illustrativePrincipal: Joi.number().greater(0).max(1000000000).optional(),
  holdingPeriodMonths: Joi.number().min(0).max(1200).optional(),
  section112AExemptionUsed: Joi.number().min(0).max(125000).optional(),
}).custom((value, helpers) => {
  const taxKeys = ['annualGrossIncome', 'incomeSource', 'regime', 'fiscalYear', 'deductions', 'userAge'];
  const hasTaxContext = taxKeys.some(key => value[key] !== undefined);
  if (!hasTaxContext) return value;
  const missing = ['annualGrossIncome', 'incomeSource', 'regime', 'fiscalYear']
    .filter(key => value[key] === undefined);
  if (missing.length > 0) {
    return helpers.message({ custom: `taxCalculationContext requires: ${missing.join(', ')}` });
  }
  if (value.regime === 'old' && !Number.isInteger(value.userAge)) {
    return helpers.message({ custom: 'USER_AGE_REQUIRED_FOR_OLD_REGIME' });
  }
  return value;
}).unknown(false);
