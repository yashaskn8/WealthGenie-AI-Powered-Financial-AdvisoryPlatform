import { investmentDatabase, CONCENTRATION_CAPS } from '../data/investmentDatabase.js';
import { INSTRUMENT_PARAMS } from './instrumentConstants.js';
import { buildRecommendationProfile } from './recommendationProfile.js';
import { assessSuitabilityRisk } from './riskProfiler.js';

export const PIPELINE_CONFIG = Object.freeze({
  version: 'recommendation-pipeline-4.0.0',
  topN: 8,
  scoreWeights: Object.freeze({
    expectedReturn: 0.25,
    riskFit: 0.25,
    liquidity: 0.15,
    goalFit: 0.15,
    horizonFit: 0.10,
    cost: 0.05,
    mlConfidence: 0.05,
  }),
});

export const INSTRUMENT_KEY_MAP = Object.freeze({
  ppf: 'PPF', scss: 'SCSS', sukanya: 'SSY', ssy: 'SSY', rbi_bonds: 'RBI_Bond',
  rbi_retail_direct_gilt: 'RBI_Bond', g_sec: 'G-Sec', sgb: 'SGB', nps: 'NPS',
});

const RISK_LABEL_SCORE = Object.freeze({
  'Very Low': 1, Low: 1, 'Low-Medium': 2, 'Medium-Low': 2,
  Medium: 3, 'Medium-High': 4, High: 4, 'Very High': 5,
});

const round = (value, digits = 2) => Number(Number(value).toFixed(digits));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function resolveBackendType(instrument = {}) {
  const id = String(instrument.id || '').toLowerCase();
  if (INSTRUMENT_KEY_MAP[id]) return INSTRUMENT_KEY_MAP[id];
  const explicit = String(instrument.type || '');
  if (INSTRUMENT_PARAMS[explicit]) return explicit;
  const text = `${instrument.id || ''} ${instrument.name || ''} ${instrument.category || ''}`.toLowerCase();
  if (/small.?cap/.test(text)) return 'Smallcap_MF';
  if (/mid.?cap/.test(text)) return 'Midcap_MF';
  if (/index fund|index mutual/.test(text)) return 'Index_MF';
  if (/liquid/.test(text)) return 'Liquid_MF';
  if (/arbitrage/.test(text)) return 'Arbitrage_MF';
  if (/hybrid|balanced/.test(text)) return 'Hybrid_MF';
  if (/elss/.test(text)) return 'ELSS';
  if (/debt|bond fund/.test(text)) return 'Debt_MF';
  if (/mutual fund|equity fund|flexi|large.?cap/.test(text)) return 'Equity_MF';
  if (/gold/.test(text)) return 'Gold';
  if (/etf/.test(text)) return 'ETF';
  if (/fixed deposit|\bfd\b/.test(text)) return 'FD';
  return explicit || null;
}

export function getInstrumentRisk(instrument = {}) {
  const numeric = Number(instrument.dynamicData?.risk?.value ?? instrument.riskLevel ?? instrument.risk);
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 5) return numeric;
  const label = instrument.dynamicData?.risk?.level || instrument.riskLabel || instrument.riskLevel || instrument.risk;
  return RISK_LABEL_SCORE[label] ?? null;
}

export function instrumentRiskTier(instrument = {}) {
  const score = getInstrumentRisk(instrument);
  if (score === null) return 'UNKNOWN';
  if (score <= 2) return 'LOW';
  if (score === 3) return 'MEDIUM';
  return 'HIGH';
}

export function reconcileRisk(profileInput) {
  const suitability = assessSuitabilityRisk(profileInput);
  return {
    final_risk_tier: suitability.finalRisk,
    final_score: suitability.finalLevel,
    capacity_score: suitability.capacityScore,
    capacity_tier: suitability.capacityRisk,
    preference_score: suitability.preferenceLevel,
    preference_tier: suitability.preferenceRisk,
    reconciliation_note: suitability.finalLevel < suitability.preferenceLevel
      ? 'Risk capacity reduced the stated risk preference.'
      : 'Risk preference is within measured capacity.',
    advisory_note: suitability.finalLevel < suitability.preferenceLevel
      ? 'Recommendations are capped below the stated preference because of financial capacity.'
      : '',
    reason_codes: [...suitability.reasonCodes],
    excluded_due_to_eligibility: [],
  };
}

