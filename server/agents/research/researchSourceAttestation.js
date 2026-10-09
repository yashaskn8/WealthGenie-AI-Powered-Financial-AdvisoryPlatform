import crypto from 'node:crypto';
import { canonicalStringify, EXECUTION_BINDING_HASH_PATTERN } from './researchArtifact.js';
import { RESEARCH_POLICY_VERSION } from './researchConstants.js';
import { isCanonicalRetrievedAt, stripUntrustedDocumentMarkup } from './documentEvidenceExtractor.js';

export const RESEARCH_SOURCE_ATTESTATION_VERSION = 'wealthgenie-source-fetch-attestation/v2';
export const RESEARCH_SOURCE_FETCHER_ID = 'wealthgenie.safe-public-document-fetcher/v1';

const PRIVATE_RSA_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'];
const CONTENT_TYPES = new Set(['text/html', 'text/plain', 'application/json']);
const SOURCE_TIERS = new Set(['OFFICIAL_PRIMARY', 'PRIMARY_ISSUER', 'TRUSTED_SECONDARY', 'UNVERIFIED']);
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function sourceError(code) {
  return Object.assign(new Error('Research source fetch attestation is invalid.'), { code });
}

function canonicalHttpsUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.href !== value) return null;
    return url.href;
  } catch { return null; }
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function normalizeSourceEvidenceBindings(bindings) {
  if (!Array.isArray(bindings) || bindings.length < 1 || bindings.length > 12) return null;
  const normalized = bindings.map(item => ({
    evidenceId: item?.evidenceId,
    supportingExcerptHash: item?.supportingExcerptHash,
  })).sort((a, b) => String(a.evidenceId).localeCompare(String(b.evidenceId)));
  if (normalized.some(item => typeof item.evidenceId !== 'string'
      || item.evidenceId.length < 1 || item.evidenceId.length > 160
      || !HASH_PATTERN.test(item.supportingExcerptHash || ''))
      || new Set(normalized.map(item => item.evidenceId)).size !== normalized.length) return null;
  return normalized;
}

function validateSigningClaims(claims) {
  const requestedUrl = canonicalHttpsUrl(claims?.requestedUrl);
  const canonicalUrl = canonicalHttpsUrl(claims?.canonicalUrl);
  const jurisdiction = typeof claims?.jurisdiction === 'string' ? claims.jurisdiction.trim().toUpperCase() : '';
  const evidenceBindings = normalizeSourceEvidenceBindings(claims?.evidenceBindings);
  if (!requestedUrl || !canonicalUrl
      || typeof claims?.taskId !== 'string' || claims.taskId.trim().length < 1 || claims.taskId.length > 160
      || !HASH_PATTERN.test(claims?.researchBriefHash || '')
      || !EXECUTION_BINDING_HASH_PATTERN.test(claims?.executionBindingHash || '')
      || claims?.researchPolicyVersion !== RESEARCH_POLICY_VERSION
      || !SOURCE_TIERS.has(claims?.freshnessRequiredSourceTier)
      || claims?.publicationDate !== null
      || !evidenceBindings
      || !isCanonicalRetrievedAt(claims?.retrievedAt)
      || typeof claims?.contentType !== 'string'
      || !(CONTENT_TYPES.has(claims.contentType) || claims.contentType.startsWith('text/'))
      || claims?.statusCode !== 200
      || !Number.isSafeInteger(claims?.redirectCount) || claims.redirectCount < 0 || claims.redirectCount > 3
      || !HASH_PATTERN.test(claims?.rawBodySha256 || '')
      || !HASH_PATTERN.test(claims?.documentHash || '')
      || !Number.isSafeInteger(claims?.freshnessMaxAgeHours)
      || claims.freshnessMaxAgeHours < 1 || claims.freshnessMaxAgeHours > 8760
      || !/^[A-Z]{2,3}$/.test(jurisdiction)) {
    throw sourceError('RESEARCH_SOURCE_ATTESTATION_INPUT_INVALID');
  }
  return {
    schemaVersion: RESEARCH_SOURCE_ATTESTATION_VERSION,
    algorithm: 'RS256',
    keyId: claims.keyId,
    fetcher: RESEARCH_SOURCE_FETCHER_ID,
    requestedUrl,
    canonicalUrl,
    contentType: claims.contentType,
    statusCode: 200,
    redirectCount: claims.redirectCount,
    retrievedAt: claims.retrievedAt,
    rawBodySha256: claims.rawBodySha256,
    documentHash: claims.documentHash,
    taskId: claims.taskId,
    researchBriefHash: claims.researchBriefHash,
    executionBindingHash: claims.executionBindingHash,
    researchPolicyVersion: claims.researchPolicyVersion,
    freshnessRequiredSourceTier: claims.freshnessRequiredSourceTier,
    freshnessMaxAgeHours: claims.freshnessMaxAgeHours,
    jurisdiction,
    publicationDate: null,
    evidenceBindings,
  };
}

