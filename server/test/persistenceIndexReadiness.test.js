import test from 'node:test';
import assert from 'node:assert/strict';
import IdempotencyKey from '../models/IdempotencyKey.js';
import {
  migratePersistenceIndexes,
  verifyPersistenceIndexes,
} from '../services/persistenceIndexReadiness.js';

function fakeModel(indexes = []) {
  let currentIndexes = indexes;
  return {
    modelName: 'FixtureModel',
    schema: { indexes: () => [[{ owner: 1, resource: 1 }, { unique: true, name: 'unique_owner_resource' }]] },
    collection: {
      collectionName: 'fixture_records',
      async indexes() { return currentIndexes; },
    },
    async createCollection() {},
    async createIndexes() {
      currentIndexes = [{ key: { owner: 1, resource: 1 }, unique: true, name: 'unique_owner_resource' }];
    },
  };
}

test('runtime index verification is read-only and accepts the required uniqueness index', async () => {
  const model = fakeModel([{ key: { owner: 1, resource: 1 }, unique: true, name: 'unique_owner_resource' }]);
  let ddlCalls = 0;
  model.collection.createIndex = async () => { ddlCalls += 1; };
  model.collection.dropIndex = async () => { ddlCalls += 1; };
  const result = await verifyPersistenceIndexes({ models: [model], force: true });
  assert.equal(result.ready, true);
  assert.equal(ddlCalls, 0);
});

test('runtime readiness fails closed when a required unique index is missing', async () => {
  await assert.rejects(
    verifyPersistenceIndexes({ models: [fakeModel()], force: true }),
    error => error.status === 503
      && error.code === 'PERSISTENCE_INDEXES_UNAVAILABLE'
      && error.clientDetails.missing.includes('fixture_records:unique_owner_resource'),
  );
});

test('runtime readiness rejects the obsolete idempotency TTL index without removing it', async () => {
  const originalIndexes = IdempotencyKey.collection.indexes;
  const originalDropIndex = IdempotencyKey.collection.dropIndex;
  let drops = 0;
  IdempotencyKey.collection.indexes = async () => [
    { name: '_id_', key: { _id: 1 }, unique: true },
    { name: 'createdAt_1', key: { createdAt: 1 }, expireAfterSeconds: 300 },
  ];
  IdempotencyKey.collection.dropIndex = async () => { drops += 1; };
  try {
    await assert.rejects(
      verifyPersistenceIndexes({ models: [IdempotencyKey], force: true }),
      error => error.code === 'PERSISTENCE_INDEXES_UNAVAILABLE',
    );
    assert.equal(drops, 0, 'request-time readiness must never drop a TTL index');
  } finally {
    IdempotencyKey.collection.indexes = originalIndexes;
    IdempotencyKey.collection.dropIndex = originalDropIndex;
  }
});

test('explicit migration removes the obsolete idempotency TTL and creates required schema indexes', async () => {
  const originalIndexes = IdempotencyKey.collection.indexes;
  const originalDropIndex = IdempotencyKey.collection.dropIndex;
  const dropped = [];
  IdempotencyKey.collection.indexes = async () => [
    { name: 'createdAt_1', key: { createdAt: 1 }, expireAfterSeconds: 300 },
  ];
  IdempotencyKey.collection.dropIndex = async name => { dropped.push(name); };
  const model = fakeModel();
  try {
    const result = await migratePersistenceIndexes({ models: [model] });
    assert.deepEqual(dropped, ['createdAt_1']);
    assert.equal(result.ready, true);
  } finally {
    IdempotencyKey.collection.indexes = originalIndexes;
    IdempotencyKey.collection.dropIndex = originalDropIndex;
  }
});
