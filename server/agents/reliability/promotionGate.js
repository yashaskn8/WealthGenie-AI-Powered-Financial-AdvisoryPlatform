export const RELIABILITY_PROMOTION_GATE_VERSION = 'reliability-promotion-gate-1.0.0';

export function buildReliabilityPromotionEvaluation({ scorecards = [], holdout = null } = {}) {
  const criticalFailures = scorecards.flatMap(card => card.criticalFailures || []);
  const authorityDelta = scorecards.reduce((sum, card) => sum + Number(card.authorityDelta || 0), 0);
  const passed = Boolean(holdout?.sealed) && criticalFailures.length === 0 && authorityDelta === 0 && scorecards.every(card => card.hardGatePassed === true && card.passed === true);
  return Object.freeze({
    version: RELIABILITY_PROMOTION_GATE_VERSION,
    passed,
    holdoutSealed: Boolean(holdout?.sealed),
    scoreCards: scorecards.map(card => ({ ...card, hardGatePassed: passed ? card.hardGatePassed : false })),
    criticalFailures: [...new Set(criticalFailures)],
    financialAuthorityDelta: authorityDelta,
    appliedToProduction: false,
  });
}

export function assertReliabilityPromotionSafe(evaluation) {
  if (!evaluation?.passed || evaluation.financialAuthorityDelta !== 0 || evaluation.appliedToProduction !== false) {
    const error = new Error('Reliability promotion gate failed closed.');
    error.code = 'RELIABILITY_PROMOTION_GATE_FAILED';
    throw error;
  }
  return true;
}
