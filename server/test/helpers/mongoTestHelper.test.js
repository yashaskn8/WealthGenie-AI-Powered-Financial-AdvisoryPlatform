import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  setupTestDatabase,
  teardownTestDatabase,
  getActiveDbMechanism,
  getActiveDbUri,
} from './mongoTestHelper.js';

test('mongoTestHelper: provisions database and connects Mongoose', async () => {
  // Test fallback/default mechanism
  const db = await setupTestDatabase();
  assert.ok(db.uri, 'Should return a valid URI');
  assert.ok(getActiveDbMechanism(), 'Should report active mechanism');
  assert.strictEqual(mongoose.connection.readyState, 1, 'Mongoose should be connected');
  assert.ok(getActiveDbUri(), 'Should report active URI');

  await teardownTestDatabase();
  assert.strictEqual(mongoose.connection.readyState, 0, 'Mongoose should be disconnected after teardown');
  assert.strictEqual(getActiveDbMechanism(), null, 'Active mechanism should be reset');
});

test('mongoTestHelper: fail-fast mode produces descriptive actionable error when all mechanisms disabled', async () => {
  const origTestcontainers = process.env.USE_TESTCONTAINERS;
  const origMms = process.env.USE_MMS;
  const origUri = process.env.MONGODB_URI;
  const origMongoUri = process.env.MONGO_URI;

  try {
    process.env.USE_TESTCONTAINERS = 'false';
    process.env.USE_MMS = 'false';
    delete process.env.MONGODB_URI;
    delete process.env.MONGO_URI;

    await assert.rejects(
      async () => {
        await setupTestDatabase();
      },
      (err) => {
        assert.match(err.message, /\[WealthGenie Test Setup Error\]/);
        assert.match(err.message, /Scenario A/);
        assert.match(err.message, /Scenario B/);
        assert.match(err.message, /Scenario C/);
        return true;
      }
    );
  } finally {
    if (origTestcontainers !== undefined) process.env.USE_TESTCONTAINERS = origTestcontainers;
    else delete process.env.USE_TESTCONTAINERS;

    if (origMms !== undefined) process.env.USE_MMS = origMms;
    else delete process.env.USE_MMS;

    if (origUri !== undefined) process.env.MONGODB_URI = origUri;
    else delete process.env.MONGODB_URI;
    if (origMongoUri !== undefined) process.env.MONGO_URI = origMongoUri;
    else delete process.env.MONGO_URI;
  }
});

