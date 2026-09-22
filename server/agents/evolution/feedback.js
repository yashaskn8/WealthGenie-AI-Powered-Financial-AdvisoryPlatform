import { canonicalSha256 } from '../../utils/canonicalJson.js';

function safeText(value, max = 500) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
}

export function buildGepaFeedback({ candidateId, evaluation = null, reliability = null, authorityDelta = 0, failures = [], sandbox = null } = {}) {
  const cards = evaluation?.scoreCards || [];
  const passed = cards.filter(card => card.passed).length;
  const lines = [
    `Candidate: ${safeText(candidateId, 120)}`,
    `Result: ${cards.length ? (passed / cards.length).toFixed(3) : '0.000'}`,
    `Feedback:`,
    `- train/validation scorecards passed: ${passed}/${cards.length}`,
    `- financial authority delta: ${Number(authorityDelta) === 0 ? '0' : safeText(authorityDelta, 20)}`,
    `- reliability lab: ${reliability?.passed === true ? 'passed' : 'failed'}`,
    `- sandbox attestation: ${sandbox?.manifestHash ? 'present' : 'missing'}`,
  ];
  for (const card of cards.slice(0, 12)) {
    const failedGates = Object.entries(card.hardGates || {}).filter(([key, value]) => !['forbiddenTools', 'unsupportedTools', 'financialAuthorityDelta', 'authorityMeasurementState'].includes(key) && value === false).map(([key]) => key);
    if (failedGates.length) lines.push(`- ${card.partition} case failed gates: ${failedGates.join(', ')}`);
    if (card.scores?.actionCorrect === false) lines.push(`- ${card.partition} action mismatch`);
    if (card.scores?.grounded === false) lines.push(`- ${card.partition} grounding coverage failed`);
  }
  for (const failure of failures.slice(0, 12)) lines.push(`- failure: ${safeText(failure, 300)}`);
  return Object.freeze({ text: lines.join('\n'), contentHash: canonicalSha256(lines.join('\n')) });
}

export function assertGepaFeedbackSafe(feedback) {
  if (!feedback || typeof feedback.text !== 'string' || !feedback.contentHash) throw new Error('Structured GEPA feedback is required.');
  if (/email|phone|income|jwt|password|monthlyTakeHome|userId/i.test(feedback.text)) {
    const error = new Error('GEPA feedback contains sensitive data.');
    error.code = 'GEPA_FEEDBACK_PRIVACY_VIOLATION';
    throw error;
  }
  if (canonicalSha256(feedback.text) !== feedback.contentHash) throw new Error('GEPA feedback hash mismatch.');
  return true;
}