function exclusionReason(instrument, profile, finalLevel) {
  const risk = getInstrumentRisk(instrument);
  if (risk === null) return 'RISK_CLASSIFICATION_NOT_ESTABLISHED';
  if (risk > finalLevel) return 'RISK_EXCEEDS_FINAL_SUITABILITY';

  const expectedReturn = instrument.expectedReturn ?? instrument.dynamicData?.expectedReturn?.avg;
  if (!Number.isFinite(Number(expectedReturn))) return 'RETURN_ASSUMPTION_NOT_ESTABLISHED';
  const liquidityScore = instrument.liquidityScore ?? instrument.dynamicData?.liquidity?.score;
  if (!Number.isFinite(Number(liquidityScore))) return 'LIQUIDITY_CLASSIFICATION_NOT_ESTABLISHED';
  const expenseRatio = instrument.expenseRatio ?? instrument.dynamicData?.expenseRatio;
  if (!Number.isFinite(Number(expenseRatio))) return 'COST_ASSUMPTION_NOT_ESTABLISHED';
  const goalTags = instrument.goalTags ?? instrument.dynamicData?.goalTags;
  if (!Array.isArray(goalTags)) return 'GOAL_CLASSIFICATION_NOT_ESTABLISHED';

  if (!instrument.eligibility || typeof instrument.eligibility !== 'object'
      || Array.isArray(instrument.eligibility)) return 'ELIGIBILITY_NOT_ESTABLISHED';
  const eligibility = instrument.eligibility;
  if (eligibility.minAge !== null && eligibility.minAge !== undefined
      && Number.isFinite(Number(eligibility.minAge)) && profile.age < Number(eligibility.minAge)) return 'MINIMUM_AGE_NOT_MET';
  if (eligibility.maxAge !== null && eligibility.maxAge !== undefined
      && Number.isFinite(Number(eligibility.maxAge)) && profile.age > Number(eligibility.maxAge)) return 'MAXIMUM_AGE_EXCEEDED';
  if (Number(eligibility.minAnnualIncome) > 0) return 'GROSS_INCOME_ELIGIBILITY_NOT_ESTABLISHED';
  if (eligibility.hasGirlChild === true) return 'GIRL_CHILD_ELIGIBILITY_NOT_ESTABLISHED';
  if (eligibility.requiresDemat === true) return 'DEMAT_ELIGIBILITY_NOT_ESTABLISHED';

  const minMonthlyRaw = eligibility.minMonthlySavings ?? instrument.minMonthlyInvestment;
  if (minMonthlyRaw === undefined || !Number.isFinite(Number(minMonthlyRaw))) {
    return 'MINIMUM_INVESTMENT_NOT_ESTABLISHED';
  }
  const minMonthly = Number(minMonthlyRaw);
  if (Number.isFinite(minMonthly) && profile.monthlySavings < minMonthly) return 'MINIMUM_INVESTMENT_NOT_MET';

  const minimumHorizonRaw = instrument.idealHorizon?.min ?? instrument.dynamicData?.idealHorizon?.min;
  const lockInRaw = instrument.lockIn ?? instrument.dynamicData?.liquidity?.lockIn;
  if (!Number.isFinite(Number(minimumHorizonRaw))) return 'MINIMUM_HORIZON_NOT_ESTABLISHED';
  if (!Number.isFinite(Number(lockInRaw))) return 'LOCK_IN_NOT_ESTABLISHED';
  const minimumHorizon = Number(minimumHorizonRaw);
  const lockIn = Number(lockInRaw);
  if (Number.isFinite(minimumHorizon) && minimumHorizon > profile.investmentHorizonYears) return 'HORIZON_BELOW_MINIMUM';
  if (Number.isFinite(lockIn) && lockIn > profile.investmentHorizonYears) return 'LOCK_IN_EXCEEDS_HORIZON';
  return null;
}

