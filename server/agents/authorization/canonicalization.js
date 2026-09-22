import crypto from 'node:crypto';
import { canonicalJson, canonicalSha256 } from '../../utils/canonicalJson.js';
import { ALLOWED_ACTIONS, MAX_CANONICAL_PAYLOAD_BYTES } from './authorizationConstants.js';

const REQUIRED_MANDATE_KEYS = Object.freeze([
  'mandateId', 'version', 'issuer', 'subject', 'audience', 'userId', 'agentIdentity',
  'agentType', 'agentVersion', 'runId', 'correlationId', 'action', 'resourceType',
  'resourceId', 'profileId', 'recommendationId', 'financialSnapshotHash',
  'recommendationFingerprint', 'policyVersion', 'actionPayloadHash', 'constraints',
  'issuedAt', 'notBefore', 'expiresAt', 'nonce', 'singleUse', 'parentGrantId',
  'delegationDepth', 'approvalMethod', 'status',
  'mandateHash', 'signatureMetadata', 'approval',
]);

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
}

function assertKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) throw new TypeError(`${label} contains unsupported fields: ${unknown.join(', ')}`);
}

function assertHash(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new TypeError(`${label} must be a SHA-256 hash`);
}

function normalizeDate(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${label} must be an ISO date`);
  return date.toISOString();
}

export function canonicalizeActionPayload(payload) {
  assertPlainObject(payload, 'Action payload');
  assertKeys(payload, ['profileId', 'recommendationId', 'profileVersion'], 'Action payload');
  if (typeof payload.profileId !== 'string' || !/^[0-9a-f]{24}$/i.test(payload.profileId)) throw new TypeError('Action payload profileId is invalid');
  if (payload.recommendationId !== null && (typeof payload.recommendationId !== 'string' || !/^[0-9a-f]{24}$/i.test(payload.recommendationId))) throw new TypeError('Action payload recommendationId is invalid');
  if (!Number.isInteger(payload.profileVersion) || payload.profileVersion < 1) throw new TypeError('Action payload profileVersion is invalid');
  return { profileId: payload.profileId.toLowerCase(), recommendationId: payload.recommendationId?.toLowerCase() || null, profileVersion: payload.profileVersion };
}

export function hashMandatePayload(mandate) {
  const canonical = canonicalizeMandate(mandate);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function hashActionPayload(payload) {
  return canonicalSha256(canonicalizeActionPayload(payload));
}

export function verifyMandatePayloadHash(mandate, expectedHash = mandate?.mandateHash) {
  if (!expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  return crypto.timingSafeEqual(Buffer.from(hashMandatePayload(mandate), 'hex'), Buffer.from(expectedHash, 'hex'));
}

export function canonicalizeMandate(mandate) {
  assertPlainObject(mandate, 'Mandate');
  assertKeys(mandate, REQUIRED_MANDATE_KEYS, 'Mandate');
  const identity = mandate.agentIdentity;
  assertPlainObject(identity, 'Agent identity');
  assertKeys(identity, ['agentType', 'provider', 'subject', 'authenticated'], 'Agent identity');
  const constraints = mandate.constraints;
  assertPlainObject(constraints, 'Mandate constraints');
  assertKeys(constraints, ['maxAgeSeconds', 'allowedAgentType', 'resourceVersion', 'noFinancialMutationByAgent'], 'Mandate constraints');
  if (mandate.approval) assertKeys(mandate.approval, ['method', 'verifiedAt', 'credentialId', 'challengeHash', 'authenticatorCounter'], 'Mandate approval');
  if (mandate.signatureMetadata) assertKeys(mandate.signatureMetadata, ['algorithm', 'keyId', 'signature', 'environment'], 'Mandate signature metadata');
  for (const [value, label] of [[mandate.financialSnapshotHash, 'financialSnapshotHash'], [mandate.recommendationFingerprint, 'recommendationFingerprint'], [mandate.actionPayloadHash, 'actionPayloadHash']]) assertHash(value, label);
  if (typeof mandate.mandateId !== 'string' || !/^[0-9a-f-]{36}$/i.test(mandate.mandateId)) throw new TypeError('Mandate ID is invalid');
  if (typeof mandate.nonce !== 'string' || !/^[A-Za-z0-9_-]{22,}$/.test(mandate.nonce)) throw new TypeError('Mandate nonce is invalid');
  if (!Number.isInteger(mandate.delegationDepth) || mandate.delegationDepth < 0 || mandate.delegationDepth > 2) throw new TypeError('Mandate delegation depth is invalid');
  if (mandate.singleUse !== true) throw new TypeError('Mandates must be single-use');
  if (!mandate.userId || typeof mandate.agentType !== 'string' || typeof mandate.action !== 'string') throw new TypeError('Mandate identity fields are required');
  if (!ALLOWED_ACTIONS.includes(mandate.action)) throw new TypeError('Mandate action is not allowlisted');
  const resourceId = String(mandate.resourceId || '');
  const profileId = String(mandate.profileId || '');
  if (mandate.resourceType !== 'FinancialProfile' || !/^[0-9a-f]{24}$/i.test(resourceId) || profileId !== resourceId) throw new TypeError('Mandate resource binding is invalid');
  const normalized = {
    mandateId: mandate.mandateId,
    version: mandate.version,
    issuer: mandate.issuer,
    subject: mandate.subject,
    audience: mandate.audience,
    userId: String(mandate.userId),
    agentIdentity: { agentType: identity.agentType, provider: identity.provider, subject: identity.subject, authenticated: identity.authenticated === true },
    agentType: mandate.agentType,
    agentVersion: mandate.agentVersion,
    runId: mandate.runId,
    correlationId: mandate.correlationId || null,
    action: mandate.action,
    resourceType: mandate.resourceType,
    resourceId,
    profileId,
    recommendationId: mandate.recommendationId ? String(mandate.recommendationId) : null,
    financialSnapshotHash: mandate.financialSnapshotHash,
    recommendationFingerprint: mandate.recommendationFingerprint,
    policyVersion: mandate.policyVersion,
    actionPayloadHash: mandate.actionPayloadHash,
    constraints: {
      maxAgeSeconds: constraints.maxAgeSeconds,
      allowedAgentType: constraints.allowedAgentType,
      resourceVersion: constraints.resourceVersion,
      noFinancialMutationByAgent: constraints.noFinancialMutationByAgent === true,
    },
    issuedAt: normalizeDate(mandate.issuedAt, 'issuedAt'),
    notBefore: normalizeDate(mandate.notBefore, 'notBefore'),
    expiresAt: normalizeDate(mandate.expiresAt, 'expiresAt'),
    nonce: mandate.nonce,
    singleUse: true,
    parentGrantId: mandate.parentGrantId || null,
    delegationDepth: mandate.delegationDepth,
    approvalMethod: mandate.approvalMethod,
  };
  const result = canonicalJson(normalized);
  if (Buffer.byteLength(result, 'utf8') > MAX_CANONICAL_PAYLOAD_BYTES) throw new TypeError('Mandate payload exceeds the maximum size');
  return result;
}

export function mandateHashPayload(mandate) {
  return hashMandatePayload(mandate);
}
