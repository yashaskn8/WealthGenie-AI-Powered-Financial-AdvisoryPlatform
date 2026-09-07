import { buildRecommendationProfile, deriveRecommendationMetrics } from './recommendationProfile.js';
import { assessSuitabilityRisk } from './riskProfiler.js';

const clampScore = value => Math.max(0, Math.min(100, Math.round(value)));

function gradeFor(score) {
  if (score >= 80) return { grade: 'Excellent', color: '#10b981' };
  if (score >= 60) return { grade: 'Good', color: '#eab308' };
  if (score >= 40) return { grade: 'Average', color: '#f59e0b' };
  return { grade: 'Poor Fitness', color: '#ef4444' };
}

export function calculateFinancialHealthScore(profileInput, instruments = []) {
  const profile = buildRecommendationProfile(profileInput);
  const metrics = deriveRecommendationMetrics(profile);
  const suitability = assessSuitabilityRisk(profile);
  const active = (instruments || []).filter(instrument => Number(instrument.allocationWeight) > 0);

  const savingsScore = clampScore((metrics.savingsRate / 0.30) * 100);
  const emergencyKnown = profile.emergencyFundMonths !== null;
  const emergencyScore = emergencyKnown ? clampScore((profile.emergencyFundMonths / 6) * 100) : null;
  const assetClasses = new Set(active.map(instrument => instrument.assetClass).filter(Boolean));
  const diversityScore = active.length ? clampScore((assetClasses.size / 3) * 100) : 0;
  const coveredGoals = profile.investmentGoals.filter(goal => active.some(
    instrument => Array.isArray(instrument.tags) && instrument.tags.includes(goal),
  ));
  const goalScore = profile.investmentGoals.length
    ? clampScore((coveredGoals.length / profile.investmentGoals.length) * 100)
    : 0;
  const riskTimelineScore = clampScore(suitability.capacityScore);

  const subScores = [
    { label: 'Savings Capacity', value: savingsScore, weight: 30, extra: `${(metrics.savingsRate * 100).toFixed(1)}% of declared take-home is available for recurring investment.`, alert: savingsScore < 50 },
    {
      label: 'Emergency Safety Net', value: emergencyScore, weight: emergencyKnown ? 25 : 0,
      extra: emergencyKnown
        ? `${profile.emergencyFundMonths} months of emergency-fund coverage were explicitly declared.`
        : 'Emergency-fund coverage was left unknown; no value was assumed and this metric is excluded from the total.',
      alert: !emergencyKnown || emergencyScore < 50, hasDisclaimer: true,
    },
    { label: 'Investment Variety', value: diversityScore, weight: 20, extra: `${assetClasses.size} distinct asset class${assetClasses.size === 1 ? '' : 'es'} in the authoritative allocation.`, alert: false },
    { label: 'Tax Efficiency', value: null, weight: 0, extra: 'Not scored: taxable gross income, income source, deductions, and tax regime are intentionally outside the Financial Profile. Use Post-Tax Analysis.', alert: false },
    { label: 'Goal Coverage', value: goalScore, weight: 15, extra: `${coveredGoals.length} of ${profile.investmentGoals.length} declared goals are represented by authoritative recommendation tags.`, alert: goalScore < 50 },
    { label: 'Risk-Timeline Match', value: riskTimelineScore, weight: 10, extra: `Final suitability: ${suitability.finalRisk}. ${suitability.reasonCodes.join(', ') || 'No capacity reduction reason.'}`, alert: riskTimelineScore < 50 },
  ];
  const scored = subScores.filter(metric => metric.value !== null && metric.weight > 0);
  const totalWeight = scored.reduce((sum, metric) => sum + metric.weight, 0);
  const score = totalWeight > 0
    ? clampScore(scored.reduce((sum, metric) => sum + metric.value * metric.weight, 0) / totalWeight)
    : 0;
  const grade = gradeFor(score);
  return Object.freeze({
    calculation_classification: 'PROFILE_GROUNDED_FINANCIAL_HEALTH',
    methodology_version: 'financial-health-1.0.0',
    score,
    ...grade,
    savings_rate_pct: Number((metrics.savingsRate * 100).toFixed(2)),
    sub_scores: Object.freeze(subScores),
    snapshot: Object.freeze({ recorded_at: new Date().toISOString(), score }),
    peer_comparison: null,
    final_suitability_risk: suitability.finalRisk,
    suitability_reason_codes: suitability.reasonCodes,
  });
}
