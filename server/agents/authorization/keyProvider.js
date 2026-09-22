import crypto from 'node:crypto';

export const AUTHORIZATION_SIGNATURE_ALGORITHM = 'Ed25519';
let developmentProvider = null;

export class DevelopmentEphemeralKeyProvider {
  constructor({ env = process.env } = {}) {
    if (env.NODE_ENV === 'production') {
      const error = new Error('Development authorization signing keys are not permitted in production.');
      error.code = 'DEVELOPMENT_SIGNING_KEY_IN_PRODUCTION';
      throw error;
    }
    const pair = crypto.generateKeyPairSync('ed25519');
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
    this.keyId = `dev-${crypto.randomUUID()}`;
    this.environment = 'development';
  }

  sign(data) {
    return crypto.sign(null, Buffer.from(data, 'utf8'), this.privateKey).toString('base64url');
  }

  verify(data, signature) {
    return crypto.verify(null, Buffer.from(data, 'utf8'), this.publicKey, Buffer.from(signature, 'base64url'));
  }

  metadata() {
    return { algorithm: AUTHORIZATION_SIGNATURE_ALGORITHM, keyId: this.keyId, environment: this.environment };
  }
}

export class ConfiguredEd25519KeyProvider {
  constructor({ privateKeyPem, publicKeyPem, keyId = 'configured-ed25519' } = {}) {
    if (!privateKeyPem || !publicKeyPem) throw new Error('Configured authorization signing requires both private and public keys.');
    this.privateKey = crypto.createPrivateKey(privateKeyPem);
    this.publicKey = crypto.createPublicKey(publicKeyPem);
    this.keyId = String(keyId).slice(0, 120);
    this.environment = 'configured';
  }

  sign(data) {
    return crypto.sign(null, Buffer.from(data, 'utf8'), this.privateKey).toString('base64url');
  }

  verify(data, signature) {
    return crypto.verify(null, Buffer.from(data, 'utf8'), this.publicKey, Buffer.from(signature, 'base64url'));
  }

  metadata() {
    return { algorithm: AUTHORIZATION_SIGNATURE_ALGORITHM, keyId: this.keyId, environment: this.environment };
  }
}

export function createAuthorizationKeyProvider({ env = process.env, required = false } = {}) {
  const hasConfiguredKeys = Boolean(env.AUTHORIZATION_SIGNING_PRIVATE_KEY && env.AUTHORIZATION_SIGNING_PUBLIC_KEY);
  if (hasConfiguredKeys) return new ConfiguredEd25519KeyProvider({
    privateKeyPem: env.AUTHORIZATION_SIGNING_PRIVATE_KEY,
    publicKeyPem: env.AUTHORIZATION_SIGNING_PUBLIC_KEY,
    keyId: env.AUTHORIZATION_SIGNING_KEY_ID,
  });
  if (required || env.NODE_ENV === 'production') {
    const error = new Error('A configured authorization signing key is required.');
    error.code = 'AUTHORIZATION_SIGNING_KEY_REQUIRED';
    throw error;
  }
  if (!developmentProvider) developmentProvider = new DevelopmentEphemeralKeyProvider({ env });
  return developmentProvider;
}
