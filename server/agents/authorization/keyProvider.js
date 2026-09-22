import crypto from 'node:crypto';

export const AUTHORIZATION_SIGNATURE_ALGORITHM = 'Ed25519';
let developmentProvider = null;

export class AuthorizationKeyRing {
  constructor({ activeKeyId, signingKey = null, verificationKeys = {}, environment = 'configured' } = {}) {
    this.activeKeyId = String(activeKeyId || '').slice(0, 120);
    this.signingKey = signingKey;
    this.environment = environment;
    this.verificationKeys = new Map(Object.entries(verificationKeys).map(([keyId, key]) => [String(keyId).slice(0, 120), key]));
    if (this.activeKeyId && signingKey && !this.verificationKeys.has(this.activeKeyId)) this.verificationKeys.set(this.activeKeyId, crypto.createPublicKey(signingKey));
  }

  sign(data) {
    if (!this.signingKey) throw new Error('Authorization key ring has no active signing key.');
    return crypto.sign(null, Buffer.from(data, 'utf8'), this.signingKey).toString('base64url');
  }

  getVerificationKey(keyId) { return this.verificationKeys.get(String(keyId || '')) || null; }

  verifyByKeyId(data, signature, keyId) {
    const key = this.getVerificationKey(keyId);
    return Boolean(key && signature && crypto.verify(null, Buffer.from(data, 'utf8'), key, Buffer.from(signature, 'base64url')));
  }

  verify(data, signature, keyId = this.activeKeyId) { return this.verifyByKeyId(data, signature, keyId); }

  metadata() {
    return { algorithm: AUTHORIZATION_SIGNATURE_ALGORITHM, keyId: this.activeKeyId, environment: this.environment };
  }
}

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
    this.keyRing = new AuthorizationKeyRing({ activeKeyId: this.keyId, signingKey: this.privateKey, verificationKeys: { [this.keyId]: this.publicKey }, environment: this.environment });
  }

  sign(data) { return this.keyRing.sign(data); }
  verify(data, signature, keyId) { return this.keyRing.verify(data, signature, keyId); }
  verifyByKeyId(data, signature, keyId) { return this.keyRing.verifyByKeyId(data, signature, keyId); }
  getVerificationKey(keyId) { return this.keyRing.getVerificationKey(keyId); }
  metadata() { return this.keyRing.metadata(); }
}

export class ConfiguredEd25519KeyProvider {
  constructor({ privateKeyPem, publicKeyPem, keyId = 'configured-ed25519', verificationKeys = {} } = {}) {
    if (!privateKeyPem || !publicKeyPem) throw new Error('Configured authorization signing requires both private and public keys.');
    this.privateKey = crypto.createPrivateKey(privateKeyPem);
    this.publicKey = crypto.createPublicKey(publicKeyPem);
    this.keyId = String(keyId).slice(0, 120);
    this.environment = 'configured';
    const parsedVerificationKeys = Object.fromEntries(Object.entries(verificationKeys).map(([id, pem]) => [id, crypto.createPublicKey(pem)]));
    this.keyRing = new AuthorizationKeyRing({ activeKeyId: this.keyId, signingKey: this.privateKey, verificationKeys: { ...parsedVerificationKeys, [this.keyId]: this.publicKey }, environment: this.environment });
  }

  sign(data) { return this.keyRing.sign(data); }
  verify(data, signature, keyId) { return this.keyRing.verify(data, signature, keyId); }
  verifyByKeyId(data, signature, keyId) { return this.keyRing.verifyByKeyId(data, signature, keyId); }
  getVerificationKey(keyId) { return this.keyRing.getVerificationKey(keyId); }
  metadata() { return this.keyRing.metadata(); }
}

export function createAuthorizationKeyProvider({ env = process.env, required = false } = {}) {
  const hasConfiguredKeys = Boolean(env.AUTHORIZATION_SIGNING_PRIVATE_KEY && env.AUTHORIZATION_SIGNING_PUBLIC_KEY);
  if (hasConfiguredKeys) return new ConfiguredEd25519KeyProvider({
    privateKeyPem: env.AUTHORIZATION_SIGNING_PRIVATE_KEY,
    publicKeyPem: env.AUTHORIZATION_SIGNING_PUBLIC_KEY,
    keyId: env.AUTHORIZATION_SIGNING_KEY_ID,
    verificationKeys: (() => {
      if (!env.AUTHORIZATION_VERIFY_PUBLIC_KEYS_JSON) return {};
      try { return JSON.parse(env.AUTHORIZATION_VERIFY_PUBLIC_KEYS_JSON); } catch { throw new Error('AUTHORIZATION_VERIFY_PUBLIC_KEYS_JSON must be valid JSON.'); }
    })(),
  });
  if (required || env.NODE_ENV === 'production') {
    const error = new Error('A configured authorization signing key is required.');
    error.code = 'AUTHORIZATION_SIGNING_KEY_REQUIRED';
    throw error;
  }
  if (!developmentProvider) developmentProvider = new DevelopmentEphemeralKeyProvider({ env });
  return developmentProvider;
}
