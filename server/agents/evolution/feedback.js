import crypto from 'node:crypto';
import { canonicalSha256 } from '../../utils/canonicalJson.js';

const VERIFIED_FEEDBACK = new WeakSet();
const SAFE_FAILURE_LABELS = Object.freeze({
  EVOLUTION_BUDGET_EXCEEDED: 'evolution budget exceeded',
  RELIABILITY_SUITE_EMPTY: 'reliability suite was empty',
  SANDBOX_ATTESTATION_MISSING: 'sandbox attestation missing',
});
const SAFE_GATE_NAMES = new Set([
  'noForbiddenTools',
  'allowedToolsOnly',
  'authorityMeasurementComplete',
  'financialAuthorityUnchanged',
  'noSensitiveDataLeak',
  'withinBudget',
  'candidateReliabilityCoverageComplete',
]);

export function buildGepaFeedback({ candidateId, evaluation = null, reliability = null, authorityDelta = null, failures = [], sandbox = null } = {}) {
  const cards = Array.isArray(evaluation?.scoreCards)
    ? evaluation.scoreCards.filter(card => card?.partition === 'train' || card?.partition === 'validation')
    : [];
  const passed = cards.filter(card => card.passed).length;
  const authorityDeltaLabel = authorityDelta !== null && authorityDelta !== undefined && Number.isFinite(Number(authorityDelta))
    ? (Number(authorityDelta) === 0 ? 'unchanged' : 'changed')
    : 'unmeasured';
  const candidateIdentityHash = canonicalSha256(String(candidateId || 'unknown'));
  const lines = [
    `Candidate identity hash: ${candidateIdentityHash}`,
    `Result: ${cards.length ? (passed / cards.length).toFixed(3) : '0.000'}`,
    `Feedback:`,
    `- train/validation scorecards passed: ${passed}/${cards.length}`,
    `- financial authority delta: ${authorityDeltaLabel}`,
    `- reliability lab: ${reliability?.passed === true ? 'passed' : 'failed'}`,
    `- sandbox attestation: ${sandbox?.manifestHash ? 'present' : 'missing'}`,
  ];
  for (const card of cards.slice(0, 12)) {
    const partition = card.partition === 'train' ? 'train' : 'validation';
    const failedGateCount = Object.entries(card.hardGates || {}).filter(([key, value]) => SAFE_GATE_NAMES.has(key) && value === false).length;
    if (failedGateCount) lines.push(`- ${partition} case failed ${failedGateCount} approved hard gate(s)`);
    if (card.scores?.actionCorrect === false) lines.push(`- ${partition} action mismatch`);
    if (card.scores?.grounded === false) lines.push(`- ${partition} grounding coverage failed`);
  }
  const failureLabels = [...new Set(failures.map(failure => {
    const code = typeof failure === 'string' ? failure : failure?.code;
    return SAFE_FAILURE_LABELS[code] || null;
  }).filter(Boolean))].slice(0, 12);
  for (const label of failureLabels) lines.push(`- failure: ${label}`);
  const text = lines.join('\n');
  const feedback = Object.freeze({
    source: 'GOVERNED_EVALUATION',
    evaluationHash: canonicalSha256({
      candidateId: candidateId || null,
      scoreCards: cards,
      reliabilityPassed: reliability?.passed === true,
      authorityDelta: authorityDelta !== null && authorityDelta !== undefined && Number.isFinite(Number(authorityDelta))
        ? Number(authorityDelta)
        : null,
      sandboxManifestHash: sandbox?.manifestHash || null,
      failureLabels,
    }),
    text,
    contentHash: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
  });
  VERIFIED_FEEDBACK.add(feedback);
  return feedback;
}

export function assertGepaFeedbackSafe(feedback) {
  if (!feedback || !VERIFIED_FEEDBACK.has(feedback)
      || feedback.source !== 'GOVERNED_EVALUATION'
      || !/^[a-f0-9]{64}$/.test(feedback.evaluationHash || '')
      || typeof feedback.text !== 'string'
      || !/^[a-f0-9]{64}$/.test(feedback.contentHash || '')) {
    throw new Error('Feedback must come from the governed evaluation builder.');
  }
  if (/email|phone|income|jwt|password|monthlyTakeHome|userId/i.test(feedback.text)) {
    const error = new Error('GEPA feedback contains sensitive data.');
    error.code = 'GEPA_FEEDBACK_PRIVACY_VIOLATION';
    throw error;
  }
  if (crypto.createHash('sha256').update(feedback.text, 'utf8').digest('hex') !== feedback.contentHash) throw new Error('GEPA feedback hash mismatch.');
  return true;
}
