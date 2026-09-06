export const CANONICAL_PROFILE = Object.freeze({
  monthlyTakeHome: 100000,
  monthlySavings: 20000,
  age: 35,
  riskTolerance: 'Moderate',
  soldPropertyProceeds: 0,
  hasLumpSum: false,
  lumpSumAmount: 0,
  liquidSavings: 300000,
  emiBurdenPct: 10,
  financialDependents: 1,
  emergencyFundMonths: 6,
  investmentGoals: Object.freeze(['Wealth Growth']),
  investmentHorizonYears: 10,
});

export function canonicalProfile(overrides = {}) {
  return { ...CANONICAL_PROFILE, ...overrides };
}

export function canonicalProfilePayload(overrides = {}) {
  const profile = canonicalProfile(overrides);
  return {
    monthly_take_home: profile.monthlyTakeHome,
    monthly_savings: profile.monthlySavings,
    age: profile.age,
    risk_tolerance: profile.riskTolerance,
    sold_property_proceeds: profile.soldPropertyProceeds,
    has_lump_sum: profile.hasLumpSum,
    lump_sum_amount: profile.lumpSumAmount,
    liquid_savings: profile.liquidSavings,
    emi_burden_pct: profile.emiBurdenPct,
    financial_dependents: profile.financialDependents,
    emergency_fund_months: profile.emergencyFundMonths,
    investment_goals: [...profile.investmentGoals],
    investment_horizon_years: profile.investmentHorizonYears,
  };
}
