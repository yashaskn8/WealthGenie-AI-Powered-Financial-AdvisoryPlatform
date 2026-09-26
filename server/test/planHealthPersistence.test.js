import assert from 'node:assert/strict';
import test from 'node:test';
import PlanHealthEvent from '../models/PlanHealthEvent.js';
import PlanHealthSchedulerLease from '../models/PlanHealthSchedulerLease.js';
import AgentQueueAdmission from '../models/AgentQueueAdmission.js';
import AgentRun from '../models/AgentRun.js';
import { migratePlanHealthPersistence, verifyPlanHealthPersistence } from '../services/planHealthPersistence.js';

function modelIndexes(model) {
  return [
    { key: { _id: 1 }, name: '_id_' },
    ...model.schema.indexes().map(([key, options]) => ({
      key,
      name: options.name || Object.entries(key).map(([field, direction]) => `${field}_${direction}`).join('_'),
      unique: options.unique,
      partialFilterExpression: options.partialFilterExpression,
      collation: options.collation,
    })),
  ];
}

function persistenceFixture({ omitFingerprintIndex = false, omitPriorityIndex = false } = {}) {
  const legacyLease = { _id: '2026-09-26', periodKey: '2026-09-26', owner: 'old-worker', leaseUntil: new Date(0), usersScanned: 12 };
  let admission = null;
  let indexesCreated = 0;
  let priorityBackfill = null;
  const eventModel = {
    modelName: PlanHealthEvent.modelName,
    schema: PlanHealthEvent.schema,
    collection: {
      collectionName: PlanHealthEvent.collection.collectionName,
      indexes: async () => modelIndexes(PlanHealthEvent).filter(index => !(omitFingerprintIndex && index.key.fingerprint)),
    },
    createCollection: async () => undefined,
    createIndexes: async () => { indexesCreated += 1; },
  };
  const leaseModel = {
    modelName: PlanHealthSchedulerLease.modelName,
    schema: PlanHealthSchedulerLease.schema,
    collection: {
      collectionName: PlanHealthSchedulerLease.collection.collectionName,
      indexes: async () => [{ key: { _id: 1 }, name: '_id_' }, { key: { status: 1, leaseUntil: 1 }, name: 'status_1_leaseUntil_1' }],
      find: () => ({ async *[Symbol.asyncIterator]() { yield { ...legacyLease }; } }),
      updateOne: async (_filter, update) => {
        Object.assign(legacyLease, update.$set);
        return { modifiedCount: 1 };
      },
      findOne: async () => legacyLease,
    },
    createCollection: async () => undefined,
    createIndexes: async () => { indexesCreated += 1; },
  };
  const admissionModel = {
    modelName: AgentQueueAdmission.modelName,
    collection: {
      collectionName: AgentQueueAdmission.collection.collectionName,
      findOne: async () => admission,
    },
    createCollection: async () => undefined,
    updateOne: async (_filter, update) => {
      admission ||= { _id: 'plan-review', ...update.$setOnInsert };
      return { modifiedCount: 1 };
    },
  };
  const agentRunModel = {
    modelName: AgentRun.modelName,
    schema: AgentRun.schema,
    collection: {
      collectionName: AgentRun.collection.collectionName,
      indexes: async () => modelIndexes(AgentRun).filter(index => !(omitPriorityIndex && index.key.priorityRank)),
      updateMany: async (filter, pipeline) => { priorityBackfill = { filter, pipeline }; return { modifiedCount: 1 }; },
      countDocuments: async () => 0,
    },
    createCollection: async () => undefined,
    createIndexes: async () => { indexesCreated += 1; },
  };
  return {
    eventModel, leaseModel, admissionModel, agentRunModel, legacyLease,
    get indexesCreated() { return indexesCreated; },
    get priorityBackfill() { return priorityBackfill; },
  };
}

test('Phase 5 migration backfills resumable scheduler state and installs/verifies required indexes', async () => {
  const fixture = persistenceFixture();
  const result = await migratePlanHealthPersistence(fixture);
  assert.equal(result.ready, true);
  assert.equal(fixture.legacyLease.status, 'FAILED');
  assert.equal(fixture.legacyLease.executionGeneration, 0);
  assert.equal(fixture.legacyLease.cursor, null);
  assert.equal(fixture.legacyLease.usersScanned, 12);
  assert.equal(fixture.indexesCreated, 3);
  assert.deepEqual(fixture.priorityBackfill.filter, { priorityRank: { $exists: false } });
  assert.deepEqual(fixture.priorityBackfill.pipeline[0].$set.priorityRank, {
    $cond: [{ $eq: ['$priority', 'PLAN_HEALTH_BACKGROUND'] }, 100, 0],
  });
  assert.equal((await verifyPlanHealthPersistence(fixture)).ready, true);
});

test('worker runtime readiness fails closed without the numeric queue-priority index', async () => {
  const fixture = persistenceFixture({ omitPriorityIndex: true });
  await assert.rejects(verifyPlanHealthPersistence(fixture), error => error.code === 'PLAN_HEALTH_PERSISTENCE_UNAVAILABLE');
});

test('Plan Health readiness fails closed when its unique event identity index is missing', async () => {
  const fixture = persistenceFixture({ omitFingerprintIndex: true });
  await assert.rejects(verifyPlanHealthPersistence(fixture), error => error.code === 'PERSISTENCE_INDEXES_UNAVAILABLE');
});
