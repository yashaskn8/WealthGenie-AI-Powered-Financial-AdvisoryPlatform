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

test('OIDC JWKS caches keys and rate-limits refreshes for unknown key IDs', async () => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const issuer = 'https://issuer.example.test';
  const audience = 'wealthgenie-agents';
  const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'key-1', alg: 'RS256', use: 'sig' };
  const tokenFor = kid => jwt.sign({ sub: 'svc-plan-review', iss: issuer, aud: audience }, pair.privateKey, {
    algorithm: 'RS256', keyid: kid, expiresIn: 60,
  });
  let now = 1_000;
  let fetchCount = 0;
  const verifier = new OIDCAgentIdentityVerifier({
    issuer,
    audience,
    jwksUri: 'https://issuer.example.test/.well-known/jwks.json',
    subjectMap: { 'svc-plan-review': 'PLAN_REVIEW' },
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } });
    },
    jwksCacheTtlMs: 5_000,
    jwksRefreshCooldownMs: 3_000,
    now: () => now,
  });

  await verifier.verify({ token: tokenFor('key-1') });
  await verifier.verify({ token: tokenFor('key-1') });
  assert.equal(fetchCount, 1, 'a valid cached key should avoid another provider request');

  await assert.rejects(() => verifier.verify({ token: tokenFor('unknown-1') }), error => error.code === 'AGENT_IDENTITY_TOKEN_INVALID');
  await assert.rejects(() => verifier.verify({ token: tokenFor('unknown-2') }), error => error.code === 'AGENT_IDENTITY_TOKEN_INVALID');
  assert.equal(fetchCount, 1, 'distinct unknown key IDs must not force repeated JWKS requests');

  now += 3_001;
  await assert.rejects(() => verifier.verify({ token: tokenFor('unknown-3') }), error => error.code === 'AGENT_IDENTITY_TOKEN_INVALID');
  assert.equal(fetchCount, 2, 'a refresh is permitted after the global cooldown');

  now += 5_001;
  await verifier.verify({ token: tokenFor('key-1') });
  assert.equal(fetchCount, 3, 'an expired key set must be refreshed before use');
});

test('concurrent OIDC JWKS misses share one in-flight refresh', async () => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'key-1', alg: 'RS256', use: 'sig' };
  let enteredFetch;
  const fetchEntered = new Promise(resolve => { enteredFetch = resolve; });
  let releaseFetch;
  const fetchGate = new Promise(resolve => { releaseFetch = resolve; });
  let fetchCount = 0;
  const verifier = new OIDCAgentIdentityVerifier({
    issuer: 'https://issuer.example.test',
    audience: 'wealthgenie-agents',
    jwksUri: 'https://issuer.example.test/.well-known/jwks.json',
    fetchImpl: async () => {
      fetchCount += 1;
      enteredFetch();
      await fetchGate;
      return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } });
    },
  });

  const first = verifier.resolveJwksKey({ alg: 'RS256', kid: 'key-1' });
  await fetchEntered;
  const second = verifier.resolveJwksKey({ alg: 'RS256', kid: 'key-2' });
  assert.equal(fetchCount, 1, 'a concurrent cache miss must join the existing refresh');
  releaseFetch();

  const [firstResult, secondResult] = await Promise.allSettled([first, second]);
  assert.equal(firstResult.status, 'fulfilled');
  assert.equal(secondResult.status, 'rejected');
  assert.equal(fetchCount, 1);
});

test('OIDC rejects unsupported algorithms and malformed key IDs before JWKS access', async () => {
  let fetchCount = 0;
  const verifier = new OIDCAgentIdentityVerifier({
    issuer: 'https://issuer.example.test',
    audience: 'wealthgenie-agents',
    jwksUri: 'https://issuer.example.test/.well-known/jwks.json',
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ keys: [] }), { headers: { 'content-type': 'application/json' } });
    },
  });

  await assert.rejects(() => verifier.resolveJwksKey({ alg: 'HS256', kid: 'unknown' }), error => error.code === 'AGENT_IDENTITY_KEY_UNAVAILABLE');
  await assert.rejects(() => verifier.resolveJwksKey({ alg: 'RS256', kid: 'k'.repeat(257) }), error => error.code === 'AGENT_IDENTITY_KEY_UNAVAILABLE');
  assert.equal(fetchCount, 0);
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