test('mongoTestHelper refuses an external URI targeting a non-disposable database before connecting', async () => {
  const original = {
    mongoDb: process.env.MONGODB_URI,
    mongo: process.env.MONGO_URI,
    testcontainers: process.env.USE_TESTCONTAINERS,
    memoryServer: process.env.USE_MMS,
  };

  try {
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/wealthgenie_demo';
    delete process.env.MONGO_URI;
    process.env.USE_TESTCONTAINERS = 'false';
    process.env.USE_MMS = 'false';

    await assert.rejects(setupTestDatabase(), error => (
      /External MongoDB test URI must target a dedicated database/.test(error.message)
      && !/wealthgenie_demo/i.test(error.message)
    ));
    assert.equal(mongoose.connection.readyState, 0, 'unsafe external database must not be contacted');
  } finally {
    if (original.mongoDb === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = original.mongoDb;
    if (original.mongo === undefined) delete process.env.MONGO_URI;
    else process.env.MONGO_URI = original.mongo;
    if (original.testcontainers === undefined) delete process.env.USE_TESTCONTAINERS;
    else process.env.USE_TESTCONTAINERS = original.testcontainers;
    if (original.memoryServer === undefined) delete process.env.USE_MMS;
    else process.env.USE_MMS = original.memoryServer;
  }
});

test('mongoTestHelper rejects a remote host even when its database name looks disposable', async () => {
  const original = {
    mongoDb: process.env.MONGODB_URI,
    mongo: process.env.MONGO_URI,
    testcontainers: process.env.USE_TESTCONTAINERS,
    memoryServer: process.env.USE_MMS,
  };

  try {
    process.env.MONGODB_URI = 'mongodb+srv://test.invalid/wealthgenie_test';
    delete process.env.MONGO_URI;
    process.env.USE_TESTCONTAINERS = 'false';
    process.env.USE_MMS = 'false';

    await assert.rejects(setupTestDatabase(), error => (
      /External MongoDB test URI is invalid/.test(error.message)
      && !/test\.invalid|mongodb\+srv/i.test(error.message)
    ));
    assert.equal(mongoose.connection.readyState, 0, 'remote URI must be rejected before any network connection');
  } finally {
    if (original.mongoDb === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = original.mongoDb;
    if (original.mongo === undefined) delete process.env.MONGO_URI;
    else process.env.MONGO_URI = original.mongo;
    if (original.testcontainers === undefined) delete process.env.USE_TESTCONTAINERS;
    else process.env.USE_TESTCONTAINERS = original.testcontainers;
    if (original.memoryServer === undefined) delete process.env.USE_MMS;
    else process.env.USE_MMS = original.memoryServer;
  }
});

test('mongoTestHelper fails closed instead of adopting a Mongoose connection it did not provision', async () => {
  const original = {
    mongoDb: process.env.MONGODB_URI,
    mongo: process.env.MONGO_URI,
    testcontainers: process.env.USE_TESTCONTAINERS,
    memoryServer: process.env.USE_MMS,
  };
  const unrelatedTestServer = await MongoMemoryServer.create({ binary: { version: '7.0.5' } });

  try {
    process.env.MONGODB_URI = unrelatedTestServer.getUri('wealthgenie_test');
    delete process.env.MONGO_URI;
    process.env.USE_TESTCONTAINERS = 'false';
    process.env.USE_MMS = 'false';
    await mongoose.connect(unrelatedTestServer.getUri('unowned_test'));

    await assert.rejects(
      setupTestDatabase(),
      error => error.code === 'MONGO_TEST_UNOWNED_CONNECTION',
    );
    assert.equal(mongoose.connection.readyState, 1, 'the helper must not adopt or disconnect a connection owned by its caller');
  } finally {
    await mongoose.disconnect();
    await unrelatedTestServer.stop();
    if (original.mongoDb === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = original.mongoDb;
    if (original.mongo === undefined) delete process.env.MONGO_URI;
    else process.env.MONGO_URI = original.mongo;
    if (original.testcontainers === undefined) delete process.env.USE_TESTCONTAINERS;
    else process.env.USE_TESTCONTAINERS = original.testcontainers;
    if (original.memoryServer === undefined) delete process.env.USE_MMS;
    else process.env.USE_MMS = original.memoryServer;
  }
});

test('mongoTestHelper disconnects from an unsuitable external test server before replica-set fallback', async () => {
  const original = {
    mongoDb: process.env.MONGODB_URI,
    mongo: process.env.MONGO_URI,
    testcontainers: process.env.USE_TESTCONTAINERS,
    memoryServer: process.env.USE_MMS,
  };
  const standalone = await MongoMemoryServer.create({ binary: { version: '7.0.5' } });

  try {
    process.env.MONGODB_URI = standalone.getUri('wealthgenie_test');
    delete process.env.MONGO_URI;
    process.env.USE_TESTCONTAINERS = 'false';
    process.env.USE_MMS = 'true';

    const database = await setupTestDatabase({ requireReplicaSet: true });
    assert.equal(database.mechanism, 'mongodb_memory_server', 'standalone external URI must not remain active');
    assert.notEqual(database.uri, process.env.MONGODB_URI, 'fallback must connect to its own isolated replica set');
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    assert.ok(hello.setName, 'fallback connection must be transaction-capable');
    await teardownTestDatabase();
    assert.equal(mongoose.connection.readyState, 0);
  } finally {
    await teardownTestDatabase();
    await standalone.stop();
    if (original.mongoDb === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = original.mongoDb;
    if (original.mongo === undefined) delete process.env.MONGO_URI;
    else process.env.MONGO_URI = original.mongo;
    if (original.testcontainers === undefined) delete process.env.USE_TESTCONTAINERS;
    else process.env.USE_TESTCONTAINERS = original.testcontainers;
    if (original.memoryServer === undefined) delete process.env.USE_MMS;
    else process.env.USE_MMS = original.memoryServer;
  }
});
