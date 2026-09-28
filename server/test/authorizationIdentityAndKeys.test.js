import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import test from 'node:test';
import { OIDCAgentIdentityVerifier, isVerifiedAgentIdentity } from '../agents/identity/agentIdentityVerifier.js';
import { ConfiguredEd25519KeyProvider } from '../agents/authorization/keyProvider.js';
import { normalizeCredentialId, normalizePublicKey } from '../agents/authorization/webAuthnBytes.js';

test('OIDC agent identity requires a valid signed token and explicit subject mapping', async () => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const issuer = 'https://issuer.example.test';
  const audience = 'wealthgenie-agents';
  const token = jwt.sign(
    { sub: 'svc-plan-review', iss: issuer, aud: audience },
    pair.privateKey,
    { algorithm: 'RS256', expiresIn: 60 },
  );
  const verifier = new OIDCAgentIdentityVerifier({
    issuer,
    audience,
    publicKey: pair.publicKey,
    subjectMap: { 'svc-plan-review': 'PLAN_REVIEW' },
  });
  const identity = await verifier.verify({ token, agentType: 'PLAN_REVIEW' });
  assert.equal(isVerifiedAgentIdentity(identity), true);
  await assert.rejects(() => verifier.verify({ token: `${token}tampered`, agentType: 'PLAN_REVIEW' }), /verification failed/i);
});

test('OIDC JWKS rejects redirects and enforces a streamed response-size limit', async () => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const issuer = 'https://issuer.example.test';
  const audience = 'wealthgenie-agents';
  const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'key-1', alg: 'RS256', use: 'sig' };
  const token = jwt.sign({ sub: 'svc-plan-review', iss: issuer, aud: audience }, pair.privateKey, {
    algorithm: 'RS256', keyid: 'key-1', expiresIn: 60,
  });
  const verifierFor = fetchImpl => new OIDCAgentIdentityVerifier({
    issuer,
    audience,
    jwksUri: 'https://issuer.example.test/.well-known/jwks.json',
    subjectMap: { 'svc-plan-review': 'PLAN_REVIEW' },
    fetchImpl,
  });

  let requestOptions;
  const validVerifier = verifierFor(async (_url, options) => {
    requestOptions = options;
    return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } });
  });
  const identity = await validVerifier.verify({ token, agentType: 'PLAN_REVIEW' });
  assert.equal(isVerifiedAgentIdentity(identity), true);
  assert.equal(requestOptions.redirect, 'error');
  assert.ok(requestOptions.signal);

  const redirectVerifier = verifierFor(async () => new Response(null, { status: 302, headers: { location: 'https://attacker.example/jwks' } }));
  await assert.rejects(() => redirectVerifier.verify({ token }), error => error.code === 'AGENT_IDENTITY_TOKEN_INVALID');

  const oversizedBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(40_000));
      controller.enqueue(new Uint8Array(30_001));
      controller.close();
    },
  });
  const oversizedVerifier = verifierFor(async () => new Response(oversizedBody));
  await assert.rejects(() => oversizedVerifier.verify({ token }), error => error.code === 'AGENT_IDENTITY_TOKEN_INVALID');
});

test('authorization key rings verify receipts signed by a historical key ID', () => {
  const first = crypto.generateKeyPairSync('ed25519');
  const active = crypto.generateKeyPairSync('ed25519');
  const pem = keyPair => ({
    privateKeyPem: keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKeyPem: keyPair.publicKey.export({ type: 'spki', format: 'pem' }),
  });
  const firstProvider = new ConfiguredEd25519KeyProvider({ ...pem(first), keyId: 'key-2026-01' });
  const activeProvider = new ConfiguredEd25519KeyProvider({
    ...pem(active),
    keyId: 'key-2026-02',
    verificationKeys: { 'key-2026-01': pem(first).publicKeyPem },
  });
  const payload = 'historical mandate payload';
  const signature = firstProvider.sign(payload);
  assert.equal(activeProvider.verifyByKeyId(payload, signature, 'key-2026-01'), true);
  assert.equal(activeProvider.verifyByKeyId(payload, signature, 'missing-key'), false);
});

test('WebAuthn credential and public-key bytes normalize consistently across binary and base64url forms', () => {
  const bytes = Buffer.from([0, 1, 2, 253, 254, 255]);
  const encoded = bytes.toString('base64url');
  assert.equal(normalizeCredentialId(bytes), encoded);
  assert.equal(normalizeCredentialId(encoded), encoded);
  assert.deepEqual(normalizePublicKey(bytes), bytes);
  assert.deepEqual(normalizePublicKey(encoded), bytes);
  assert.throws(() => normalizeCredentialId('not base64!'), /WebAuthn bytes/i);
  assert.throws(() => normalizePublicKey(''), /WebAuthn bytes/i);
});
