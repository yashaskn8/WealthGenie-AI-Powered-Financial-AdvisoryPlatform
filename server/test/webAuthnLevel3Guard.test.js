import test from 'node:test';
import assert from 'node:assert/strict';
import { WebAuthnApprovalProvider } from '../agents/authorization/approvalProviders.js';
import { verifyMandateApproval } from '../agents/authorization/mandateService.js';
import { APPROVE_RECOMPUTE, AUTHORIZATION_AUDIENCE, AUTHORIZATION_POLICY_VERSION } from '../agents/authorization/authorizationConstants.js';
import MandateApprovalChallenge from '../models/MandateApprovalChallenge.js';
import PasskeyCredential from '../models/PasskeyCredential.js';
import { normalizeWebAuthnCredential } from '../agents/authorization/webAuthnBytes.js';
import { verifyPasskeyRegistration } from '../agents/authorization/passkeyService.js';

test('WebAuthn options and verification bind challenge, RP, origin, credential, and user verification', async () => {
  let authenticationOptions;
  let verificationOptions;
  const provider = new WebAuthnApprovalProvider({
    origin: 'https://wealthgenie.example',
    rpId: 'wealthgenie.example',
    verifier: {
      async generateAuthenticationOptions(options) {
        authenticationOptions = options;
        return { challenge: options.challenge, rpId: options.rpID };
      },
      async verifyAuthenticationResponse(options) {
        verificationOptions = options;
        return { verified: true, authenticationInfo: {
          userVerified: true,
          newCounter: 8,
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: true,
        } };
      },
    },
  });
  const mandate = { mandateId: 'mandate-1', mandateHash: 'a'.repeat(64) };
  const options = await provider.createOptions({ mandate, credentialIds: ['credential-1'] });
  assert.equal(Buffer.from(options.challenge, 'base64url').byteLength, 32);
  assert.equal(authenticationOptions.userVerification, 'required');
  assert.equal(authenticationOptions.rpID, 'wealthgenie.example');
  assert.deepEqual(authenticationOptions.allowCredentials, [{ id: 'credential-1', type: 'public-key' }]);

  const credential = { id: 'credential-1', publicKey: Buffer.from('public-key'), counter: 7, transports: ['internal'] };
  const verified = await provider.verify({
    mandate,
    assertion: {
      mandateId: mandate.mandateId,
      mandateHash: mandate.mandateHash,
      expectedChallenge: options.challenge,
      response: { id: credential.id },
    },
    credential,
  });
  assert.equal(verificationOptions.expectedChallenge, options.challenge);
  assert.equal(verificationOptions.expectedOrigin, 'https://wealthgenie.example');
  assert.equal(verificationOptions.expectedRPID, 'wealthgenie.example');
  assert.equal(verificationOptions.requireUserVerification, true);
  assert.equal(verificationOptions.credential, credential);
  assert.equal(verified.newCounter, 8);
  assert.equal(verified.deviceType, 'multiDevice');
  assert.equal(verified.backedUp, true);

  const metadataMissingProvider = new WebAuthnApprovalProvider({
    origin: 'https://wealthgenie.example',
    rpId: 'wealthgenie.example',
    verifier: { async verifyAuthenticationResponse() {
      return { verified: true, authenticationInfo: { userVerified: true, newCounter: 9 } };
    } },
  });
  await assert.rejects(() => metadataMissingProvider.verify({
    mandate,
    assertion: { mandateId: mandate.mandateId, mandateHash: mandate.mandateHash, expectedChallenge: options.challenge },
    credential,
  }), error => error.code === 'TRUSTED_APPROVAL_INVALID');

  await assert.rejects(() => provider.verify({
    mandate,
    assertion: { mandateId: mandate.mandateId, mandateHash: 'b'.repeat(64), expectedChallenge: options.challenge },
    credential,
  }), error => error.code === 'TRUSTED_APPROVAL_INVALID');
});

test('approval provider must match the provider sealed into the mandate', async () => {
  let reads = 0;
  const query = value => ({ lean: async () => value });
  await assert.rejects(() => verifyMandateApproval({
    mandateId: 'mandate-provider-mismatch',
    userId: 'user-1',
    assertion: { method: 'DEVELOPMENT' },
    dependencies: {
      mandateModel: {
        findOne: filter => {
          reads += 1;
          return query({
            mandateId: filter.mandateId,
            userId: filter.userId,
            status: 'PENDING_USER_VERIFICATION',
            approvalMethod: 'WEBAUTHN',
            expiresAt: new Date(Date.now() + 60_000),
          });
        },
      },
      approvalProvider: { name: 'DEVELOPMENT' },
    },
    runtimeConfig: { env: { NODE_ENV: 'test' } },
  }), error => error.code === 'TRUSTED_APPROVAL_INVALID');
  assert.equal(reads, 1);
});

