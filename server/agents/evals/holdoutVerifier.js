import crypto from 'node:crypto';
import { canonicalJson, canonicalSha256 } from '../../utils/canonicalJson.js';
import { AGENT_EVALUATION_VERSION, evaluateHoldoutCandidateAsync } from './evaluationV2.js';

export const HOLDOUT_BUNDLE_SCHEMA_VERSION = 'wealthgenie-holdout-bundle/v1';
export const HOLDOUT_ATTESTATION_SCHEMA_VERSION = 'wealthgenie-holdout-attestation/v1';

const GRADING_FIELD = /^(?:partition|.*expected.*|answerkey|groundtruth|grader.*|.*grader.*|grading.*|.*grading.*|targetlabel|evaluation(?:label|result|outcome|evidence|score).*|scorecard.*|correct(?:answer|action|output|result|outcome)|reference(?:answer|action|output|result|outcome)|oracle.*|gold(?:label|answer|result)?.*|rubric.*|scoring.*)$/i;
const CANDIDATE_CONTEXT_FIELDS = new Set([
  'profile', 'profileContext', 'recommendation', 'currentState', 'sourceBinding',
  'planReviewSnapshotHash', 'recommendationSummary', 'freshness',
]);
const SIGNED_FIELDS = Object.freeze([
  'schemaVersion',
  'evaluationVersion',
  'datasetVersion',
  'caseCount',
  'datasetHash',
  'attestedAt',
  'keyId',
  'algorithm',
]);

function holdoutError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeAttestedJson(value, ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw holdoutError('HOLDOUT_DATA_INVALID', 'Holdout data contains a non-finite number.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw holdoutError('HOLDOUT_DATA_INVALID', 'Holdout data contains an invalid date.');
    return value.toISOString();
  }
  if (!value || typeof value !== 'object' || ancestors.has(value)) {
    throw holdoutError('HOLDOUT_DATA_INVALID', 'Holdout data must be an acyclic JSON value.');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw holdoutError('HOLDOUT_DATA_INVALID', 'Holdout data cannot contain sparse arrays.');
      }
      if (Object.keys(value).some(key => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {
        throw holdoutError('HOLDOUT_DATA_INVALID', 'Holdout arrays cannot contain named properties.');
      }
      return value.map(item => normalizeAttestedJson(item, ancestors));
    }

    const prototype = Object.getPrototypeOf(value);
    if (![Object.prototype, null].includes(prototype) || Object.getOwnPropertySymbols(value).length) {
      throw holdoutError('HOLDOUT_DATA_INVALID', 'Holdout data must contain plain JSON records.');
    }
    const normalized = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        throw holdoutError('HOLDOUT_DATA_INVALID', 'Holdout data cannot contain accessor properties.');
      }
      Object.defineProperty(normalized, key, {
        value: normalizeAttestedJson(descriptor.value, ancestors),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

export function hashHoldoutCases(cases) {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw holdoutError('HOLDOUT_DATA_INVALID', 'A non-empty holdout case list is required.');
  }
  return canonicalSha256(normalizeAttestedJson(cases));
}

function validateAttestationInputs({ cases, datasetVersion, attestedAt, keyId }) {
  if (!Array.isArray(cases) || cases.length === 0 || cases.some(item => item?.partition !== 'holdout')) {
    throw holdoutError('HOLDOUT_DATA_INVALID', 'Attestation can only bind a non-empty holdout partition.');
  }
  if (typeof datasetVersion !== 'string' || !datasetVersion.trim() || datasetVersion.length > 128) {
    throw holdoutError('HOLDOUT_ATTESTATION_INVALID', 'A bounded dataset version is required.');
  }
  if (typeof attestedAt !== 'string' || !Number.isFinite(Date.parse(attestedAt))
      || new Date(attestedAt).toISOString() !== attestedAt) {
    throw holdoutError('HOLDOUT_ATTESTATION_INVALID', 'Attestation time must be a canonical ISO timestamp.');
  }
  if (typeof keyId !== 'string' || !/^[a-f0-9]{64}$/.test(keyId)) {
    throw holdoutError('HOLDOUT_ATTESTATION_INVALID', 'Attestation key identity is invalid.');
  }
  return {
    schemaVersion: HOLDOUT_ATTESTATION_SCHEMA_VERSION,
    evaluationVersion: AGENT_EVALUATION_VERSION,
    datasetVersion,
    caseCount: cases.length,
    datasetHash: hashHoldoutCases(cases),
    attestedAt,
    keyId,
    algorithm: 'Ed25519',
  };
}

/** Return the stable identity expected in a holdout attestation envelope. */
export function holdoutPublicKeyId(publicKey) {
  try {
    const key = publicKey instanceof crypto.KeyObject ? publicKey : crypto.createPublicKey(publicKey);
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
      throw new Error('Expected a public Ed25519 key.');
    }
    return crypto.createHash('sha256').update(key.export({ format: 'der', type: 'spki' })).digest('hex');
  } catch (error) {
    throw holdoutError('HOLDOUT_TRUST_KEY_INVALID', `Trusted holdout key is invalid: ${error.message}`);
  }
}

/** Build the claims and canonical bytes an offline trusted signer must sign. */
export function buildHoldoutAttestationSigningPayload(input) {
  const claims = validateAttestationInputs(input);
  return Object.freeze({ claims: Object.freeze(claims), signingBytes: Buffer.from(canonicalJson(claims), 'utf8') });
}

function loadTrustedPublicKey() {
  const source = process.env.AGENT_HOLDOUT_TRUSTED_PUBLIC_KEY;
  if (source == null || source === '') return null;
  try {
    if (source instanceof crypto.KeyObject && source.type !== 'public') throw new Error('A private key is not accepted by the verifier.');
    if (typeof source === 'string' && /-----BEGIN [^-]*PRIVATE KEY-----/.test(source)) {
      throw new Error('A private key is not accepted by the verifier.');
    }
    const keyInput = typeof source === 'string' ? source.replace(/\\n/g, '\n') : source;
    const key = source instanceof crypto.KeyObject ? source : crypto.createPublicKey(keyInput);
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') throw new Error('Expected a public Ed25519 key.');
    return key;
  } catch (error) {
    throw holdoutError('HOLDOUT_TRUST_KEY_INVALID', `Trusted holdout key is invalid: ${error.message}`);
  }
}

function assertExactKeys(value, expected, description) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null
      || Object.keys(value).sort().join('\0') !== [...expected].sort().join('\0')) {
    throw holdoutError('HOLDOUT_ATTESTATION_INVALID', `${description} has an invalid shape.`);
  }
}

