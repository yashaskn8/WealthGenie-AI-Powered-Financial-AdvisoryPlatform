import crypto from 'node:crypto';
import { canonicalSha256 } from '../../utils/canonicalJson.js';

export const PROMOTION_ACTION = 'PROMOTE_AGENT_SCAFFOLD';
export const ROLLBACK_ACTION = 'ROLLBACK_AGENT_SCAFFOLD';
const VERIFIED_PROMOTION_AUTHORIZATIONS = new WeakSet();

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

export function promotionAuthorizationHash({ candidateHash, baselineHash, evaluationHash: evaluatedHash, activationGeneration, mandateHash, reviewerId, approvalId, credentialId, expiresAt } = {}) {
  return canonicalSha256({
    action: PROMOTION_ACTION,
    candidateHash,
    baselineHash,
    evaluationHash: evaluatedHash,
    activationGeneration,
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
    activationGeneration: mandate.activationGeneration,
    reviewerId: mandate.reviewerId,
    expiresAt: mandate.expiresAt,
  });
}

export function isVerifiedPromotionAuthorization(authorization) {
  return Boolean(authorization && typeof authorization === 'object'
    && VERIFIED_PROMOTION_AUTHORIZATIONS.has(authorization));
}

export function buildPromotionMandate({ candidate, baselineHash, evaluation, activationGeneration = 1, reviewerId, mandateId = crypto.randomUUID(), expiresAt = new Date(Date.now() + 300000).toISOString() } = {}) {
  assertPromotionEvaluation({ candidate, evaluation });
  if (!reviewerId || !/^[a-f0-9]{64}$/.test(baselineHash || '')
      || !Number.isSafeInteger(activationGeneration) || activationGeneration < 1) {
    throw new Error('A passed candidate, current baseline, activation generation, and reviewer are required.');
  }
  const mandate = {
    mandateId,
    action: PROMOTION_ACTION,
    candidateHash: candidate.contentHash,
    baselineHash,
    evaluationHash: evaluationHash(evaluation),
    activationGeneration,
    reviewerId: String(reviewerId),
    expiresAt,
  };
  return Object.freeze({ ...mandate, mandateHash: promotionMandateHash(mandate) });
}

/**
 * Promotion consumes an approval already verified by the configured human
 * step-up provider. String names and ticket IDs are never sufficient.
 */
export function verifyPromotionAuthorization({ authorization, candidate, baselineHash, evaluation, activationGeneration, now = new Date() } = {}) {
  assertPromotionEvaluation({ candidate, evaluation });
  if (!isVerifiedPromotionAuthorization(authorization) || authorization.verified !== true || authorization.method !== 'WEBAUTHN') throw new Error('Cryptographic WebAuthn human approval is required.');
  if (authorization.action !== PROMOTION_ACTION) throw new Error('Promotion authorization is bound to a different action.');
  if (!authorization.approvalId || !authorization.reviewerId || !authorization.mandateHash || !authorization.credentialId) throw new Error('Promotion approval proof is incomplete.');
  if (new Date(authorization.expiresAt).getTime() <= now.getTime()) throw new Error('Promotion approval has expired.');
  if (!/^[a-f0-9]{64}$/.test(baselineHash || '') || authorization.baselineHash !== baselineHash) {
    throw new Error('Promotion approval is bound to a different active baseline.');
  }
  if (!Number.isSafeInteger(activationGeneration) || authorization.activationGeneration !== activationGeneration) {
    throw new Error('Promotion approval is bound to a different active generation.');
  }
  const expected = promotionAuthorizationHash({
    candidateHash: candidate?.contentHash,
    baselineHash,
    evaluationHash: evaluationHash(evaluation),
    activationGeneration: authorization.activationGeneration,
    mandateHash: authorization.mandateHash,
    reviewerId: authorization.reviewerId,
    approvalId: authorization.approvalId,
    credentialId: authorization.credentialId,
    expiresAt: authorization.expiresAt,
  });
  if (authorization.authorizationHash !== expected) throw new Error('Promotion approval proof does not match the candidate evaluation.');
  return true;
}

export async function createPromotionAuthorization({ candidate, baselineHash, evaluation, activationGeneration, reviewerId, mandate, assertion, approvalProvider, credential = null } = {}) {
  activationGeneration ??= mandate?.activationGeneration;
  assertPromotionEvaluation({ candidate, evaluation });
  if (!baselineHash || mandate?.baselineHash !== baselineHash) throw new Error('Promotion mandate does not bind the supplied active baseline.');
  const mandateExpiry = Date.parse(mandate?.expiresAt);
  if (mandate?.action !== PROMOTION_ACTION
      || mandate.candidateHash !== candidate?.contentHash
      || mandate.evaluationHash !== evaluationHash(evaluation)
      || mandate.activationGeneration !== activationGeneration
      || !Number.isSafeInteger(activationGeneration) || activationGeneration < 1
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
    activationGeneration,
    reviewerId: String(reviewerId),
    credentialId: String(approval.credentialId || assertion?.credentialId || ''),
    mandateHash: String(mandate?.mandateHash || ''),
    expiresAt: mandate?.expiresAt,
  };
  authorization.authorizationHash = promotionAuthorizationHash({
    candidateHash: candidate?.contentHash,
    baselineHash,
    evaluationHash: evaluationHash(evaluation),
    activationGeneration: authorization.activationGeneration,
    mandateHash: authorization.mandateHash,
    reviewerId: authorization.reviewerId,
    approvalId: authorization.approvalId,
    credentialId: authorization.credentialId,
    expiresAt: authorization.expiresAt,
  });
  VERIFIED_PROMOTION_AUTHORIZATIONS.add(authorization);
  verifyPromotionAuthorization({ authorization, candidate, baselineHash, evaluation, activationGeneration });
  return Object.freeze(authorization);
}