test('approval challenge can rotate without making its identity binding mutable', () => {
  assert.equal(MandateApprovalChallenge.schema.path('challenge').options.immutable, undefined);
  assert.equal(MandateApprovalChallenge.schema.path('mandateId').options.immutable, true);
  assert.equal(MandateApprovalChallenge.schema.path('userId').options.immutable, true);
  assert.equal(MandateApprovalChallenge.schema.path('mandateHash').options.immutable, true);
});

test('verified passkey metadata is normalized and constrained to WebAuthn backup states', () => {
  const normalized = normalizeWebAuthnCredential({
    credentialId: 'Y3JlZGVudGlhbC0x',
    publicKey: Buffer.from('public-key'),
    counter: 0,
    deviceType: 'multiDevice',
    backedUp: true,
  });
  assert.equal(normalized.deviceType, 'multiDevice');
  assert.equal(normalized.backedUp, true);
  assert.deepEqual(PasskeyCredential.schema.path('deviceType').options.enum, ['singleDevice', 'multiDevice']);
  assert.equal(PasskeyCredential.schema.path('backedUp').options.default, null);
  assert.throws(() => normalizeWebAuthnCredential({
    credentialId: 'Y3JlZGVudGlhbC0x',
    publicKey: Buffer.from('public-key'),
    counter: 0,
    deviceType: 'unknown',
    backedUp: false,
  }), error => error.code === 'TRUSTED_APPROVAL_INVALID');
});

test('passkey registration persists verifier-reported device and backup state', async () => {
  const challenge = {
    _id: 'registration-challenge-1',
    userId: 'user-1',
    challenge: 'expected-registration-challenge',
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  };
  let createdCredential;
  let consumed = false;
  const dependencies = {
    challengeModel: {
      findOne() {
        return { sort: () => ({ lean: async () => challenge }) };
      },
      async findOneAndUpdate(filter) {
        assert.equal(filter._id, challenge._id);
        assert.equal(filter.consumedAt, null);
        consumed = true;
        return { ...challenge, consumedAt: new Date() };
      },
    },
    credentialModel: {
      async create(value) {
        createdCredential = value;
        return { ...value, createdAt: new Date() };
      },
    },
    approvalProvider: {
      name: 'WEBAUTHN',
      async verifyRegistration({ expectedChallenge }) {
        assert.equal(expectedChallenge, challenge.challenge);
        return {
          credential: { id: 'Y3JlZGVudGlhbC0x', publicKey: Buffer.from('public-key'), counter: 0 },
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: true,
        };
      },
    },
  };

  const result = await verifyPasskeyRegistration({ userId: 'user-1', response: {}, dependencies });
  assert.equal(result.credentialId, 'Y3JlZGVudGlhbC0x');
  assert.equal(createdCredential.deviceType, 'multiDevice');
  assert.equal(createdCredential.backedUp, true);
  assert.equal(consumed, true);
});

test('passkey registration fails closed when verifier backup state is incomplete', async () => {
  let consumed = false;
  let created = false;
  const challenge = {
    _id: 'registration-challenge-2',
    challenge: 'expected-registration-challenge',
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  };
  await assert.rejects(() => verifyPasskeyRegistration({
    userId: 'user-1',
    response: {},
    dependencies: {
      challengeModel: {
        findOne: () => ({ sort: () => ({ lean: async () => challenge }) }),
        async findOneAndUpdate() { consumed = true; return challenge; },
      },
      credentialModel: { async create() { created = true; } },
      approvalProvider: {
        name: 'WEBAUTHN',
        async verifyRegistration() {
          return { credential: { id: 'Y3JlZGVudGlhbC0x', publicKey: Buffer.from('public-key'), counter: 0 } };
        },
      },
    },
  }), error => error.code === 'TRUSTED_APPROVAL_INVALID');
  assert.equal(consumed, false);
  assert.equal(created, false);
});

