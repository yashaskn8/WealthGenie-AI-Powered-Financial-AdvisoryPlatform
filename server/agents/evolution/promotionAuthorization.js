import crypto from 'node:crypto';
import { canonicalSha256 } from '../../utils/canonicalJson.js';

export const PROMOTION_ACTION = 'PROMOTE_AGENT_SCAFFOLD';
const VERIFIED_PROMOTION_AUTHORIZATION = Symbol('VerifiedPromotionAuthorization');

function evaluationHash(evaluation) {
  return canonicalSha256({
    candidateId: evaluation?.candidateId || null,
    passed: evaluation?.passed === true,
    scoreCards: evaluation?.scoreCards || [],
    hardGates: evaluation?.hardGates || null,
  });
}

export function assertPromotionEvaluation({ candidate, evaluation } = {}) {
  if (!candidate?.contentHash || evaluation?.passed !== true
      || evaluation?.candidateId !== candidate.contentHash
      || !Array.isArray(evaluation?.scoreCards)
      || evaluation.scoreCards.length === 0
      || evaluation.scoreCards.some(card => (
        card?.candidateId !== candidate.contentHash
        || card?.passed !== true
        || card?.hardGatePassed !== true
      ))) {
    throw new Error('Promotion requires a non-empty, passed evaluation bound to this candidate with every hard gate passed.');
  }
  return true;
}

export function promotionAuthorizationHash({ candidateHash, baselineHash, evaluationHash: evaluatedHash, mandateHash, reviewerId, approvalId, credentialId, expiresAt } = {}) {
  return canonicalSha256({
    action: PROMOTION_ACTION,
    candidateHash,
    baselineHash,
    evaluationHash: evaluatedHash,
    mandateHash,
    reviewerId,
    approvalId,
    credentialId,
    expiresAt,
  });
}

export function promotionMandateHash(mandate = {}) {
  return canonicalSha256({
    mandateId: mandate.mandateId,
    action: mandate.action,
    candidateHash: mandate.candidateHash,
    baselineHash: mandate.baselineHash,
    evaluationHash: mandate.evaluationHash,
    reviewerId: mandate.reviewerId,
    expiresAt: mandate.expiresAt,
  });
}

export function isVerifiedPromotionAuthorization(authorization) {
  return Boolean(authorization?.[VERIFIED_PROMOTION_AUTHORIZATION] === true);
}

export function buildPromotionMandate({ candidate, baselineHash, evaluation, reviewerId, mandateId = crypto.randomUUID(), expiresAt = new Date(Date.now() + 300000).toISOString() } = {}) {
  assertPromotionEvaluation({ candidate, evaluation });
  if (!reviewerId || !/^[a-f0-9]{64}$/.test(baselineHash || '')) throw new Error('A passed candidate, current baseline, and reviewer are required.');
  const mandate = {
    mandateId,
    action: PROMOTION_ACTION,
    candidateHash: candidate.contentHash,
    baselineHash,
    evaluationHash: evaluationHash(evaluation),
    reviewerId: String(reviewerId),
    expiresAt,
  };
  return Object.freeze({ ...mandate, mandateHash: promotionMandateHash(mandate) });
}

/**
 * Promotion consumes an approval already verified by the configured human
 * step-up provider. String names and ticket IDs are never sufficient.
 */
export function verifyPromotionAuthorization({ authorization, candidate, baselineHash, evaluation, now = new Date() } = {}) {
  assertPromotionEvaluation({ candidate, evaluation });
  if (!isVerifiedPromotionAuthorization(authorization) || authorization.verified !== true || authorization.method !== 'WEBAUTHN') throw new Error('Cryptographic WebAuthn human approval is required.');
  if (authorization.action !== PROMOTION_ACTION) throw new Error('Promotion authorization is bound to a different action.');
  if (!authorization.approvalId || !authorization.reviewerId || !authorization.mandateHash || !authorization.credentialId) throw new Error('Promotion approval proof is incomplete.');
  if (new Date(authorization.expiresAt).getTime() <= now.getTime()) throw new Error('Promotion approval has expired.');
  if (!/^[a-f0-9]{64}$/.test(baselineHash || '') || authorization.baselineHash !== baselineHash) {
    throw new Error('Promotion approval is bound to a different active baseline.');
  }
  const expected = promotionAuthorizationHash({
    candidateHash: candidate?.contentHash,
    baselineHash,
    evaluationHash: evaluationHash(evaluation),
    mandateHash: authorization.mandateHash,
    reviewerId: authorization.reviewerId,
    approvalId: authorization.approvalId,
    credentialId: authorization.credentialId,
    expiresAt: authorization.expiresAt,
  });
  if (authorization.authorizationHash !== expected) throw new Error('Promotion approval proof does not match the candidate evaluation.');
  return true;
}

export async function createPromotionAuthorization({ candidate, baselineHash, evaluation, reviewerId, mandate, assertion, approvalProvider, credential = null } = {}) {
  assertPromotionEvaluation({ candidate, evaluation });
  if (!baselineHash || mandate?.baselineHash !== baselineHash) throw new Error('Promotion mandate does not bind the supplied active baseline.');
  const mandateExpiry = Date.parse(mandate?.expiresAt);
  if (mandate?.action !== PROMOTION_ACTION
      || mandate.candidateHash !== candidate?.contentHash
      || mandate.evaluationHash !== evaluationHash(evaluation)
      || mandate.reviewerId !== String(reviewerId || '')
      || !Number.isFinite(mandateExpiry)
      || mandateExpiry <= Date.now()
      || typeof mandate.mandateHash !== 'string'
      || mandate.mandateHash !== promotionMandateHash(mandate)) {
    throw new Error('Promotion mandate does not bind the supplied candidate, evaluation, reviewer, action, and live expiry.');
  }
  if (typeof approvalProvider?.verify !== 'function') throw new Error('A configured WebAuthn approval verifier is required for scaffold promotion.');
  const approval = await approvalProvider.verify({ mandate, assertion, credential });
  if (!approval?.verified || approval.method !== 'WEBAUTHN') throw new Error('Human promotion approval was not cryptographically verified.');
  const authorization = {
    action: PROMOTION_ACTION,
    verified: true,
    method: 'WEBAUTHN',
    approvalId: String(approval.approvalId || crypto.randomUUID()),
    baselineHash,
    reviewerId: String(reviewerId),
    credentialId: String(approval.credentialId || assertion?.credentialId || ''),
    mandateHash: String(mandate?.mandateHash || ''),
    expiresAt: mandate?.expiresAt,
  };
  Object.defineProperty(authorization, VERIFIED_PROMOTION_AUTHORIZATION, { value: true, enumerable: false });
  authorization.authorizationHash = promotionAuthorizationHash({
    candidateHash: candidate?.contentHash,
    baselineHash,
    evaluationHash: evaluationHash(evaluation),
    mandateHash: authorization.mandateHash,
    reviewerId: authorization.reviewerId,
    approvalId: authorization.approvalId,
    credentialId: authorization.credentialId,
    expiresAt: authorization.expiresAt,
  });
  verifyPromotionAuthorization({ authorization, candidate, baselineHash, evaluation });
  return Object.freeze(authorization);
}
