export const INVESTMENT_GOALS = Object.freeze([
  'Retirement',
  'Wealth Growth',
  'Tax Saving',
  'Emergency Fund',
]);

export const RISK_TOLERANCES = Object.freeze(['Conservative', 'Moderate', 'Aggressive']);

export const EMPTY_FINANCIAL_PROFILE = Object.freeze({
  monthly_take_home: '',
  monthly_savings: '',
  age: '',
  risk_tolerance: '',
  sold_property_proceeds: '',
  has_lump_sum: false,
  lump_sum_amount: '0',
  liquid_savings: '',
  emi_burden_pct: '',
  financial_dependents: '',
  emergency_fund_months: '',
  investment_goals: [],
  investment_horizon_years: '',
  profileId: null,
  version: null,
});

const aliases = Object.freeze({
  monthly_take_home: ['monthly_take_home', 'monthlyTakeHome', 'monthly_income', 'monthlyIncome', 'income'],
  monthly_savings: ['monthly_savings', 'monthlySavings', 'savings'],
  age: ['age'],
  risk_tolerance: ['risk_tolerance', 'riskTolerance'],
  sold_property_proceeds: ['sold_property_proceeds', 'soldPropertyProceeds', 'sold_property_amount', 'soldPropertyAmount'],
  has_lump_sum: ['has_lump_sum', 'hasLumpSum'],
  lump_sum_amount: ['lump_sum_amount', 'lumpSumAmount'],
  liquid_savings: ['liquid_savings', 'liquidSavings'],
  emi_burden_pct: ['emi_burden_pct', 'emiBurdenPct', 'existing_debt_emi_ratio_pct'],
  financial_dependents: ['financial_dependents', 'financialDependents', 'dependents'],
  emergency_fund_months: ['emergency_fund_months', 'emergencyFundMonths'],
  investment_goals: ['investment_goals', 'investmentGoals', 'goals'],
  investment_horizon_years: ['investment_horizon_years', 'investmentHorizonYears', 'investment_horizon', 'investmentHorizon'],
});

function firstDefined(source, keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

export function normalizeFinancialProfile(source = {}) {
  const safeSource = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const result = { ...EMPTY_FINANCIAL_PROFILE };
  for (const [key, keys] of Object.entries(aliases)) {
    const value = firstDefined(safeSource, keys);
    if (value !== undefined) result[key] = Array.isArray(value) ? [...value] : value;
  }
  result.profileId = safeSource.profileId || safeSource.profile_id || safeSource._id || null;
  result.version = safeSource.version ?? null;
  return result;
}

function finiteNumber(value) {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function validateFinancialProfile(source) {
  const profile = normalizeFinancialProfile(source);
  const numbers = Object.fromEntries([
    'monthly_take_home', 'monthly_savings', 'age', 'sold_property_proceeds', 'lump_sum_amount',
    'liquid_savings', 'emi_burden_pct', 'financial_dependents', 'emergency_fund_months',
    'investment_horizon_years',
  ].map(key => [key, finiteNumber(profile[key])]));
  const errors = [];
  if (!(numbers.monthly_take_home >= 1000 && numbers.monthly_take_home <= 100000000)) errors.push('Monthly take-home must be between ₹1,000 and ₹10,00,00,000.');
  if (!(numbers.monthly_savings >= 500 && numbers.monthly_savings < numbers.monthly_take_home)) errors.push('Monthly savings must be at least ₹500 and less than monthly take-home.');
  if (!Number.isInteger(numbers.age) || numbers.age < 18 || numbers.age > 80) errors.push('Age must be a whole number from 18 to 80.');
  if (!RISK_TOLERANCES.includes(profile.risk_tolerance)) errors.push('Choose a risk tolerance.');
  if (!(numbers.sold_property_proceeds >= 0 && numbers.sold_property_proceeds <= 10000000000)) errors.push('Sold-property proceeds must be from ₹0 to ₹10,00,00,00,000.');
  if (typeof profile.has_lump_sum !== 'boolean') errors.push('Declare whether a lump sum is available.');
  if (profile.has_lump_sum && !(numbers.lump_sum_amount > 0 && numbers.lump_sum_amount <= 10000000000)) errors.push('Enter a positive lump sum amount up to ₹10,00,00,00,000.');
  if (!profile.has_lump_sum && numbers.lump_sum_amount !== 0) errors.push('Lump sum amount must be 0 when no lump sum is available.');
  if (!(numbers.liquid_savings >= 0 && numbers.liquid_savings <= 1000000000)) errors.push('Liquid savings must be from ₹0 to ₹1,00,00,00,000.');
  if (!(numbers.emi_burden_pct >= 0 && numbers.emi_burden_pct <= 100)) errors.push('EMI burden must be from 0% to 100%.');
  if (!Number.isInteger(numbers.financial_dependents) || numbers.financial_dependents < 0 || numbers.financial_dependents > 15) errors.push('Financial dependents must be a whole number from 0 to 15.');
  if (!(numbers.emergency_fund_months >= 0 && numbers.emergency_fund_months <= 120)) errors.push('Emergency-fund coverage must be from 0 to 120 months.');
  if (!Array.isArray(profile.investment_goals) || profile.investment_goals.length === 0
      || profile.investment_goals.some(goal => !INVESTMENT_GOALS.includes(goal))
      || new Set(profile.investment_goals).size !== profile.investment_goals.length) errors.push('Choose one or more unique supported investment goals.');
  if (!Number.isInteger(numbers.investment_horizon_years) || numbers.investment_horizon_years < 1 || numbers.investment_horizon_years > 30) errors.push('Investment horizon must be a whole number from 1 to 30 years.');
  return { valid: errors.length === 0, errors, numbers, profile };
}

export function toFinancialProfilePayload(source, { requireVersion = false } = {}) {
  const validation = validateFinancialProfile(source);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  const { profile, numbers } = validation;
  const payload = {
    monthly_take_home: numbers.monthly_take_home,
    monthly_savings: numbers.monthly_savings,
    age: numbers.age,
    risk_tolerance: profile.risk_tolerance,
    sold_property_proceeds: numbers.sold_property_proceeds,
    has_lump_sum: profile.has_lump_sum,
    lump_sum_amount: profile.has_lump_sum ? numbers.lump_sum_amount : 0,
    liquid_savings: numbers.liquid_savings,
    emi_burden_pct: numbers.emi_burden_pct,
    financial_dependents: numbers.financial_dependents,
    emergency_fund_months: numbers.emergency_fund_months,
    investment_goals: INVESTMENT_GOALS.filter(goal => profile.investment_goals.includes(goal)),
    investment_horizon_years: numbers.investment_horizon_years,
  };
  if (requireVersion) {
    if (!Number.isInteger(Number(profile.version)) || Number(profile.version) < 1) throw new Error('A valid profile version is required to save changes.');
    payload.version = Number(profile.version);
  }
  return payload;
}

export function financialProfileKey(source) {
  const profile = normalizeFinancialProfile(source);
  return JSON.stringify({
    ...toFinancialProfilePayload(profile),
    profileId: profile.profileId,
    version: profile.version,
  });
}
