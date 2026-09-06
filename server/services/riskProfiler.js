import { buildRecommendationProfile, deriveRecommendationMetrics } from './recommendationProfile.js';

export const RISK_CAPACITY_POLICY = Object.freeze({
  version: 'risk-capacity-2.0.0',
  lowSavingsRate: 0.10,
  strongSavingsRate: 0.30,
  highEmiBurdenPct: 40,
  criticalEmiBurdenPct: 60,
  lowEmergencyCoverageMonths: 3,
  strongEmergencyCoverageMonths: 6,
  multipleDependents: 3,
  shortHorizonYears: 3,
  nearRetirementAge: 55,
});

const LEVEL_LABELS = Object.freeze({
  1: 'Conservative',
  2: 'Conservative-Moderate',
  3: 'Moderate',
  4: 'Moderate-Aggressive',
  5: 'Aggressive',
});

const PREFERENCE_LEVELS = Object.freeze({ Conservative: 1, Moderate: 3, Aggressive: 5 });

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scoreToLevel(score) {
  if (score < 20) return 1;
  if (score < 40) return 2;
  if (score < 60) return 3;
  if (score < 80) return 4;
  return 5;
}

/**
 * Deterministic capacity derived only from the frozen profile. Sold-property
 * proceeds and deployable lump sums deliberately contribute no capacity bonus.
 */
export function calculateRiskCapacity(profileInput) {
  const profile = buildRecommendationProfile(profileInput);
  const metrics = deriveRecommendationMetrics(profile);
  const p = RISK_CAPACITY_POLICY;

  const ageComponent = clamp((70 - profile.age) / 52, 0, 1) * 25;
  const horizonComponent = clamp(profile.investmentHorizonYears / 30, 0, 1) * 25;
  const savingsComponent = clamp(metrics.savingsRate / p.strongSavingsRate, 0, 1) * 20;
  const emergencyComponent = clamp(profile.emergencyFundMonths / p.strongEmergencyCoverageMonths, 0, 1) * 15;
  const liquidityMonths = profile.liquidSavings / profile.monthlyTakeHome;
  const liquidityComponent = clamp(liquidityMonths / p.strongEmergencyCoverageMonths, 0, 1) * 10;
  const emiPenalty = clamp((profile.emiBurdenPct - 20) / 80, 0, 1) * 15;
  const dependentsPenalty = Math.min(10, profile.financialDependents * 2.5);

  const capacityScore = Math.round(clamp(
    ageComponent + horizonComponent + savingsComponent + emergencyComponent + liquidityComponent
      - emiPenalty - dependentsPenalty,
    0,
    100,
  ));
  const capacityLevel = scoreToLevel(capacityScore);

  const reasonCodes = [];
  if (metrics.savingsRate < p.lowSavingsRate) reasonCodes.push('LOW_SAVINGS_RATE');
  if (metrics.savingsRate >= p.strongSavingsRate) reasonCodes.push('HIGH_SAVINGS_RATE');
  if (profile.emiBurdenPct >= p.criticalEmiBurdenPct) reasonCodes.push('CRITICAL_EMI_BURDEN');
  else if (profile.emiBurdenPct >= p.highEmiBurdenPct) reasonCodes.push('HIGH_EMI_BURDEN');
  if (profile.emergencyFundMonths < p.lowEmergencyCoverageMonths) reasonCodes.push('LOW_EMERGENCY_COVERAGE');
  else if (profile.emergencyFundMonths >= p.strongEmergencyCoverageMonths) reasonCodes.push('STRONG_EMERGENCY_COVERAGE');
  if (profile.financialDependents >= p.multipleDependents) reasonCodes.push('MULTIPLE_FINANCIAL_DEPENDENTS');
  if (profile.investmentHorizonYears <= p.shortHorizonYears) reasonCodes.push('SHORT_INVESTMENT_HORIZON');
  if (profile.age >= p.nearRetirementAge) reasonCodes.push('NEAR_RETIREMENT_AGE');
  if (liquidityMonths >= p.strongEmergencyCoverageMonths) reasonCodes.push('HIGH_LIQUIDITY_BUFFER');

  return Object.freeze({
    capacityScore,
    capacityLevel,
    capacityRisk: LEVEL_LABELS[capacityLevel],
    reasonCodes: Object.freeze(reasonCodes),
    components: Object.freeze({
      age: ageComponent,
      horizon: horizonComponent,
      savingsRate: savingsComponent,
      emergencyCoverage: emergencyComponent,
      liquidityBuffer: liquidityComponent,
      emiPenalty,
      dependentsPenalty,
    }),
  });
}

/** Risk preference is a hard ceiling; capacity can only reduce it. */
export function assessSuitabilityRisk(profileInput) {
  const profile = buildRecommendationProfile(profileInput);
  const capacity = calculateRiskCapacity(profile);
  const preferenceLevel = PREFERENCE_LEVELS[profile.riskTolerance];
  const finalLevel = Math.min(preferenceLevel, capacity.capacityLevel);
  const reasonCodes = [`RISK_PREFERENCE_${profile.riskTolerance.toUpperCase()}`, ...capacity.reasonCodes];
  if (finalLevel < preferenceLevel) reasonCodes.push('RISK_CAPACITY_REDUCED_PREFERENCE');

  return Object.freeze({
    preferenceRisk: profile.riskTolerance,
    preferenceLevel,
    capacityRisk: capacity.capacityRisk,
    capacityLevel: capacity.capacityLevel,
    capacityScore: capacity.capacityScore,
    finalRisk: LEVEL_LABELS[finalLevel],
    finalLevel,
    reasonCodes: Object.freeze(reasonCodes),
    components: capacity.components,
  });
}

export function getRiskProfile(profileInput) {
  if (!profileInput || typeof profileInput !== 'object' || Array.isArray(profileInput)) {
    throw new TypeError('getRiskProfile requires a financial-profile object');
  }
  const suitability = assessSuitabilityRisk(profileInput);
  return {
    category: suitability.capacityRisk,
    riskScore: suitability.capacityScore,
    description: `Risk capacity is ${suitability.capacityRisk}; final suitability is ${suitability.finalRisk}.`,
    recommendedEquityAllocation: [20, 30, 50, 65, 80][suitability.finalLevel - 1],
    ...suitability,
  };
}

export function encodeRiskCategory(category) {
  const map = {
    Conservative: 0,
    'Conservative-Moderate': 1,
    Moderate: 2,
    'Moderate-Aggressive': 3,
    Aggressive: 4,
  };
  if (!Object.prototype.hasOwnProperty.call(map, category)) {
    throw new TypeError(`Unknown risk category: ${category}`);
  }
  return map[category];
}

export function riskLabelForLevel(level) {
  return LEVEL_LABELS[level] || null;
}