function verifyBundle(bundle, trustedKey, { expectedDatasetHash, expectedDatasetVersion } = {}) {
  bundle = normalizeAttestedJson(bundle);
  assertExactKeys(bundle, ['schemaVersion', 'cases', 'attestation'], 'Holdout bundle');
  if (bundle.schemaVersion !== HOLDOUT_BUNDLE_SCHEMA_VERSION) {
    throw holdoutError('HOLDOUT_ATTESTATION_INVALID', 'Holdout bundle schema is unsupported.');
  }
  const cases = bundle.cases;
  if (!Array.isArray(cases) || cases.length === 0 || cases.some(item => (
    item?.partition !== 'holdout'
      || typeof item.expectedAction !== 'string'
      || item.expectedAction.trim().length === 0
  ))) {
    throw holdoutError('HOLDOUT_DATA_INVALID', 'Holdout data is invalid or unavailable.');
  }

  const attestation = bundle.attestation;
  assertExactKeys(attestation, [...SIGNED_FIELDS, 'signature'], 'Holdout attestation');
  if (attestation.schemaVersion !== HOLDOUT_ATTESTATION_SCHEMA_VERSION
      || attestation.evaluationVersion !== AGENT_EVALUATION_VERSION
      || attestation.algorithm !== 'Ed25519'
      || typeof attestation.datasetVersion !== 'string'
      || !attestation.datasetVersion.trim() || attestation.datasetVersion.length > 128
      || !Number.isSafeInteger(attestation.caseCount) || attestation.caseCount !== cases.length
      || typeof attestation.datasetHash !== 'string' || !/^[a-f0-9]{64}$/.test(attestation.datasetHash)
      || typeof attestation.attestedAt !== 'string' || !Number.isFinite(Date.parse(attestation.attestedAt))
      || new Date(attestation.attestedAt).toISOString() !== attestation.attestedAt
      || typeof attestation.keyId !== 'string' || !/^[a-f0-9]{64}$/.test(attestation.keyId)
      || typeof attestation.signature !== 'string') {
    throw holdoutError('HOLDOUT_ATTESTATION_INVALID', 'Holdout attestation claims are invalid.');
  }

  const normalizedCases = normalizeAttestedJson(cases);
  const datasetHash = canonicalSha256(normalizedCases);
  if (datasetHash !== attestation.datasetHash
      || (expectedDatasetHash != null && datasetHash !== expectedDatasetHash)
      || (expectedDatasetVersion != null && attestation.datasetVersion !== expectedDatasetVersion)) {
    throw holdoutError('HOLDOUT_ATTESTATION_INVALID', 'Holdout data does not match its trusted dataset binding.');
  }

  const keyId = crypto.createHash('sha256')
    .update(trustedKey.export({ format: 'der', type: 'spki' }))
    .digest('hex');
  if (keyId !== attestation.keyId) throw holdoutError('HOLDOUT_ATTESTATION_INVALID', 'Holdout attestation was signed by an untrusted key.');

  const signature = Buffer.from(attestation.signature, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== attestation.signature) {
    throw holdoutError('HOLDOUT_ATTESTATION_INVALID', 'Holdout attestation signature encoding is invalid.');
  }
  const claims = Object.fromEntries(SIGNED_FIELDS.map(field => [field, attestation[field]]));
  const valid = crypto.verify(null, Buffer.from(canonicalJson(claims), 'utf8'), trustedKey, signature);
  if (!valid) throw holdoutError('HOLDOUT_ATTESTATION_INVALID', 'Holdout attestation signature verification failed.');

  return Object.freeze({ cases, datasetHash, datasetVersion: attestation.datasetVersion, keyId, attestedAt: attestation.attestedAt });
}