export function filterEligible(instruments, profileInput, reconciledTier = null) {
  const profile = buildRecommendationProfile(profileInput);
  const finalLevel = reconciledTier ?? assessSuitabilityRisk(profile).finalLevel;
  const eligible = [];
  const excluded = [];
  for (const instrument of instruments || []) {
    const reasonCode = exclusionReason(instrument, profile, finalLevel);
    if (reasonCode) excluded.push({ id: instrument.id, name: instrument.name, reasonCode });
    else eligible.push(instrument);
  }
  return { eligible, excluded };
}

export function parseProfile(profileInput) {
  const profile = buildRecommendationProfile(profileInput);
  const suitability = assessSuitabilityRisk(profile);
  return Object.freeze({
    age: profile.age,
    monthlyTakeHome: profile.monthlyTakeHome,
    monthlySavings: profile.monthlySavings,
    risk: suitability.finalRisk,
    riskLevel: suitability.finalLevel,
    horizon: profile.investmentHorizonYears,
    goals: [...profile.investmentGoals],
    liquidSavings: profile.liquidSavings,
    emergencyFundMonths: profile.emergencyFundMonths,
    emiBurdenPct: profile.emiBurdenPct,
    financialDependents: profile.financialDependents,
  });
}

export function deriveWeights(parsedProfile) {
  const shortHorizon = parsedProfile.horizon <= 3;
  const emergencyPriority = parsedProfile.goals.includes('Emergency Fund') || parsedProfile.emergencyFundMonths < 3;
  const goalWeight = parsedProfile.goals.length > 1 ? 0.17 : 0.13;
  const weights = {
    expectedReturn: shortHorizon ? 0.15 : 0.25,
    riskFit: parsedProfile.riskLevel <= 2 ? 0.32 : 0.25,
    liquidity: emergencyPriority ? 0.24 : 0.15,
    goalFit: goalWeight,
    horizonFit: shortHorizon ? 0.14 : 0.10,
    cost: 0.05,
    mlConfidence: 0.05,
  };
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  return Object.freeze(Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, value / total])));
}

export const scoreReturn = instrument => {
  const value = Number(instrument.expectedReturn ?? instrument.dynamicData?.expectedReturn?.avg);
  if (!Number.isFinite(value)) throw new TypeError('Instrument expected return is not established');
  return clamp(value / 20 * 100, 0, 100);
};
export const scoreRisk = (instrument, profile) => clamp(100 - Math.abs(getInstrumentRisk(instrument) - profile.riskLevel) * 20, 0, 100);
export const scoreLiquidity = instrument => {
  const value = Number(instrument.liquidityScore ?? instrument.dynamicData?.liquidity?.score);
  if (!Number.isFinite(value)) throw new TypeError('Instrument liquidity classification is not established');
  return clamp(value * 20, 0, 100);
};
export const scoreCost = instrument => {
  const value = Number(instrument.expenseRatio ?? instrument.dynamicData?.expenseRatio);
  if (!Number.isFinite(value)) throw new TypeError('Instrument cost assumption is not established');
  return clamp(100 - value * 2000, 0, 100);
};
export const scoreGoal = (instrument, profile) => {
  const tags = instrument.goalTags ?? instrument.dynamicData?.goalTags;
  if (!Array.isArray(tags)) throw new TypeError('Instrument goal classification is not established');
  return profile.goals.some(goal => tags.includes(goal)) ? 100 : 35;
};
export const scoreHorizon = (instrument, profile) => {
  const range = instrument.idealHorizon || instrument.dynamicData?.idealHorizon || {};
  if (!Number.isFinite(Number(range.min)) || !Number.isFinite(Number(range.max))) {
    throw new TypeError('Instrument horizon classification is not established');
  }
  return profile.horizon >= Number(range.min) && profile.horizon <= Number(range.max ?? 30) ? 100 : 40;
};
export function normaliseConfidenceScores(mlResult = {}) {
  const source = mlResult.confidence_scores || mlResult.confidenceScores || {};
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    const number = Number(value);
    if (Number.isFinite(number)) result[key] = clamp(number, 0, 1);
  }
  return result;
}

