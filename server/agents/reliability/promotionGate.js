export const RELIABILITY_PROMOTION_GATE_VERSION = 'reliability-promotion-gate-1.0.0';

const SHA256_PATTERN = /^[a-f\d]{64}$/i;

function hasMeasuredSystemEvidence(card, metrics) {
  return SHA256_PATTERN.test(card.trajectoryHash || card.systemTrajectoryHash || '')
    && metrics.scenarioId === card.scenarioId
    && metrics.family === card.family
    && Number.isSafeInteger(metrics.eventCount)
    && metrics.eventCount > 0
    && metrics.authorityDelta === 0
    && metrics.processPassed === true
    && metrics.outcomePassed === true;
}

function hasMeasuredCandidateEvidence(card, metrics) {
  return card.candidateExecuted === true
    && card.candidateAuthorityMeasured === true
    && Number.isSafeInteger(card.candidateTrajectoryEventCount)
    && card.candidateTrajectoryEventCount > 0
    && SHA256_PATTERN.test(card.candidateTrajectoryHash || '')
    && SHA256_PATTERN.test(card.candidateId || '')
    && SHA256_PATTERN.test(card.scaffoldHash || '')
    && SHA256_PATTERN.test(card.promptBundleHash || '')
    && metrics.scenarioId === card.scenarioId
    && metrics.family === card.family
    && metrics.eventCount === card.candidateTrajectoryEventCount
    && metrics.authorityDelta === 0
    && metrics.processPassed === true
    && metrics.outcomePassed === true;
}

function hasExactScenarioCoverage(scorecards, expectedScenarioIds) {
  if (!Array.isArray(expectedScenarioIds) || expectedScenarioIds.length === 0) return false;
  if (!expectedScenarioIds.every(id => typeof id === 'string' && id.trim())) return false;
  const expected = new Set(expectedScenarioIds);
  if (expected.size !== expectedScenarioIds.length || scorecards.length !== expected.size) return false;
  const actual = scorecards.map(card => card?.scenarioId);
  return actual.every(id => expected.has(id)) && new Set(actual).size === expected.size;
}

export function buildReliabilityPromotionEvaluation({
  scorecards = [],
  candidateReliabilityCoverageComplete = false,
  expectedScenarioIds = [],
} = {}) {
  const inputIsArray = Array.isArray(scorecards);
  const cards = inputIsArray ? scorecards : [];
  const criticalFailures = cards.flatMap(card => (
    Array.isArray(card?.criticalFailures) ? card.criticalFailures : ['MALFORMED_RELIABILITY_SCORECARD']
  ));
  const authorityEvidenceComplete = cards.length > 0 && cards.every(card => (
    typeof card?.authorityDelta === 'number' && Number.isFinite(card.authorityDelta)
  ));
  const authoritySum = authorityEvidenceComplete
    ? cards.reduce((sum, card) => sum + card.authorityDelta, 0)
    : null;
  const authorityDelta = Number.isFinite(authoritySum) ? authoritySum : null;
  const cardEvidenceComplete = cards.length > 0 && cards.every(card => {
    if (!card || typeof card !== 'object' || Array.isArray(card)
        || typeof card.scenarioId !== 'string' || !card.scenarioId.trim()
        || typeof card.family !== 'string' || !card.family.trim()
        || card.processPassed !== true || card.outcomePassed !== true
        || card.hardGatePassed !== true || card.passed !== true
        || !Array.isArray(card.criticalFailures) || card.criticalFailures.length !== 0
        || typeof card.authorityDelta !== 'number' || !Number.isFinite(card.authorityDelta)
        || card.authorityDelta !== 0
        || !card.metrics || typeof card.metrics !== 'object' || Array.isArray(card.metrics)) return false;

    const mode = card.executionMode || (card.family === 'CANDIDATE_BEHAVIOR' ? null : 'SYSTEM_ONLY');
    if (mode === 'SYSTEM_ONLY') return hasMeasuredSystemEvidence(card, card.metrics);
    if (mode === 'CANDIDATE_BOUND') return hasMeasuredCandidateEvidence(card, card.metrics);
    return false;
  });
  const hasCandidateBoundScenarios = cards.some(card => card?.executionMode === 'CANDIDATE_BOUND');
  const exactCoverage = inputIsArray && hasExactScenarioCoverage(cards, expectedScenarioIds);
  const candidateCoverageComplete = !hasCandidateBoundScenarios || candidateReliabilityCoverageComplete === true;
  const passed = exactCoverage
    && cardEvidenceComplete
    && candidateCoverageComplete
    && criticalFailures.length === 0
    && authorityDelta === 0;
  return Object.freeze({
    version: RELIABILITY_PROMOTION_GATE_VERSION,
    passed,
    candidateReliabilityCoverageComplete: candidateCoverageComplete,
    scoreCards: cards.map(card => ({ ...card, hardGatePassed: passed ? card.hardGatePassed : false })),
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
