import { describe, expect, it } from 'vitest';
import {
  INVESTMENT_GOALS,
  normalizeFinancialProfile,
  toFinancialProfilePayload,
  validateFinancialProfile,
} from './financialProfile';

const validProfile = (overrides = {}) => ({
  monthly_take_home: 100000,
  monthly_savings: 20000,
  age: 35,
  risk_tolerance: 'Moderate',
  sold_property_proceeds: 2000000,
  has_lump_sum: true,
  lump_sum_amount: 500000,
  liquid_savings: 300000,
  emi_burden_pct: 15,
  financial_dependents: 1,
  emergency_fund_months: 6,
  investment_goals: ['Retirement', 'Wealth Growth'],
  investment_horizon_years: 15,
  ...overrides,
});

describe('frozen Financial Profile frontend contract', () => {
  it('normalizes only equivalent aliases and ignores ambiguous or forbidden facts', () => {
    const normalized = normalizeFinancialProfile({
      ...validProfile(),
      profileId: 'profile-1',
      version: 3,
      income: 99999999,
      annualIncome: 99999999,
      taxRegime: 'old',
      goal_type: 'house purchase',
    });
    expect(normalized.monthly_take_home).toBe(100000);
    expect(normalized).not.toHaveProperty('income');
    expect(normalized).not.toHaveProperty('annualIncome');
    expect(normalized).not.toHaveProperty('taxRegime');
    expect(normalized).not.toHaveProperty('goal_type');
    expect(validateFinancialProfile({ ...validProfile(), monthly_take_home: undefined, income: 100000 }).valid).toBe(false);
  });

  it('emits exactly the frozen API payload and never double-counts property proceeds', () => {
    const payload = toFinancialProfilePayload(validProfile());
    expect(Object.keys(payload).sort()).toEqual([
      'age', 'emergency_fund_months', 'emi_burden_pct', 'financial_dependents',
      'has_lump_sum', 'investment_goals', 'investment_horizon_years', 'liquid_savings',
      'lump_sum_amount', 'monthly_savings', 'monthly_take_home', 'risk_tolerance',
      'sold_property_proceeds',
    ].sort());
    expect(payload.sold_property_proceeds).toBe(2000000);
    expect(payload.lump_sum_amount).toBe(500000);
    expect(payload).not.toHaveProperty('one_time_investable');
  });

  it.each([
    ['age below minimum', { age: 17 }],
    ['age above maximum', { age: 81 }],
    ['fractional age', { age: 30.5 }],
    ['take-home must be positive', { monthly_take_home: 0 }],
    ['savings must be positive', { monthly_savings: 0 }],
    ['savings equal to take-home', { monthly_savings: 100000 }],
    ['unsupported risk', { risk_tolerance: 'Very Aggressive' }],
    ['negative property proceeds', { sold_property_proceeds: -1 }],
    ['non-boolean lump-sum declaration', { has_lump_sum: 'false' }],
    ['missing declared lump sum', { has_lump_sum: true, lump_sum_amount: 0 }],
    ['undeclared nonzero lump sum', { has_lump_sum: false, lump_sum_amount: 1 }],
    ['negative liquid savings', { liquid_savings: -1 }],
    ['EMI over 100 percent', { emi_burden_pct: 101 }],
    ['fractional dependents', { financial_dependents: 1.5 }],
    ['negative emergency coverage', { emergency_fund_months: -1 }],
    ['empty goals', { investment_goals: [] }],
    ['unsupported goal', { investment_goals: ['House Purchase'] }],
    ['duplicate goals', { investment_goals: ['Retirement', 'Retirement'] }],
    ['horizon below minimum', { investment_horizon_years: 0 }],
    ['horizon above maximum', { investment_horizon_years: 31 }],
    ['fractional horizon', { investment_horizon_years: 10.5 }],
  ])('rejects %s', (_name, override) => {
    expect(validateFinancialProfile(validProfile(override)).valid).toBe(false);
  });

  it('accepts every supported goal and includes an optimistic-concurrency version only when required', () => {
    const profile = validProfile({ investment_goals: [...INVESTMENT_GOALS], version: 4 });
    expect(validateFinancialProfile(profile).valid).toBe(true);
    expect(validateFinancialProfile(validProfile({ monthly_take_home: 1, monthly_savings: 0.5 })).valid).toBe(true);
    expect(toFinancialProfilePayload(profile, { requireVersion: true }).version).toBe(4);
    expect(() => toFinancialProfilePayload({ ...profile, version: null }, { requireVersion: true })).toThrow(/version/i);
  });

  it('accepts blank supplemental facts and emits explicit nulls instead of numeric defaults', () => {
    const profile = validProfile({
      sold_property_proceeds: '',
      has_lump_sum: '',
      lump_sum_amount: '',
      liquid_savings: '',
      emi_burden_pct: '',
      financial_dependents: '',
      emergency_fund_months: '',
    });
    expect(validateFinancialProfile(profile)).toMatchObject({ valid: true });
    expect(toFinancialProfilePayload(profile)).toMatchObject({
      sold_property_proceeds: null,
      has_lump_sum: null,
      lump_sum_amount: null,
      liquid_savings: null,
      emi_burden_pct: null,
      financial_dependents: null,
      emergency_fund_months: null,
    });
  });
});