export function computeInstrumentScore(instrument, profile, weights, confidenceScores = {}) {
  const backendType = resolveBackendType(instrument);
  const factors = {
    expectedReturn: scoreReturn(instrument),
    riskFit: scoreRisk(instrument, profile),
    liquidity: scoreLiquidity(instrument),
    goalFit: scoreGoal(instrument, profile),
    horizonFit: scoreHorizon(instrument, profile),
    cost: scoreCost(instrument),
    mlConfidence: (confidenceScores[backendType] || 0) * 100,
  };
  const score = Object.entries(weights).reduce((sum, [key, weight]) => sum + factors[key] * weight, 0);
  return { score: round(score), factors };
}

export function rankInstruments(instruments, profile, weights, confidenceScores = {}) {
  return [...instruments].map(instrument => ({
    instrument,
    ...computeInstrumentScore(instrument, profile, weights, confidenceScores),
  })).sort((a, b) => b.score - a.score || String(a.instrument.id).localeCompare(String(b.instrument.id)));
}

export function enforceDiversity(ranked, topN = PIPELINE_CONFIG.topN, minAssetClasses = 3) {
  const selected = ranked.slice(0, topN);
  const represented = new Set(selected.map(row => row.instrument.assetClass || row.instrument.category));
  if (represented.size >= minAssetClasses) return selected;
  for (const candidate of ranked.slice(topN)) {
    const assetClass = candidate.instrument.assetClass || candidate.instrument.category;
    if (!represented.has(assetClass)) {
      selected[selected.length - 1] = candidate;
      represented.add(assetClass);
      if (represented.size >= minAssetClasses) break;
    }
  }
  return selected.sort((a, b) => b.score - a.score);
}

export function resolveConcentrationCap(instrument = {}) {
  const text = `${instrument.id || ''} ${instrument.type || ''} ${instrument.name || ''}`.toLowerCase();
  const entries = [
    ['smallcap_mf', /small.?cap/], ['midcap_mf', /mid.?cap/], ['direct_equity', /direct.?equity|stock/],
    ['sgb', /sovereign gold|\bsgb\b/], ['gold_etf', /gold.*etf|etf.*gold/], ['nps', /\bnps\b|national pension/],
  ];
  const match = entries.find(([, pattern]) => pattern.test(text));
  if (!match) return null;
  return { key: match[0], maxPct: CONCENTRATION_CAPS[match[0]].maxPct };
}

export function enforceAllocationTargets(instruments) {
  if (!instruments.length) return instruments;
  if (instruments.some(item => !Number.isFinite(item.score))) {
    throw new TypeError('Every allocation candidate must have a finite score');
  }
  const totalScore = instruments.reduce((sum, item) => sum + Math.max(0, item.score), 0);
  if (totalScore <= 0) throw new RangeError('Allocation scores must contain a positive value');
  let allocations = instruments.map(item => ({
    ...item,
    allocation_pct: Math.max(0, item.score) / totalScore * 100,
  }));

  for (let pass = 0; pass < 10; pass += 1) {
    let overflow = 0;
    const groups = new Map();
    allocations.forEach((item, index) => {
      const cap = resolveConcentrationCap(item);
      if (!cap) return;
      if (!groups.has(cap.key)) groups.set(cap.key, { cap: cap.maxPct, indexes: [] });
      groups.get(cap.key).indexes.push(index);
    });
    const cappedIndexes = new Set();
    groups.forEach(group => {
      const total = group.indexes.reduce((sum, index) => sum + allocations[index].allocation_pct, 0);
      if (total > group.cap + 1e-8) {
        const scale = group.cap / total;
        group.indexes.forEach(index => {
          overflow += allocations[index].allocation_pct * (1 - scale);
          allocations[index].allocation_pct *= scale;
          cappedIndexes.add(index);
        });
      }
    });
    if (overflow < 1e-8) break;
    const recipients = allocations.map((_, index) => index).filter(index => !cappedIndexes.has(index) && !resolveConcentrationCap(allocations[index]));
    if (!recipients.length) break;
    const base = recipients.reduce((sum, index) => sum + allocations[index].allocation_pct, 0);
    recipients.forEach(index => {
      allocations[index].allocation_pct += overflow * (base > 0 ? allocations[index].allocation_pct / base : 1 / recipients.length);
    });
  }

  const sum = allocations.reduce((total, item) => total + item.allocation_pct, 0);
  if (!Number.isFinite(sum) || sum <= 0) throw new RangeError('Capped allocations have no positive total');
  let assignedWeight = 0;
  return allocations.map((item, index) => {
    const allocationWeight = index === allocations.length - 1
      ? round(1 - assignedWeight, 4)
      : round(item.allocation_pct / sum, 4);
    assignedWeight = round(assignedWeight + allocationWeight, 4);
    return {
      ...item,
      allocation_pct: round(allocationWeight * 100),
      allocationWeight,
    };
  });
}