/** Signs a bounded HTTP observation and the exact extracted public evidence under a pinned ResearchAgent identity. */
export function createResearchSourceAttestor({ privateKey, keyId } = {}) {
  let key;
  try {
    key = typeof privateKey === 'string'
      ? crypto.createPrivateKey(String(privateKey).replace(/\\n/g, '\n'))
      : privateKey;
  } catch {
    throw sourceError('RESEARCH_SOURCE_ATTESTATION_KEY_INVALID');
  }
  if (!key || key.asymmetricKeyType !== 'rsa' || typeof keyId !== 'string'
      || !/^[A-Za-z0-9._:-]{1,128}$/.test(keyId)) {
    throw sourceError('RESEARCH_SOURCE_ATTESTATION_KEY_INVALID');
  }
  const publicKey = crypto.createPublicKey(key);
  const publicJwk = Object.freeze({ ...publicKey.export({ format: 'jwk' }), kid: keyId, alg: 'RS256', use: 'sig' });
  return Object.freeze({
    keyId,
    publicJwk,
    attest({
      requestedUrl, document, documentHash, evidenceUnits, taskId, researchBriefHash,
      executionBindingHash, researchPolicyVersion, freshnessRequiredSourceTier,
      jurisdiction, freshnessMaxAgeHours,
    } = {}) {
      const body = document?.body;
      const normalizedBody = typeof body === 'string' ? stripUntrustedDocumentMarkup(body) : '';
      const normalizedDocumentHash = digest(Buffer.from(normalizedBody, 'utf8'));
      if (typeof body !== 'string' || !HASH_PATTERN.test(document?.rawBodySha256 || '')
          || digest(Buffer.from(body, 'utf8')) !== document.rawBodySha256
          || !HASH_PATTERN.test(documentHash || '') || normalizedDocumentHash !== documentHash
          || !Array.isArray(evidenceUnits) || evidenceUnits.length < 1 || evidenceUnits.length > 12
          || evidenceUnits.some(unit => unit?.documentHash !== normalizedDocumentHash
            || unit?.canonicalUrl !== document.url
            || unit?.retrievedAt !== document.retrievedAt
            || typeof unit?.supportingExcerpt !== 'string'
            || !normalizedBody.includes(unit.supportingExcerpt)
            || digest(Buffer.from(unit.supportingExcerpt, 'utf8')) !== unit.supportingExcerptHash)) {
        throw sourceError('RESEARCH_SOURCE_ATTESTATION_INPUT_INVALID');
      }
      const contentType = String(document.contentType || '').split(';')[0].trim().toLowerCase();
      const claims = validateSigningClaims({
        keyId,
        requestedUrl,
        canonicalUrl: document.url,
        contentType,
        statusCode: document.statusCode,
        redirectCount: document.redirectCount,
        retrievedAt: document.retrievedAt,
        rawBodySha256: document.rawBodySha256,
        documentHash: normalizedDocumentHash,
        evidenceBindings: evidenceUnits.map(unit => ({ evidenceId: unit.evidenceId, supportingExcerptHash: unit.supportingExcerptHash })),
        taskId,
        researchBriefHash,
        executionBindingHash,
        researchPolicyVersion,
        freshnessRequiredSourceTier,
        freshnessMaxAgeHours,
        jurisdiction,
        publicationDate: null,
      });
      const signature = crypto.sign('RSA-SHA256', Buffer.from(canonicalStringify(claims)), key).toString('base64url');
      return Object.freeze({ ...claims, signature });
    },
  });
}

