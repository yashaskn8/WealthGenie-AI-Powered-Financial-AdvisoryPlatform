/**
 * WealthGenie Server Test Database Helper
 * 
 * Provides unified, resilient database provisioning across 3 supported environments:
 *  1. External/CI MongoDB (via process.env.MONGODB_URI or process.env.MONGO_URI)
 *     - Uses pre-started MongoDB service (e.g. GitHub Actions supercharge/mongodb-github-action)
 *     - Zero startup latency, zero binary download, 100% offline-compatible
 *  2. Testcontainers (Docker mongo:7.0)
 *     - Spun up via @testcontainers/mongodb using identical image tag (mongo:7.0) as CI & k8s
 *     - Provides real containerized MongoDB instance for local Docker environments
 *  3. MongoMemoryServer (7.0.5)
 *     - In-memory binary fallback for developer environments with internet/cached binary
 *  4. Fail-Fast Diagnostic Guard
 *     - When none of the mechanisms are available, fails immediately with clear,
 *       actionable instructions rather than cryptic network errors or hangs.
 */

import mongoose from 'mongoose';

const MONGO_IMAGE = process.env.MONGO_TEST_IMAGE || 'mongo:7.0';
const MONGO_VERSION = '7.0.5';

let activeContainer = null;
let activeMongoServer = null;
let activeUri = null;
let activeMechanism = null;

/**
 * Builds actionable fail-fast error message when no database mechanism is available.
 */
function buildFailFastError(errors = {}) {
  const details = Object.entries(errors)
    .map(([mechanism, err]) => `  • ${mechanism}: ${err?.message || err}`)
    .join('\n');

  return new Error(
    `\n================================================================================\n` +
    `[WealthGenie Test Setup Error] Failed to initialize MongoDB test database.\n` +
    `================================================================================\n` +
    `None of the 3 supported database provisioning mechanisms could be started:\n\n` +
    `${details}\n\n` +
    `HOW TO RESOLVE (Choose one of the following scenarios):\n\n` +
    `  Scenario A — Pre-started MongoDB (Recommended for CI & air-gapped environments):\n` +
    `    1. Start a local MongoDB instance: mongod --dbpath <data_dir> (or system service)\n` +
    `    2. Set environment variable: MONGODB_URI="mongodb://127.0.0.1:27017/wealthgenie_test"\n` +
    `    3. Run tests: npm test\n\n` +
    `  Scenario B — Docker / Testcontainers (Recommended for local dev with Docker):\n` +
    `    1. Ensure Docker Desktop or dockerd is running\n` +
    `    2. Run tests: npm test (will automatically start a '${MONGO_IMAGE}' container)\n\n` +
    `  Scenario C — MongoMemoryServer (Requires network or pre-cached binary):\n` +
    `    1. Ensure internet access to fastdl.mongodb.org for initial binary cache\n` +
    `    2. Run tests: npm test\n` +
    `================================================================================\n`
  );
}

/**
 * Attempts to connect via external MONGODB_URI environment variable.
 */
async function assertReplicaSet() {
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName) {
    throw new Error('MongoDB is standalone; a replica set is required for transaction tests');
  }
}

async function tryExternalUri(requireReplicaSet = false) {
  const envUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!envUri) {
    throw new Error('MONGODB_URI / MONGO_URI environment variable not set');
  }

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(envUri);
  }
  if (requireReplicaSet) await assertReplicaSet();
  activeUri = envUri;
  activeMechanism = 'external_uri';
  return { uri: envUri, mechanism: 'external_uri' };
}

/**
 * Attempts to start MongoDB via Testcontainers (mongo:7.0).
 */
async function tryTestcontainers(requireReplicaSet = false) {
  if (process.env.USE_TESTCONTAINERS === 'false') {
    throw new Error('Testcontainers disabled via USE_TESTCONTAINERS=false');
  }

  const { MongoDBContainer } = await import('@testcontainers/mongodb');
  const container = await new MongoDBContainer(MONGO_IMAGE).start();
  const uri = container.getConnectionString();

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
  if (requireReplicaSet) await assertReplicaSet();

  activeContainer = container;
  activeUri = uri;
  activeMechanism = 'testcontainers';
  return { uri, mechanism: 'testcontainers' };
}