export const enforceAllocationTargetsHeuristic = enforceAllocationTargets;

function presentationInstrument(row) {
  const instrument = row.instrument;
  const backendType = resolveBackendType(instrument);
  const nominalReturn = round(Number(instrument.expectedReturn ?? instrument.dynamicData?.expectedReturn?.avg));
  const params = INSTRUMENT_PARAMS[backendType] || {};
  return {
    id: instrument.id,
    name: instrument.name,
    type: backendType,
    assetClass: instrument.assetClass || instrument.category,
    nominalReturn,
    effectiveYield: nominalReturn,
    postTaxReturn: null,
    returnBasis: 'PRE_TAX_NOMINAL',
    expenseRatio: Number(instrument.expenseRatio ?? params.expenseRatio ?? 0),
    riskLevel: instrument.riskLabel || instrument.dynamicData?.risk?.level || params.riskLevel,
    riskScore: getInstrumentRisk(instrument),
    lockIn: Number(instrument.lockIn ?? instrument.dynamicData?.liquidity?.lockIn ?? 0),
    tags: [...(instrument.goalTags || instrument.dynamicData?.goalTags || [])],
    taxNotes: 'Tax impact is not personalized because gross taxable income and deductions are outside the Financial Profile.',
    score: row.score,
    scoreFactors: row.factors,
  };
}

export function runPipeline(profileInput, mlResult = {}, options = {}) {
  const canonical = buildRecommendationProfile(profileInput);
  const riskReconciliation = reconcileRisk(canonical);
  const parsed = parseProfile(canonical);
  const computedWeights = deriveWeights(parsed);
  const confidenceScores = normaliseConfidenceScores(mlResult);
  const { eligible, excluded } = filterEligible(investmentDatabase, canonical, riskReconciliation.final_score);
  const ranked = rankInstruments(eligible, parsed, computedWeights, confidenceScores);
  const topN = options.topN === undefined ? PIPELINE_CONFIG.topN : options.topN;
  const minAssetClasses = options.minAssetClasses === undefined ? 3 : options.minAssetClasses;
  if (!Number.isInteger(topN) || topN < 1 || topN > 20) throw new RangeError('topN must be an integer from 1 to 20');
  if (!Number.isInteger(minAssetClasses) || minAssetClasses < 1 || minAssetClasses > topN) {
    throw new RangeError('minAssetClasses must be an integer from 1 to topN');
  }
  const selected = enforceDiversity(ranked, topN, minAssetClasses);
  let instruments = enforceAllocationTargets(selected.map(presentationInstrument));
  instruments = instruments.filter(instrument => instrument.riskScore <= riskReconciliation.final_score);
  riskReconciliation.excluded_due_to_eligibility = excluded;
  return { instruments, confidenceScores, riskReconciliation, computedWeights };
}

/**
 * WTI is an alternate presentation of the same server-side suitability decision.
 * Client candidates are display selectors only; all financial metadata comes from
 * the authoritative catalog and unknown ids fail closed.
 */
