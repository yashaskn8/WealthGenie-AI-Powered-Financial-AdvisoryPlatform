import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateResearchTaskIndexes, verifyResearchTaskIndexes } from '../services/researchTaskPersistence.js';

function fakeModel({ initiallyIndexed = false } = {}) {
  const required = [
    [{ taskId: 1 }, { unique: true, name: 'uniq_research_task_id' }],
    [{ ownerKey: 1, statusTimestamp: -1, taskId: -1 }, { name: 'research_task_owner_timeline' }],
    [{ ownerKey: 1, contextId: 1, statusTimestamp: -1 }, { name: 'research_task_owner_context' }],
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

test('ResearchTask readiness fails closed until all declared indexes exist', async () => {
  const model = fakeModel();
  await assert.rejects(() => verifyResearchTaskIndexes({ model }), error => (
    error.code === 'RESEARCH_TASK_INDEXES_UNAVAILABLE'
      && error.details.missing.length === 3
  ));
  assert.equal((await verifyResearchTaskIndexes({ model: fakeModel({ initiallyIndexed: true }) })).ready, true);
});

test('ResearchTask migration creates the declared indexes then verifies them', async () => {
  const model = fakeModel();
  let collectionCreated = 0;
  let indexesCreated = 0;
  model.createCollection = async () => { collectionCreated += 1; };
  model.createIndexes = async () => {
    indexesCreated += 1;
    const schemaIndexes = model.schema.indexes();
    model.collection.indexes = async () => schemaIndexes.map(([key, options]) => ({ key, ...options }));
  };
  const result = await migrateResearchTaskIndexes({ model });
  assert.equal(collectionCreated, 1);
  assert.equal(indexesCreated, 1);
  assert.equal(result.ready, true);
});

test('ResearchTask migration accepts an already-existing collection without hiding other errors', async () => {
  const model = fakeModel({ initiallyIndexed: true });
  model.createCollection = async () => { throw Object.assign(new Error('exists'), { code: 48 }); };
  model.createIndexes = async () => undefined;
  assert.equal((await migrateResearchTaskIndexes({ model })).ready, true);

  model.createCollection = async () => { throw Object.assign(new Error('permission denied'), { code: 13 }); };
  await assert.rejects(() => migrateResearchTaskIndexes({ model }), error => error.code === 13);
});