/**
 * Attempts to start MongoDB via MongoMemoryServer (7.0.5).
 */
async function tryMongoMemoryServer() {
  if (process.env.USE_MMS === 'false') {
    throw new Error('MongoMemoryServer disabled via USE_MMS=false');
  }

  const { MongoMemoryReplSet } = await import('mongodb-memory-server');
  const mongoServer = await MongoMemoryReplSet.create({
    binary: { version: MONGO_VERSION },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const uri = mongoServer.getUri();

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }

  activeMongoServer = mongoServer;
  activeUri = uri;
  activeMechanism = 'mongodb_memory_server';
  return { uri, mechanism: 'mongodb_memory_server' };
}

/**
 * Provisions a test database using the priority chain:
 *  1. MONGODB_URI env (instantaneous, offline)
 *  2. Testcontainers mongo:7.0 (isolated, matches CI)
 *  3. MongoMemoryServer (in-memory)
 *  4. Fail-Fast Diagnostic Error
 * 
 * @returns {Promise<{ uri: string, mechanism: string, stop: Function }>}
 */
export async function setupTestDatabase({ requireReplicaSet = false } = {}) {
  if (process.env.MONGO_TEST_PARTITION === 'NO_MONGO') {
    const error = new Error('A MongoDB-backed test ran inside the enforced no-Mongo test partition.');
    error.code = 'MONGO_TEST_PARTITION_VIOLATION';
    throw error;
  }

  // If already connected and provisioned in this process, reuse
  if (mongoose.connection.readyState === 1 && activeUri) {
    if (requireReplicaSet) await assertReplicaSet();
    return {
      uri: activeUri,
      mechanism: activeMechanism,
      stop: teardownTestDatabase,
    };
  }

  // If already provisioned but mongoose was disconnected, just reconnect to existing URI!
  if (activeUri && mongoose.connection.readyState === 0) {
    await mongoose.connect(activeUri);
    if (requireReplicaSet) await assertReplicaSet();
    return {
      uri: activeUri,
      mechanism: activeMechanism,
      stop: teardownTestDatabase,
    };
  }

  const errors = {};

  // 1. Try external URI (CI / pre-started instance)
  if (process.env.MONGODB_URI || process.env.MONGO_URI) {
    try {
      const res = await tryExternalUri(requireReplicaSet);
      return { ...res, stop: teardownTestDatabase };
    } catch (err) {
      errors['MONGODB_URI'] = err;
    }
  } else {
    errors['MONGODB_URI'] = new Error('Environment variable not set');
  }

  // 2. Try Testcontainers (Docker mongo:7.0)
  try {
    const res = await tryTestcontainers(requireReplicaSet);
    return { ...res, stop: teardownTestDatabase };
  } catch (err) {
    errors['Testcontainers (Docker ' + MONGO_IMAGE + ')'] = err;
  }

  // 3. Try MongoMemoryServer
  try {
    const res = await tryMongoMemoryServer();
    return { ...res, stop: teardownTestDatabase };
  } catch (err) {
    errors['MongoMemoryServer (' + MONGO_VERSION + ')'] = err;
  }

  // 4. Fail-Fast
  throw buildFailFastError(errors);
}

/**
 * Tears down the active test database connection and stops any spawned containers/instances.
 */
export async function teardownTestDatabase() {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  } catch (_) {}

  if (activeContainer) {
    try {
      await activeContainer.stop();
    } catch (_) {}
    activeContainer = null;
  }

  if (activeMongoServer) {
    try {
      await activeMongoServer.stop();
    } catch (_) {}
    activeMongoServer = null;
  }

  activeUri = null;
  activeMechanism = null;
}

/**
 * Returns currently active provisioning mechanism ('external_uri' | 'testcontainers' | 'mongodb_memory_server' | null)
 */
export function getActiveDbMechanism() {
  return activeMechanism;
}

/**
 * Returns currently active MongoDB URI or null
 */
export function getActiveDbUri() {
  return activeUri;
}
