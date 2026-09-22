import { mandateError } from './authorizationConstants.js';

function decodeBase64Url(value, label) {
  if (typeof value !== 'string' || !value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw mandateError('TRUSTED_APPROVAL_INVALID', `${label} is not valid WebAuthn bytes.`);
  }
  return Buffer.from(value, 'base64url');
}

export function normalizeCredentialId(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('base64url');
  return decodeBase64Url(value, 'Credential ID').toString('base64url');
}

export function normalizePublicKey(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const bytes = Buffer.from(value);
    if (!bytes.length) throw mandateError('TRUSTED_APPROVAL_INVALID', 'Public key is empty.');
    return bytes;
  }
  const bytes = decodeBase64Url(value, 'Public key');
  if (!bytes.length) throw mandateError('TRUSTED_APPROVAL_INVALID', 'Public key is empty.');
  return bytes;
}

export function normalizeWebAuthnCredential({ credentialId, publicKey, counter = 0, transports = [] } = {}) {
  const normalizedCounter = Number(counter);
  if (!Number.isInteger(normalizedCounter) || normalizedCounter < 0) {
    throw mandateError('TRUSTED_APPROVAL_INVALID', 'Authenticator counter is invalid.');
  }
  return {
    credentialId: normalizeCredentialId(credentialId),
    publicKey: normalizePublicKey(publicKey),
    counter: normalizedCounter,
    transports: Array.isArray(transports) ? transports.map(String).slice(0, 8) : [],
  };
}