test('mandate expiry during WebAuthn verification cannot win the final authorization CAS', async () => {
  const mandate = {
    mandateId: '123e4567-e89b-12d3-a456-426614174000',
    version: 'user-intent-mandate-1.0.0',
    issuer: 'wealthgenie.plan-review',
    subject: 'user:user-1',
    audience: AUTHORIZATION_AUDIENCE,
    mandateHash: 'a'.repeat(64),
    userId: 'user-1',
    status: 'PENDING_USER_VERIFICATION',
    expiresAt: new Date(Date.now() + 60_000),
    approvalMethod: 'WEBAUTHN',
    action: APPROVE_RECOMPUTE,
    resourceType: 'FinancialProfile',
    resourceId: 'a'.repeat(24),
    profileId: 'a'.repeat(24),
    recommendationId: null,
    planReviewSnapshotHash: 'f'.repeat(64),
    financialSnapshotHash: 'b'.repeat(64),
    recommendationFingerprint: 'c'.repeat(64),
    actionPayloadHash: 'd'.repeat(64),
    constraints: {
      maxAgeSeconds: 300,
      allowedAgentType: 'PLAN_REVIEW',
      resourceVersion: 1,
      noFinancialMutationByAgent: true,
    },
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    notBefore: new Date(Date.now() - 1_000).toISOString(),
    nonce: 'e'.repeat(32),
    singleUse: true,
    parentGrantId: 'plan-review-grant',
    delegationDepth: 0,
    correlationId: null,
    agentVersion: 'test-agent-1',
    agentType: 'PLAN_REVIEW',
    agentIdentity: { authenticated: true },
    policyVersion: AUTHORIZATION_POLICY_VERSION,
    signatureMetadata: null,
    approval: null,
  };
  const challenge = { mandateId: mandate.mandateId, userId: mandate.userId, mandateHash: mandate.mandateHash, challenge: 'expected-challenge', expiresAt: new Date(Date.now() + 60_000), consumedAt: null };
  const credential = { userId: mandate.userId, credentialId: 'Y3JlZGVudGlhbC0x', publicKey: Buffer.from('public-key'), counter: 0, transports: [] };
  let finalWriteFilter;
  let finalWriteUpdate;
  let credentialWrite;
  let mandateStatus = 'PENDING_USER_VERIFICATION';
  const query = value => ({ lean: async () => value });
  const dependencies = {
    mandateModel: {
      findOne: filter => query(filter.$expr?.$lte ? mandateStatus === 'PENDING_USER_VERIFICATION' && mandate.expiresAt <= new Date() ? mandate : null : mandate),
      findOneAndUpdate(filter, update) {
        finalWriteFilter = filter;
        finalWriteUpdate = update;
        return query(null);
      },
      async updateOne() { mandateStatus = 'EXPIRED'; return { modifiedCount: 1 }; },
    },
    challengeModel: {
      findOne: () => query(challenge),
      async findOneAndUpdate(filter) {
        assert.equal(filter.consumedAt, null);
        assert.deepEqual(filter.$expr, { $gt: ['$expiresAt', '$$NOW'] });
        challenge.consumedAt = new Date();
        return challenge;
      },
    },
    credentialModel: {
      findOne: () => query(credential),
      async findOneAndUpdate(filter, update) {
        assert.equal(filter.counter, credential.counter);
        credentialWrite = update;
        credential.counter = 0;
        return credential;
      },
    },
    approvalProvider: {
      name: 'WEBAUTHN',
      async verify() {
        mandate.expiresAt = new Date(Date.now() - 1);
        return {
          verified: true,
          method: 'WEBAUTHN',
          credentialId: credential.credentialId,
          newCounter: 0,
          deviceType: 'singleDevice',
          backedUp: false,
          verifiedAt: new Date().toISOString(),
        };
      },
    },
    keyProvider: { sign: () => 'test-signature', metadata: () => ({ algorithm: 'Ed25519', keyId: 'test-key', environment: 'test' }) },
  };

  await assert.rejects(() => verifyMandateApproval({
    mandateId: mandate.mandateId,
    userId: mandate.userId,
    assertion: { mandateHash: mandate.mandateHash, credentialId: credential.credentialId, response: {} },
    dependencies,
    runtimeConfig: { env: { NODE_ENV: 'test' } },
  }), error => error.code === 'MANDATE_EXPIRED');

  assert.deepEqual(finalWriteFilter.$expr, { $gt: ['$expiresAt', '$$NOW'] });
  assert.equal(finalWriteUpdate.$set.approval.credentialDeviceType, 'singleDevice');
  assert.equal(finalWriteUpdate.$set.approval.credentialBackedUp, false);
  assert.equal(credentialWrite.$set.deviceType, 'singleDevice');
  assert.equal(credentialWrite.$set.backedUp, false);
  assert.equal(mandateStatus, 'EXPIRED');
});
