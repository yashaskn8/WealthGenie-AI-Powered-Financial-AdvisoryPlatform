import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import PasskeyCredential from '../models/PasskeyCredential.js';
import PasskeyRegistrationChallenge from '../models/PasskeyRegistrationChallenge.js';
import { verifyPasskeyRegistration } from '../agents/authorization/passkeyService.js';
import { migratePersistenceIndexes, verifyAuthorizationPersistenceIndexes } from '../services/persistenceIndexReadiness.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mongoTestHelper.js';

test('explicit migration provisions authorization indexes and passkey enrollment rolls back both writes atomically', async () => {
  let challengeId;
  let userId;
  let credentialId;

  try {
    await setupTestDatabase({ requireReplicaSet: true });
    const credentialUniqueIndex = PasskeyCredential.schema.indexes().find(([, options]) => options.unique === true);
    assert.ok(credentialUniqueIndex, 'fixture must identify the schema-declared unique credential index');
    const [credentialIndexKey, credentialIndexOptions] = credentialUniqueIndex;
    const credentialIndexName = credentialIndexOptions.name
      || Object.entries(credentialIndexKey).map(([field, direction]) => `${field}_${direction}`).join('_');
    const preservationProbe = 'phase2_migration_unrelated_index_probe';
    await PasskeyCredential.collection.createIndex({ deviceType: 1 }, { name: preservationProbe });
    await PasskeyCredential.collection.dropIndex(credentialIndexName);

    await assert.rejects(
      verifyAuthorizationPersistenceIndexes({ force: true }),
      error => error.code === 'PERSISTENCE_INDEXES_UNAVAILABLE',
      'readiness must expose the missing persisted index before migration',
    );
    await migratePersistenceIndexes();
    await migratePersistenceIndexes();
    assert.equal((await verifyAuthorizationPersistenceIndexes({ force: true })).ready, true);
    const persistedIndexes = await PasskeyCredential.collection.indexes();
    assert.ok(persistedIndexes.some(index => index.name === credentialIndexName && index.unique === true));
    assert.ok(persistedIndexes.some(index => index.name === preservationProbe), 'migration must preserve unrelated indexes');

    userId = new mongoose.Types.ObjectId();
    credentialId = crypto.randomBytes(24).toString('base64url');
    const challenge = await PasskeyRegistrationChallenge.create({
      userId,
      challenge: crypto.randomBytes(32).toString('base64url'),
      expiresAt: new Date(Date.now() + 60_000),
    });
    challengeId = challenge._id;

    await assert.rejects(() => verifyPasskeyRegistration({
      userId,
      response: {},
      dependencies: {
        approvalProvider: {
          name: 'WEBAUTHN',
          async verifyRegistration() {
            return {
              credential: { id: credentialId, publicKey: Buffer.from('test-public-key'), counter: 0 },
              credentialDeviceType: 'singleDevice',
              credentialBackedUp: false,
            };
          },
        },
        credentialModel: {
          async create(documents, options) {
            await PasskeyCredential.create(documents, options);
            throw new Error('injected failure after credential insert');
          },
        },
      },
    }), /injected failure after credential insert/);

    const persistedChallenge = await PasskeyRegistrationChallenge.findById(challengeId).lean();
    assert.equal(persistedChallenge.consumedAt, null, 'challenge consumption must abort with credential persistence');
    assert.equal(await PasskeyCredential.countDocuments({ userId, credentialId }), 0, 'credential insert must abort with challenge consumption');
  } finally {
    if (challengeId) await PasskeyRegistrationChallenge.deleteOne({ _id: challengeId }).catch(() => {});
    if (userId && credentialId) await PasskeyCredential.deleteOne({ userId, credentialId }).catch(() => {});
    await teardownTestDatabase();
  }
});

test('two concurrent passkey enrollments for one challenge commit exactly once', async () => {
  let challengeId;
  let userId;
  const credentialId = crypto.randomBytes(24).toString('base64url');
  let verificationCount = 0;
  let signalBothVerified;
  let releaseVerification;
  const bothVerified = new Promise(resolve => { signalBothVerified = resolve; });
  const verificationBarrier = new Promise(resolve => { releaseVerification = resolve; });

  try {
    await setupTestDatabase({ requireReplicaSet: true });
    userId = new mongoose.Types.ObjectId();
    const challenge = await PasskeyRegistrationChallenge.create({
      userId,
      challenge: crypto.randomBytes(32).toString('base64url'),
      expiresAt: new Date(Date.now() + 60_000),
    });
    challengeId = challenge._id;

    const dependencies = {
      approvalProvider: {
        name: 'WEBAUTHN',
        async verifyRegistration() {
          verificationCount += 1;
          if (verificationCount === 2) signalBothVerified();
          await verificationBarrier;
          return {
            credential: { id: credentialId, publicKey: Buffer.from('concurrent-test-key'), counter: 0 },
            credentialDeviceType: 'singleDevice',
            credentialBackedUp: false,
          };
        },
      },
    };
    const attempts = [
      verifyPasskeyRegistration({ userId, response: {}, dependencies }),
      verifyPasskeyRegistration({ userId, response: {}, dependencies }),
    ];

    await bothVerified;
    releaseVerification();
    const outcomes = await Promise.allSettled(attempts);
    assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
    const rejected = outcomes.find(outcome => outcome.status === 'rejected');
    assert.equal(rejected.reason.code, 'TRUSTED_APPROVAL_INVALID');
    assert.equal(await PasskeyCredential.countDocuments({ userId, credentialId }), 1);
    const persistedChallenge = await PasskeyRegistrationChallenge.findById(challengeId).lean();
    assert.ok(persistedChallenge.consumedAt);
  } finally {
    releaseVerification?.();
    if (challengeId) await PasskeyRegistrationChallenge.deleteOne({ _id: challengeId }).catch(() => {});
    if (userId) await PasskeyCredential.deleteMany({ userId }).catch(() => {});
    await teardownTestDatabase();
  }
});
