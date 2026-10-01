import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateResearchTaskIndexes, verifyResearchTaskIndexes } from '../services/researchTaskPersistence.js';

function fakeModel({ initiallyIndexed = false } = {}) {
  const required = [
    [{ taskId: 1 }, { unique: true, name: 'uniq_research_task_id' }],
    [{ ownerKey: 1, statusTimestamp: -1, taskId: -1 }, { name: 'research_task_owner_timeline' }],
    [{ ownerKey: 1, contextId: 1, statusTimestamp: -1 }, { name: 'research_task_owner_context' }],
    [{ statusState: 1, executionLeaseExpiresAt: 1, createdAt: 1, taskId: 1 }, { name: 'research_task_recovery_lease' }],
    [{ ownerKey: 1, requestFingerprint: 1 }, {
      unique: true,
      name: 'uniq_research_task_active_semantic_request',
      partialFilterExpression: { activeDedupe: true, requestFingerprint: { $type: 'string' } },
    }],
  ];
  let indexes = initiallyIndexed ? required.map(([key, options]) => ({ key, ...options })) : [];
  return {
    db: { readyState: 1, db: {} },
    schema: { indexes: () => required },
    collection: { indexes: async () => indexes },
    createCollection: async () => undefined,
    createIndexes: async () => { indexes = required.map(([key, options]) => ({ key, ...options })); },
  };
}

function fakeCapacityModel({ initiallyReady = true, maxActiveTasks = 4, activeLeases = [] } = {}) {
  let state = initiallyReady ? { _id: 'research-agent-global', maxActiveTasks, activeLeases: structuredClone(activeLeases) } : null;
  let indexes = initiallyReady ? [{ key: { _id: 1 }, name: '_id_', unique: true }] : [];
  return {
    db: { readyState: 1, db: {} },
    collection: {
      indexes: async () => indexes,
      findOne: async () => state,
      updateOne: async (filter, update) => {
        if (!state) {
          state = { _id: filter._id, ...update.$setOnInsert };
          return { upsertedCount: 1 };
        }
        if (state.maxActiveTasks !== update.$setOnInsert.maxActiveTasks) return { upsertedCount: 0 };
        return { upsertedCount: 0 };
      },
      findOneAndUpdate: async (_filter, pipeline) => {
        if (state.activeLeases.length === 0) state.maxActiveTasks = pipeline[0].$set.maxActiveTasks.$cond[1];
        return { value: structuredClone(state) };
      },
    },
    createCollection: async () => undefined,
    createIndexes: async () => { indexes = [{ key: { _id: 1 }, name: '_id_', unique: true }]; },
  };
}

test('ResearchTask readiness fails closed until all declared indexes exist', async () => {
  const model = fakeModel();
  const capacityModel = fakeCapacityModel({ initiallyReady: false });
  await assert.rejects(() => verifyResearchTaskIndexes({ model, capacityModel }), error => (
    error.code === 'RESEARCH_TASK_INDEXES_UNAVAILABLE'
      && error.details.missing.length === 5
  ));
  assert.equal((await verifyResearchTaskIndexes({ model: fakeModel({ initiallyIndexed: true }), capacityModel: fakeCapacityModel() })).ready, true);
  await assert.rejects(
    () => verifyResearchTaskIndexes({ model: fakeModel({ initiallyIndexed: true }), capacityModel: fakeCapacityModel({ maxActiveTasks: 3 }) }),
    error => error.code === 'RESEARCH_TASK_CAPACITY_UNAVAILABLE',
  );
});

test('ResearchTask readiness accepts Mongo built-in _id index metadata without an explicit unique flag', async () => {
  const capacityModel = fakeCapacityModel();
  capacityModel.collection.indexes = async () => [{ key: { _id: 1 }, name: '_id_' }];
  const result = await verifyResearchTaskIndexes({
    model: fakeModel({ initiallyIndexed: true }),
    capacityModel,
  });
  assert.equal(result.ready, true);
});

test('ResearchTask migration creates the declared indexes then verifies them', async () => {
  const model = fakeModel();
  let collectionCreated = 0;
  let indexesCreated = 0;
  const capacityModel = fakeCapacityModel({ initiallyReady: false });
  model.createCollection = async () => { collectionCreated += 1; };
  model.createIndexes = async () => {
    indexesCreated += 1;
    const schemaIndexes = model.schema.indexes();
    model.collection.indexes = async () => schemaIndexes.map(([key, options]) => ({ key, ...options }));
  };
  const result = await migrateResearchTaskIndexes({ model, capacityModel, maxActiveTasks: 4 });
  assert.equal(collectionCreated, 1);
  assert.equal(indexesCreated, 1);
  assert.equal(result.ready, true);
});

test('ResearchTask migration accepts an already-existing collection without hiding other errors', async () => {
  const model = fakeModel({ initiallyIndexed: true });
  const capacityModel = fakeCapacityModel();
  model.createCollection = async () => { throw Object.assign(new Error('exists'), { code: 48 }); };
  model.createIndexes = async () => undefined;
  assert.equal((await migrateResearchTaskIndexes({ model, capacityModel })).ready, true);

  model.createCollection = async () => { throw Object.assign(new Error('permission denied'), { code: 13 }); };
  await assert.rejects(() => migrateResearchTaskIndexes({ model, capacityModel }), error => error.code === 13);
});

test('ResearchTask migration changes global capacity only when no live capacity lease exists', async () => {
  const model = fakeModel({ initiallyIndexed: true });
  const idleCapacity = fakeCapacityModel({ maxActiveTasks: 3 });
  assert.equal((await migrateResearchTaskIndexes({ model, capacityModel: idleCapacity, maxActiveTasks: 4 })).ready, true);
  assert.equal((await idleCapacity.collection.findOne({ _id: 'research-agent-global' })).maxActiveTasks, 4);

  const busyCapacity = fakeCapacityModel({
    maxActiveTasks: 3,
    activeLeases: [{ taskId: 'active', ownerKey: 'a'.repeat(64), token: 'lease', fence: 1, expiresAt: new Date(Date.now() + 60_000) }],
  });
  await assert.rejects(
    () => migrateResearchTaskIndexes({ model, capacityModel: busyCapacity, maxActiveTasks: 4 }),
    error => error.code === 'RESEARCH_TASK_CAPACITY_CONFIG_CONFLICT',
  );
});
