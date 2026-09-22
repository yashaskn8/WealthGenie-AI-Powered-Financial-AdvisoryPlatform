import { z } from 'zod';
import { INVESTMENT_GOALS, RISK_TOLERANCES } from '../utils/financialProfile';

const blankToUndefined = (value) => (
  value === '' || value === null || value === undefined ? undefined : value
);

const numberField = (label, { optional = false } = {}) => {
  if (optional) {
    return z.preprocess(
      value => value === '' || value === null || value === undefined ? null : Number(value),
      z.nullable(z.number({ error: `${label} must be a number.` }).finite({ error: `${label} must be a valid number.` })),
    ).transform(value => value === null ? '' : value);
  }

  return z.preprocess(
    value => blankToUndefined(value) === undefined ? undefined : Number(value),
    z.number({ error: `${label} is required.` }).finite({ error: `${label} must be a valid number.` }),
  );
};

const booleanField = z.preprocess(
  value => value === '' || value === undefined ? null : value,
  z.nullable(z.boolean({ error: 'Choose Yes, No, or Skip.' })),
).transform(value => value === null ? '' : value);

export const financialProfileSchema = z.object({
  monthly_take_home: numberField('Monthly take-home'),
  monthly_savings: numberField('Monthly savings'),
  age: numberField('Age'),
  risk_tolerance: z.enum(RISK_TOLERANCES, { error: 'Choose a risk tolerance.' }),
  sold_property_proceeds: numberField('Sold-property proceeds', { optional: true }),
  has_lump_sum: booleanField,
  lump_sum_amount: numberField('Lump sum amount', { optional: true }),
  liquid_savings: numberField('Liquid savings', { optional: true }),
  emi_burden_pct: numberField('EMI burden', { optional: true }),
  financial_dependents: numberField('Financial dependents', { optional: true }),
  emergency_fund_months: numberField('Emergency-fund coverage', { optional: true }),
  investment_goals: z.array(z.enum(INVESTMENT_GOALS)).min(1, 'Choose at least one investment goal.'),
  investment_horizon_years: numberField('Investment horizon'),
  profileId: z.string().nullable().optional(),
  version: z.union([z.number(), z.string(), z.null()]).optional(),
}).superRefine((profile, context) => {
  const add = (path, message) => context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

  if (!(profile.monthly_take_home > 0 && profile.monthly_take_home <= 100000000)) {
    add('monthly_take_home', 'Monthly take-home must be greater than ₹0 and no more than ₹10,00,00,000.');
  }
  if (!(profile.monthly_savings > 0
      && profile.monthly_savings < profile.monthly_take_home
      && profile.monthly_savings <= 100000000)) {
    add('monthly_savings', 'Monthly savings must be greater than ₹0 and less than monthly take-home.');
  }
  if (!Number.isInteger(profile.age) || profile.age < 18 || profile.age > 80) {
    add('age', 'Age must be a whole number from 18 to 80.');
  }
  if (profile.sold_property_proceeds !== ''
      && !(profile.sold_property_proceeds >= 0 && profile.sold_property_proceeds <= 10000000000)) {
    add('sold_property_proceeds', 'Sold-property proceeds must be from ₹0 to ₹10,00,00,00,000 when provided.');
  }
  if (profile.has_lump_sum === true
      && !(profile.lump_sum_amount > 0 && profile.lump_sum_amount <= 10000000000)) {
    add('lump_sum_amount', 'Enter a positive lump sum amount up to ₹10,00,00,00,000.');
  }
  if (profile.has_lump_sum === false && profile.lump_sum_amount !== 0) {
    add('lump_sum_amount', 'Lump sum amount must be 0 when no lump sum is available.');
  }
  if (profile.has_lump_sum === '' && profile.lump_sum_amount !== '') {
    add('has_lump_sum', 'Choose Yes before entering a lump sum amount.');
  }
  if (profile.liquid_savings !== ''
      && !(profile.liquid_savings >= 0 && profile.liquid_savings <= 1000000000)) {
    add('liquid_savings', 'Liquid savings must be from ₹0 to ₹1,00,00,00,000 when provided.');
  }
  if (profile.emi_burden_pct !== ''
      && !(profile.emi_burden_pct >= 0 && profile.emi_burden_pct <= 100)) {
    add('emi_burden_pct', 'EMI burden must be from 0% to 100% when provided.');
  }
  if (profile.financial_dependents !== ''
      && (!Number.isInteger(profile.financial_dependents)
        || profile.financial_dependents < 0 || profile.financial_dependents > 15)) {
    add('financial_dependents', 'Financial dependents must be a whole number from 0 to 15 when provided.');
  }
  if (profile.emergency_fund_months !== ''
      && !(profile.emergency_fund_months >= 0 && profile.emergency_fund_months <= 120)) {
    add('emergency_fund_months', 'Emergency-fund coverage must be from 0 to 120 months when provided.');
  }
  if (!Number.isInteger(profile.investment_horizon_years)
      || profile.investment_horizon_years < 1 || profile.investment_horizon_years > 30) {
    add('investment_horizon_years', 'Investment horizon must be a whole number from 1 to 30 years.');
  }
});

export function getFinancialProfileFormValues(profile) {
  return {
    ...profile,
    profileId: profile?.profileId || null,
    version: profile?.version ?? null,
  };
}
