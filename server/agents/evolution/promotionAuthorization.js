import crypto from 'node:crypto';
import { canonicalSha256 } from '../../utils/canonicalJson.js';

export const PROMOTION_ACTION = 'PROMOTE_AGENT_SCAFFOLD';
const VERIFIED_PROMOTION_AUTHORIZATION = Symbol('VerifiedPromotionAuthorization');

function evaluationHash(evaluation) {
  return canonicalSha256({
    passed: evaluation?.passed === true,
    scoreCards: evaluation?.scoreCards || [],
    hardGates: evaluation?.hardGates || null,
  });
}

export function promotionAuthorizationHash({ candidateHash, evaluationHash: evaluatedHash, mandateHash, reviewerId, approvalId } = {}) {
  return canonicalSha256({ action: PROMOTION_ACTION, candidateHash, evaluationHash: evaluatedHash, mandateHash, reviewerId, approvalId });
}

export function isVerifiedPromotionAuthorization(authorization) {
  return Boolean(authorization?.[VERIFIED_PROMOTION_AUTHORIZATION] === true);
}

export function buildPromotionMandate({ candidate, evaluation, reviewerId, mandateId = crypto.randomUUID(), expiresAt = new Date(Date.now() + 300000).toISOString() } = {}) {
  if (!candidate?.contentHash || !reviewerId || !evaluation?.passed) throw new Error('A passed candidate and reviewer are required.');
  return Object.freeze({
    mandateId,
    action: PROMOTION_ACTION,
    candidateHash: candidate.contentHash,
    evaluationHash: evaluationHash(evaluation),
    reviewerId: String(reviewerId),
    expiresAt,
  });
}

/**
 * Promotion consumes an approval already verified by the configured human
 * step-up provider. String names and ticket IDs are never sufficient.
 */
export function verifyPromotionAuthorization({ authorization, candidate, evaluation, now = new Date() } = {}) {
  if (!isVerifiedPromotionAuthorization(authorization) || authorization.verified !== true || authorization.method !== 'WEBAUTHN') throw new Error('Cryptographic WebAuthn human approval is required.');
  if (!authorization.approvalId || !authorization.reviewerId || !authorization.mandateHash || !authorization.credentialId) throw new Error('Promotion approval proof is incomplete.');
  if (new Date(authorization.expiresAt).getTime() <= now.getTime()) throw new Error('Promotion approval has expired.');
  const expected = promotionAuthorizationHash({
    candidateHash: candidate?.contentHash,
    evaluationHash: evaluationHash(evaluation),
    mandateHash: authorization.mandateHash,
    reviewerId: authorization.reviewerId,
    approvalId: authorization.approvalId,
  });
  if (authorization.authorizationHash !== expected) throw new Error('Promotion approval proof does not match the candidate evaluation.');
  return true;
}

export async function createPromotionAuthorization({ candidate, evaluation, reviewerId, mandate, assertion, approvalProvider, credential = null } = {}) {
  if (typeof approvalProvider?.verify !== 'function') throw new Error('A configured WebAuthn approval verifier is required for scaffold promotion.');
  const approval = await approvalProvider.verify({ mandate, assertion, credential });
  if (!approval?.verified || approval.method !== 'WEBAUTHN') throw new Error('Human promotion approval was not cryptographically verified.');
  const authorization = {
    verified: true,
    method: 'WEBAUTHN',
    approvalId: String(approval.approvalId || crypto.randomUUID()),
    reviewerId: String(reviewerId),
    credentialId: String(approval.credentialId || assertion?.credentialId || ''),
    mandateHash: String(mandate?.mandateHash || ''),
    expiresAt: mandate?.expiresAt,
  };
  Object.defineProperty(authorization, VERIFIED_PROMOTION_AUTHORIZATION, { value: true, enumerable: false });
  authorization.authorizationHash = promotionAuthorizationHash({
    candidateHash: candidate?.contentHash,
    evaluationHash: evaluationHash(evaluation),
    mandateHash: authorization.mandateHash,
    reviewerId: authorization.reviewerId,
    approvalId: authorization.approvalId,
  });
  verifyPromotionAuthorization({ authorization, candidate, evaluation });
  return authorization;
}
