import assert from 'node:assert/strict';
import test from 'node:test';
import AgentRun from '../models/AgentRun.js';
import { migratePlanReviewPersistenceIndexes, verifyPlanReviewPersistenceIndexes } from '../services/planReviewPersistence.js';

function fixtureModel(modelName, indexes, { collectionIndexes = [] } = {}) {
  let actualIndexes = collectionIndexes;
  const ddl = { createCollection: 0, createIndexes: 0, dropped: [] };
  return {
    modelName,
    collection: {
      collectionName: `${modelName.toLowerCase()}_records`,
      async indexes() { return actualIndexes; },
      async dropIndex(name) {
        ddl.dropped.push(name);
        actualIndexes = actualIndexes.filter(index => index.name !== name);
      },
    },
    schema: {
      indexes: () => indexes.map(index => [index.key, { ...index.options, name: index.name }]),
    },
    async createCollection() { ddl.createCollection += 1; },
    async createIndexes() {
      ddl.createIndexes += 1;
      actualIndexes = indexes.map(index => ({ key: index.key, ...index.options, name: index.name }));
    },
    get ddl() { return ddl; },
  };
}

const required = [
  fixtureModel('AgentRun', [
    { name: 'unique_run', key: { runId: 1 }, options: { unique: true } },
    { name: 'uniq_agent_run_active_dedupe_key', key: { activeDedupeKey: 1 }, options: { unique: true, partialFilterExpression: { activeDedupeKey: { $type: 'string' } } } },
  ], { collectionIndexes: [{ name: 'activeDedupeKey_1', key: { activeDedupeKey: 1 }, unique: true, partialFilterExpression: { activeDedupeKey: { $exists: true } } }] }),
  fixtureModel('AgentCheckpoint', [
    { name: 'unique_checkpoint', key: { runId: 1, executionGeneration: 1, sequence: 1 }, options: { unique: true } },
    { name: 'ttl_terminal_agent_checkpoints', key: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
  ], {
    collectionIndexes: [{ name: 'legacy_checkpoint', key: { runId: 1, sequence: -1 }, unique: true }],
  }),
  fixtureModel('AgentGraphCheckpoint', [
    { name: 'unique_graph_checkpoint', key: { threadId: 1, checkpointId: 1 }, options: { unique: true } },
    { name: 'ttl_terminal_agent_graph_checkpoints', key: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
  ]),
  fixtureModel('AgentRunEvent', [{ name: 'unique_event', key: { runId: 1, sequence: 1 }, options: { unique: true } }]),
];

test('PlanReview runtime readiness is read-only and fails closed when a required index is absent', async () => {
  const noIndexes = fixtureModel('AgentRun', [{ name: 'unique_run', key: { runId: 1 }, options: { unique: true } }]);
  await assert.rejects(
    verifyPlanReviewPersistenceIndexes({ models: [noIndexes], force: true }),
    error => error.status === 503
      && error.code === 'PERSISTENCE_INDEXES_UNAVAILABLE'
      && error.clientDetails.missing.includes('agentrun_records:unique_run'),
  );
  assert.equal(noIndexes.ddl.createIndexes, 0, 'readiness must not run index DDL');
});

test('explicit PlanReview migration drops only the obsolete checkpoint index and is repeatable', async () => {
  const models = required.map(model => model);
  const first = await migratePlanReviewPersistenceIndexes({ models });
  const second = await migratePlanReviewPersistenceIndexes({ models });
  assert.equal(first.ready, true);
  assert.equal(second.ready, true);
  assert.deepEqual(required[1].ddl.dropped, ['legacy_checkpoint']);
  assert.deepEqual(required[0].ddl.dropped, ['activeDedupeKey_1']);
  assert.ok(required.every(model => model.ddl.createIndexes === 2));
});

test('AgentRun schema partial unique dedupe index excludes explicit null and missing values', () => {
  const activeIndex = AgentRun.schema.indexes().find(([key, options]) => (
    key.activeDedupeKey === 1 && options.unique === true
  ));
  assert.deepEqual(activeIndex?.[1].partialFilterExpression, { activeDedupeKey: { $type: 'string' } });
});