function rollbackMandateHash(mandate = {}) {
  return canonicalSha256({
    mandateId: mandate.mandateId,
    action: mandate.action,
    currentHash: mandate.currentHash,
    targetHash: mandate.targetHash,
    activationGeneration: mandate.activationGeneration,
    reviewerId: mandate.reviewerId,
    expiresAt: mandate.expiresAt,
  });
}

function rollbackAuthorizationHash(authorization = {}) {
  return canonicalSha256({
    action: ROLLBACK_ACTION,
    currentHash: authorization.currentHash,
    targetHash: authorization.targetHash,
    activationGeneration: authorization.activationGeneration,
    mandateHash: authorization.mandateHash,
    reviewerId: authorization.reviewerId,
    approvalId: authorization.approvalId,
    credentialId: authorization.credentialId,
    expiresAt: authorization.expiresAt,
  });
}

function assertRollbackBinding({ current, target, activationGeneration, reviewerId } = {}) {
  if (!/^[a-f0-9]{64}$/.test(current?.contentHash || '')
      || !/^[a-f0-9]{64}$/.test(target?.contentHash || '')
      || current.contentHash === target.contentHash
      || current.scaffoldId !== target.scaffoldId
      || !Number.isSafeInteger(activationGeneration)
      || activationGeneration < 1
      || !String(reviewerId || '').trim()) {
    throw new Error('Rollback requires the exact active release, its prior activated release, generation, and reviewer.');
  }
}

export function buildRollbackMandate({
  current, target, activationGeneration, reviewerId,
  mandateId = crypto.randomUUID(), expiresAt = new Date(Date.now() + 300000).toISOString(),
} = {}) {
  assertRollbackBinding({ current, target, activationGeneration, reviewerId });
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('Rollback mandate must have a live expiry.');
  const mandate = {
    mandateId: String(mandateId),
    action: ROLLBACK_ACTION,
    currentHash: current.contentHash,
    targetHash: target.contentHash,
    activationGeneration,
    reviewerId: String(reviewerId).trim(),
    expiresAt,
  };
  return Object.freeze({ ...mandate, mandateHash: rollbackMandateHash(mandate) });
}

export function verifyRollbackAuthorization({
  authorization, current, target, activationGeneration, now = new Date(),
} = {}) {
  if (!isVerifiedPromotionAuthorization(authorization)
      || authorization.verified !== true
      || authorization.method !== 'WEBAUTHN') {
    throw new Error('Cryptographic WebAuthn human approval is required to rollback a scaffold.');
  }
  if (authorization.action !== ROLLBACK_ACTION) {
    throw new Error('Rollback requires an independently verified rollback authorization; promotion approval cannot authorize rollback.');
  }
  assertRollbackBinding({
    current,
    target,
    activationGeneration,
    reviewerId: authorization.reviewerId,
  });
  if (!authorization.approvalId || !authorization.credentialId || !authorization.mandateHash
      || authorization.currentHash !== current.contentHash
      || authorization.targetHash !== target.contentHash
      || authorization.activationGeneration !== activationGeneration
      || !Number.isFinite(Date.parse(authorization.expiresAt))
      || Date.parse(authorization.expiresAt) <= now.getTime()
      || authorization.authorizationHash !== rollbackAuthorizationHash(authorization)) {
    throw new Error('Rollback approval does not bind the current release, prior target, generation, and live expiry.');
  }
  return true;
}

export async function createRollbackAuthorization({
  current, target, activationGeneration, reviewerId, mandate, assertion, approvalProvider, credential = null,
} = {}) {
  assertRollbackBinding({ current, target, activationGeneration, reviewerId });
  const mandateExpiry = Date.parse(mandate?.expiresAt);
  if (mandate?.action !== ROLLBACK_ACTION
      || mandate.currentHash !== current.contentHash
      || mandate.targetHash !== target.contentHash
      || mandate.activationGeneration !== activationGeneration
      || mandate.reviewerId !== String(reviewerId || '').trim()
      || !Number.isFinite(mandateExpiry)
      || mandateExpiry <= Date.now()
      || typeof mandate.mandateHash !== 'string'
      || mandate.mandateHash !== rollbackMandateHash(mandate)) {
    throw new Error('Rollback mandate does not bind the current release, exact prior target, generation, reviewer, and live expiry.');
  }
  if (typeof approvalProvider?.verify !== 'function') throw new Error('A configured WebAuthn approval verifier is required for scaffold rollback.');
  const approval = await approvalProvider.verify({ mandate, assertion, credential });
  if (!approval?.verified || approval.method !== 'WEBAUTHN'
      || !approval.approvalId || !approval.credentialId) {
    throw new Error('Human rollback approval was not cryptographically verified.');
  }
  const authorization = {
    action: ROLLBACK_ACTION,
    verified: true,
    method: 'WEBAUTHN',
    approvalId: String(approval.approvalId),
    currentHash: current.contentHash,
    targetHash: target.contentHash,
    activationGeneration,
    reviewerId: String(reviewerId).trim(),
    credentialId: String(approval.credentialId),
    mandateHash: mandate.mandateHash,
    expiresAt: mandate.expiresAt,
  };
  authorization.authorizationHash = rollbackAuthorizationHash(authorization);
  VERIFIED_PROMOTION_AUTHORIZATIONS.add(authorization);
  verifyRollbackAuthorization({ authorization, current, target, activationGeneration });
  return Object.freeze(authorization);
}