/** Verifies the signed fetch and extracted-evidence binding against the locally pinned ResearchAgent public JWK. */
export function verifyResearchSourceAttestation(attestation, {
  publicJwk,
  expectedSource = null,
  expectedJurisdiction = null,
  expectedFreshnessMaxAgeHours = null,
  expectedExecutionBindingHash = null,
  expectedTaskId = null,
  expectedResearchBriefHash = null,
  expectedResearchPolicyVersion = null,
  now = new Date(),
  requireFreshFetch = false,
} = {}) {
  const fields = [
    'schemaVersion', 'algorithm', 'keyId', 'fetcher', 'requestedUrl', 'canonicalUrl',
    'contentType', 'statusCode', 'redirectCount', 'retrievedAt', 'rawBodySha256',
    'documentHash', 'taskId', 'researchBriefHash', 'executionBindingHash',
    'researchPolicyVersion', 'freshnessRequiredSourceTier', 'freshnessMaxAgeHours',
    'jurisdiction', 'publicationDate', 'evidenceBindings', 'signature',
  ];
  if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)
      || Object.keys(attestation).length !== fields.length
      || fields.some(field => !Object.hasOwn(attestation, field))) {
    return { valid: false, reason: 'ATTESTATION_SHAPE_INVALID' };
  }
  if (!publicJwk || publicJwk.kty !== 'RSA' || typeof publicJwk.kid !== 'string'
      || !publicJwk.n || !publicJwk.e || PRIVATE_RSA_FIELDS.some(field => Object.hasOwn(publicJwk, field))) {
    return { valid: false, reason: 'TRUSTED_KEY_UNAVAILABLE' };
  }
  if (attestation.schemaVersion !== RESEARCH_SOURCE_ATTESTATION_VERSION
      || attestation.algorithm !== 'RS256'
      || attestation.fetcher !== RESEARCH_SOURCE_FETCHER_ID
      || attestation.keyId !== publicJwk.kid) {
    return { valid: false, reason: 'ATTESTATION_IDENTITY_MISMATCH' };
  }
  let claims;
  try { claims = validateSigningClaims(attestation); } catch {
    return { valid: false, reason: 'ATTESTATION_CLAIMS_INVALID' };
  }
  if (expectedSource && (claims.canonicalUrl !== expectedSource.canonicalUrl
      || claims.retrievedAt !== expectedSource.retrievedAt
      || claims.documentHash !== expectedSource.documentHash
      || (expectedSource.evidenceBindings && canonicalStringify(claims.evidenceBindings)
        !== canonicalStringify(normalizeSourceEvidenceBindings(expectedSource.evidenceBindings)))
      || (expectedSource.evidenceBinding && !claims.evidenceBindings.some(binding =>
        binding.evidenceId === expectedSource.evidenceBinding.evidenceId
        && binding.supportingExcerptHash === expectedSource.evidenceBinding.supportingExcerptHash)))) {
    return { valid: false, reason: 'ATTESTATION_SOURCE_BINDING_MISMATCH' };
  }
  if (expectedTaskId !== null && claims.taskId !== expectedTaskId) return { valid: false, reason: 'ATTESTATION_TASK_BINDING_MISMATCH' };
  if (expectedResearchBriefHash !== null && claims.researchBriefHash !== expectedResearchBriefHash) return { valid: false, reason: 'ATTESTATION_BRIEF_BINDING_MISMATCH' };
  if (expectedExecutionBindingHash !== null && claims.executionBindingHash !== expectedExecutionBindingHash) return { valid: false, reason: 'ATTESTATION_EXECUTION_BINDING_MISMATCH' };
  if (expectedResearchPolicyVersion !== null && claims.researchPolicyVersion !== expectedResearchPolicyVersion) return { valid: false, reason: 'ATTESTATION_RESEARCH_POLICY_MISMATCH' };
  if (expectedJurisdiction && claims.jurisdiction !== String(expectedJurisdiction).trim().toUpperCase()) {
    return { valid: false, reason: 'ATTESTATION_JURISDICTION_MISMATCH' };
  }
  if (expectedFreshnessMaxAgeHours !== null
      && claims.freshnessMaxAgeHours !== expectedFreshnessMaxAgeHours) {
    return { valid: false, reason: 'ATTESTATION_FRESHNESS_POLICY_MISMATCH' };
  }
  if (typeof attestation.signature !== 'string' || attestation.signature.length > 2048
      || !/^[A-Za-z0-9_-]+$/.test(attestation.signature)) {
    return { valid: false, reason: 'ATTESTATION_SIGNATURE_INVALID' };
  }
  let validSignature = false;
  try {
    const key = crypto.createPublicKey({ key: publicJwk, format: 'jwk' });
    const signature = Buffer.from(attestation.signature, 'base64url');
    validSignature = signature.length > 0
      && signature.toString('base64url') === attestation.signature
      && crypto.verify('RSA-SHA256', Buffer.from(canonicalStringify(claims)), key, signature);
  } catch { validSignature = false; }
  if (!validSignature) return { valid: false, reason: 'ATTESTATION_SIGNATURE_INVALID' };

  const retrievedMs = Date.parse(claims.retrievedAt);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (requireFreshFetch && (!Number.isFinite(nowMs) || retrievedMs > nowMs
      || nowMs - retrievedMs > claims.freshnessMaxAgeHours * 60 * 60 * 1000)) {
    return { valid: false, reason: 'ATTESTATION_FETCH_NOT_CURRENT' };
  }
  return { valid: true, claims };
}
