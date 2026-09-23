import crypto from 'node:crypto';
import { assessGoalCalculationFreshness } from './recommendationState.js';
import { buildGoalCalculationInputFingerprint, GOAL_CALCULATION_POLICY_VERSION } from './goalCalculationProvenance.js';

function plain(value) {
  return value && typeof value.toObject === 'function' ? value.toObject({ flattenMaps: true }) : { ...(value || {}) };
}

function canonicalize(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value === undefined ? null : value;
}

export function buildGoalCalculationFingerprint(goal) {
  const value = plain(goal);
  const targetDate = value.target_date ? new Date(value.target_date) : null;
  const payload = {
    goalId: value._id ? String(value._id) : String(value.goalId || ''),
    profileId: value.profileId ? String(value.profileId) : '',
    goal_name: value.goal_name,
    target_amount: value.target_amount,
    target_date: targetDate && !Number.isNaN(targetDate.getTime()) ? targetDate.toISOString() : null,
    current_savings: value.current_savings,
    priority: value.priority,
    inflation_adjusted_target: value.inflation_adjusted_target,
    recommended_sip: value.recommended_sip,
    simulated_monthly_contribution: value.simulated_monthly_contribution,
    recommended_instrument: value.recommended_instrument,
    probability_of_success: value.probability_of_success,
    gap_amount: value.gap_amount,
    status: value.status,
    monte_carlo_summary: value.monte_carlo_summary,
    chart_data: value.chart_data,
    years_remaining: value.years_remaining,
    simulation_classification: value.simulation_classification,
    return_basis: value.return_basis,
    return_data_class: value.return_data_class,
    return_assumption_version: value.return_assumption_version,
    return_assumption_source: value.return_assumption_source,
    inflation_assumption: value.inflation_assumption,
    sourceRecommendationFingerprint: value.sourceRecommendationFingerprint,
    sourcePortfolioFingerprint: value.sourcePortfolioFingerprint,
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');
}

function advisoryFreshness(goal, state, calculationFreshness) {
  if (calculationFreshness.fresh !== true) {
    return {
      fresh: false,
      reasonCodes: [...new Set([...(calculationFreshness.reasonCodes || []), 'ADVISORY_SOURCE_STATE_CHANGED'])],
    };
  }
  if (!goal.gemini_advice || !goal.advisoryMetadata) {
    return { fresh: false, reasonCodes: ['ADVICE_MISSING'] };
  }
  const metadata = goal.advisoryMetadata;
  const required = [
    'goalId', 'profileId', 'recommendationId', 'allocationRevision', 'allocationRevisionId',
    'portfolioFingerprint', 'recommendationFingerprint', 'profileInputHash',
    'recommendationPolicyVersion', 'regulatoryRuleVersion', 'returnAssumptionHash',
    'profileVersion', 'goalCalculationFingerprint', 'generatedAt',
    'goalCalculationInputFingerprint', 'goalCalculationPolicyVersion',
  ];
  if (required.some(field => metadata[field] === null || metadata[field] === undefined || metadata[field] === '')) {
    return { fresh: false, reasonCodes: ['ADVISORY_PROVENANCE_MISSING'] };
  }
  const matches = String(metadata.goalId) === String(goal._id)
    && String(metadata.profileId) === String(goal.profileId)
    && String(metadata.recommendationId) === String(state.recommendation._id)
    && Number(metadata.allocationRevision) === Number(state.allocationRevision.revision)
    && String(metadata.allocationRevisionId) === String(state.allocationRevision._id)
    && metadata.portfolioFingerprint === state.portfolioFingerprint
    && metadata.recommendationFingerprint === state.recommendationFingerprint
    && metadata.profileInputHash === state.recommendation.profileInputHash
    && metadata.recommendationPolicyVersion === state.recommendation.recommendationPolicyVersion
    && metadata.regulatoryRuleVersion === state.recommendation.regulatoryRuleVersion
    && metadata.returnAssumptionHash === state.allocationRevision.returnAssumptionHash
    && Number(metadata.profileVersion) === Number(state.profileVersion)
    && metadata.goalCalculationInputFingerprint === buildGoalCalculationInputFingerprint(goal)
    && metadata.goalCalculationPolicyVersion === GOAL_CALCULATION_POLICY_VERSION
    && metadata.goalCalculationFingerprint === buildGoalCalculationFingerprint(goal);
  return matches
    ? { fresh: true, reasonCodes: [] }
    : { fresh: false, reasonCodes: ['ADVISORY_SOURCE_STATE_CHANGED'] };
}

const DERIVED_FIELDS = Object.freeze([
  'inflation_adjusted_target',
  'recommended_sip',
  'simulated_monthly_contribution',
  'recommended_instrument',
  'probability_of_success',
  'gap_amount',
  'status',
  'monte_carlo_summary',
  'chart_data',
  'years_remaining',
  'mc_computed_at',
  'return_basis',
  'return_data_class',
  'return_assumption_version',
  'return_assumption_source',
  'inflation_assumption',
]);

/**
 * Build every goal response from the current canonical financial state.
 * A stale or unavailable source never gets a warning-only response: all
 * allocation-dependent fields are explicitly unavailable.
 */
export function buildCurrentGoalResponse(goal, { state = null } = {}) {
  const raw = plain(goal);
  const calculationFreshness = state?.recommendation
    ? assessGoalCalculationFreshness(raw, state)
    : { fresh: false, reasonCodes: ['SOURCE_MISSING'] };
  const fresh = calculationFreshness.fresh === true;
  const advisory = advisoryFreshness(raw, state, calculationFreshness);
  const response = {
    ...raw,
    goalId: raw._id ? String(raw._id) : raw.goalId,
    chartData: fresh ? (raw.chart_data || []) : [],
    calculation_freshness: calculationFreshness,
    advisory_freshness: advisory,
    advice_stale: advisory.fresh !== true,
    source_provenance: {
      recommendationId: raw.sourceRecommendationId ? String(raw.sourceRecommendationId) : null,
      allocationRevision: raw.sourceAllocationRevision ?? null,
      allocationRevisionId: raw.sourceAllocationRevisionId ? String(raw.sourceAllocationRevisionId) : null,
      profileInputHash: raw.sourceProfileInputHash || null,
      profileVersion: raw.sourceProfileVersion ?? null,
      modelVersion: raw.sourceModelVersion || null,
      recommendationPolicyVersion: raw.sourceRecommendationPolicyVersion || null,
      regulatoryRuleVersion: raw.sourceRegulatoryRuleVersion || null,
      returnAssumptionVersion: raw.sourceReturnAssumptionVersion || null,
      returnAssumptionHash: raw.sourceReturnAssumptionHash || null,
      portfolioFingerprint: raw.sourcePortfolioFingerprint || null,
      recommendationFingerprint: raw.sourceRecommendationFingerprint || null,
      goalCalculationInputFingerprint: raw.sourceGoalCalculationInputFingerprint || null,
      goalCalculationPolicyVersion: raw.sourceGoalCalculationPolicyVersion || null,
    },
    gemini_advice: advisory.fresh === true ? raw.gemini_advice : null,
  };
  if (!fresh) {
    for (const field of DERIVED_FIELDS) response[field] = field === 'chart_data' ? [] : null;
    response.chartData = [];
  }
  if (!fresh) response.advisoryMetadata = null;
  return response;
}

export function buildGoalAdvisoryMetadata({ goal, state, generatedAt = new Date() } = {}) {
  return {
    status: 'READY',
    goalId: String(goal._id),
    profileId: String(goal.profileId),
    recommendationId: String(state.recommendation._id),
    allocationRevision: state.allocationRevision.revision,
    allocationRevisionId: String(state.allocationRevision._id),
    portfolioFingerprint: state.portfolioFingerprint,
    recommendationFingerprint: state.recommendationFingerprint,
    profileInputHash: state.recommendation.profileInputHash,
    recommendationPolicyVersion: state.recommendation.recommendationPolicyVersion,
    regulatoryRuleVersion: state.recommendation.regulatoryRuleVersion,
    returnAssumptionHash: state.allocationRevision.returnAssumptionHash,
    profileVersion: state.profileVersion,
    goalCalculationFingerprint: buildGoalCalculationFingerprint(goal),
    goalCalculationInputFingerprint: buildGoalCalculationInputFingerprint(goal),
    goalCalculationPolicyVersion: GOAL_CALCULATION_POLICY_VERSION,
    generatedAt,
  };
}