export function rankWhereToInvestBackend(candidates = [], profileInput, options = {}) {
  const canonical = buildRecommendationProfile(profileInput);
  const riskReconciliation = reconcileRisk(canonical);
  const catalog = investmentDatabase.find(instrument => String(instrument.id) === String(options.parentInstrumentId));
  const excluded = [];
  if (!catalog) {
    excluded.push({
      id: options.parentInstrumentId,
      reasonCode: 'CATALOG_INSTRUMENT_NOT_ESTABLISHED',
    });
    const empty = [];
    Object.defineProperty(empty, 'metadata', { value: { excluded, riskReconciliation }, enumerable: false });
    return empty;
  }
  const reasonCode = exclusionReason(catalog, canonical, riskReconciliation.final_score);
  if (reasonCode) {
    excluded.push({ id: catalog.id, name: catalog.name, reasonCode });
    const empty = [];
    Object.defineProperty(empty, 'metadata', { value: { excluded, riskReconciliation }, enumerable: false });
    return empty;
  }

  const parsed = parseProfile(canonical);
  const weights = deriveWeights(parsed);
  const scored = computeInstrumentScore(catalog, parsed, weights, {});
  const parent = presentationInstrument({ instrument: catalog, ...scored });
  const ranked = candidates.map((candidate, index) => ({
    id: candidate.id || `${catalog.id}:provider:${index + 1}`,
    name: candidate.name,
    provider: candidate.provider,
    platform: candidate.platform,
    minInvestment: candidate.minInvestment,
    tenure: candidate.tenure,
    highlight: candidate.highlight,
    badge: candidate.badge,
    parentInstrumentId: catalog.id,
    nominalReturn: parent.nominalReturn,
    effectiveYield: parent.effectiveYield,
    postTaxReturn: null,
    returnBasis: parent.returnBasis,
    expenseRatio: parent.expenseRatio,
    riskLevel: parent.riskLevel,
    riskScore: parent.riskScore,
    score: parent.score,
    matchTags: [...new Set([...(parent.tags || []), `Suitable for ${riskReconciliation.final_risk_tier}`])],
    investmentRoute: canonical.hasLumpSum ? 'SIP + Lump Sum' : 'SIP',
    rankingBasis: 'AUTHORITATIVE_PARENT_INSTRUMENT_SUITABILITY_CURATED_PROVIDER_ORDER',
  }));
  Object.defineProperty(ranked, 'metadata', { value: { excluded, riskReconciliation }, enumerable: false });
  return ranked;
}

export function assertPortfolioSuitable(profileInput, instruments) {
  const canonical = buildRecommendationProfile(profileInput);
  const suitability = assessSuitabilityRisk(canonical);
  const violations = [];
  for (const input of instruments || []) {
    const exactCatalog = investmentDatabase.find(instrument => instrument.id === input);
    if (exactCatalog) {
      const reasonCode = exclusionReason(exactCatalog, canonical, suitability.finalLevel);
      if (reasonCode) violations.push({ instrument: input, reasonCode });
      continue;
    }
    const mappedCatalog = investmentDatabase.find(instrument => resolveBackendType(instrument) === input);
    if (mappedCatalog) {
      const reasonCode = exclusionReason(mappedCatalog, canonical, suitability.finalLevel);
      if (reasonCode) violations.push({ instrument: input, reasonCode });
    } else {
      const params = INSTRUMENT_PARAMS[input];
      if (!params) {
        violations.push({ instrument: input, reasonCode: 'CATALOG_INSTRUMENT_NOT_ESTABLISHED' });
        continue;
      }
      const risk = getInstrumentRisk(params);
      if (risk === null) violations.push({ instrument: input, reasonCode: 'RISK_CLASSIFICATION_NOT_ESTABLISHED' });
      else if (risk > suitability.finalLevel) violations.push({ instrument: input, reasonCode: 'RISK_EXCEEDS_FINAL_SUITABILITY' });
      else if (!Number.isFinite(params.lockIn)) violations.push({ instrument: input, reasonCode: 'LOCK_IN_NOT_ESTABLISHED' });
      else if (params.lockIn > canonical.investmentHorizonYears) violations.push({ instrument: input, reasonCode: 'LOCK_IN_EXCEEDS_HORIZON' });
    }
  }
  if (violations.length) {
    const error = new Error('Portfolio contains instruments outside the profile suitability boundary.');
    error.code = 'PORTFOLIO_SUITABILITY_VIOLATION';
    error.violations = violations;
    throw error;
  }
  return suitability;
}

export const normalizeProfile = buildRecommendationProfile;

export default {
  runPipeline,
  rankWhereToInvestBackend,
  filterEligible,
  reconcileRisk,
  assertPortfolioSuitable,
};