function sanitizeCandidateJson(value, ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw holdoutError('HOLDOUT_FIXTURE_INVALID', 'Holdout execution context contains an invalid date.');
    return value.toISOString();
  }
  if (!value || typeof value !== 'object' || ancestors.has(value)) {
    throw holdoutError('HOLDOUT_FIXTURE_INVALID', 'Holdout execution context must be an acyclic JSON value.');
  }
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw holdoutError('HOLDOUT_FIXTURE_INVALID', 'Holdout execution context must contain plain JSON records.');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map(item => sanitizeCandidateJson(item, ancestors));
    const sanitized = {};
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = key.replace(/[^a-z0-9]/gi, '');
      if (GRADING_FIELD.test(normalizedKey)) throw holdoutError('HOLDOUT_FIXTURE_INVALID', 'Holdout execution context contains grading-only fields.');
      Object.defineProperty(sanitized, key, {
        value: sanitizeCandidateJson(nested, ancestors),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return sanitized;
  } finally {
    ancestors.delete(value);
  }
}

function candidateVisibleCase(item) {
  const fixture = item?.fixture;
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)
      || !fixture.context || typeof fixture.context !== 'object' || Array.isArray(fixture.context)) {
    throw holdoutError('HOLDOUT_FIXTURE_INVALID', 'Holdout cases must provide a sanitized candidate fixture.');
  }
  if (Object.keys(fixture).some(key => !['userId', 'profileId', 'context'].includes(key))
      || Object.keys(fixture.context).some(key => !CANDIDATE_CONTEXT_FIELDS.has(key))) {
    throw holdoutError('HOLDOUT_FIXTURE_INVALID', 'Holdout fixture contains fields outside the candidate-visible PlanReview context.');
  }
  return {
    fixture: {
      ...(fixture.userId == null ? {} : { userId: String(fixture.userId) }),
      ...(fixture.profileId == null ? {} : { profileId: String(fixture.profileId) }),
      context: sanitizeCandidateJson(fixture.context),
    },
  };
}

function unverifiedResult(candidateId, code) {
  return Object.freeze({
    candidateId: String(candidateId || 'unknown'),
    evaluationVersion: AGENT_EVALUATION_VERSION,
    scoreCards: Object.freeze([]),
    passed: false,
    holdoutAttestation: 'UNVERIFIED',
    holdoutFailureCode: code,
  });
}

/** Evaluate only cases whose complete data manifest is signed by a configured trusted Ed25519 key. */
export async function evaluateCandidateOnHoldout({
  candidateId,
  runner,
  loadHoldoutCases,
  expectedDatasetHash = null,
  expectedDatasetVersion = null,
} = {}) {
  if (typeof runner !== 'function' || typeof loadHoldoutCases !== 'function') {
    throw holdoutError('HOLDOUT_VERIFIER_UNAVAILABLE', 'A holdout loader and real candidate runner are required.');
  }
  const trustedKey = loadTrustedPublicKey();
  if (!trustedKey) return unverifiedResult(candidateId, 'HOLDOUT_TRUST_KEY_MISSING');

  const bundle = await loadHoldoutCases();
  const verified = verifyBundle(bundle, trustedKey, { expectedDatasetHash, expectedDatasetVersion });
  const visibleCases = verified.cases.map(candidateVisibleCase);
  const visibleBySource = new WeakMap(verified.cases.map((item, index) => [item, visibleCases[index]]));
  const evaluation = await evaluateHoldoutCandidateAsync({
    candidateId,
    cases: verified.cases,
    evaluator: item => runner({ caseDefinition: visibleBySource.get(item) }),
  });
  return Object.freeze({
    ...evaluation,
    holdoutAttestation: 'VERIFIED',
    datasetHash: verified.datasetHash,
    datasetVersion: verified.datasetVersion,
    attestationKeyId: verified.keyId,
    attestedAt: verified.attestedAt,
  });
}
