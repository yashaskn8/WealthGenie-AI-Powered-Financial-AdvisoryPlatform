import assert from 'node:assert/strict';
import test from 'node:test';
import PlanHealthEvent from '../models/PlanHealthEvent.js';
import PlanHealthInspectionFence from '../models/PlanHealthInspectionFence.js';
import PlanHealthSchedulerLease from '../models/PlanHealthSchedulerLease.js';
import AgentQueueAdmission from '../models/AgentQueueAdmission.js';
import AgentRun from '../models/AgentRun.js';
import {
  migratePlanHealthPersistence,
  verifyAgentRuntimePersistence,
  verifyPlanHealthPersistence,
} from '../services/planHealthPersistence.js';

function modelIndexes(model) {
  return [
    { key: { _id: 1 }, name: '_id_' },
    ...model.schema.indexes().map(([key, options]) => ({
      key,
      name: options.name || Object.entries(key).map(([field, direction]) => `${field}_${direction}`).join('_'),
      unique: options.unique,
      partialFilterExpression: options.partialFilterExpression,
      collation: options.collation,
      expireAfterSeconds: options.expireAfterSeconds,
    })),
  ];
}

function persistenceFixture({
  omitFingerprintIndex = false,
  omitPriorityIndex = false,
  missingAdmission = false,
  unrankedRecords = 0,
  legacyFingerprintIndex = false,
  legacyEvents = [],
  failEventUpdateAfter = null,
} = {}) {
  const legacyLease = { _id: '2026-09-26', periodKey: '2026-09-26', owner: 'old-worker', leaseUntil: new Date(0), usersScanned: 12 };
  let admission = null;
  let indexesCreated = 0;
  let priorityBackfill = null;
  const eventRows = legacyEvents;
  const eventUpdates = [];
  const droppedEventIndexes = [];
  let failEventUpdateRemaining = failEventUpdateAfter;
  let eventIndexes = modelIndexes(PlanHealthEvent).filter(index => !(omitFingerprintIndex && index.key.fingerprint));
  if (legacyFingerprintIndex) {
    eventIndexes = eventIndexes.filter(index => !index.key.fingerprint);
    eventIndexes.push({ key: { fingerprint: 1 }, name: 'fingerprint_1', unique: true });
  }
  const eventModel = {
    modelName: PlanHealthEvent.modelName,
    schema: PlanHealthEvent.schema,
    collection: {
      collectionName: PlanHealthEvent.collection.collectionName,
      indexes: async () => eventIndexes,
      dropIndex: async name => {
        droppedEventIndexes.push(name);
        eventIndexes = eventIndexes.filter(index => index.name !== name);
      },
      find: () => ({
        sort(order) {
          eventRows.sort((left, right) => {
            for (const [field, direction] of Object.entries(order)) {
              const a = left[field] == null ? '' : String(left[field]);
              const b = right[field] == null ? '' : String(right[field]);
              if (a !== b) return a.localeCompare(b) * direction;
            }
            return 0;
          });
          return this;
        },
        async *[Symbol.asyncIterator]() { yield* eventRows; },
      }),
      updateOne: async (filter, update) => {
        const row = eventRows.find(candidate => String(candidate._id) === String(filter._id));
        if (!row) return { modifiedCount: 0 };
        Object.assign(row, update.$set);
        eventUpdates.push({ id: String(row._id), set: { ...update.$set } });
        if (failEventUpdateRemaining !== null) {
          failEventUpdateRemaining -= 1;
          if (failEventUpdateRemaining === 0) {
            failEventUpdateRemaining = null;
            throw Object.assign(new Error('simulated migration interruption after durable row update'), { code: 'INJECTED_MIGRATION_INTERRUPTION' });
          }
        }
        return { modifiedCount: 1 };
      },
    },
    createCollection: async () => undefined,
    createIndexes: async () => {
      indexesCreated += 1;
      eventIndexes = modelIndexes(PlanHealthEvent);
    },
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
  const fenceModel = {
    modelName: PlanHealthInspectionFence.modelName,
    schema: PlanHealthInspectionFence.schema,
    collection: {
      collectionName: PlanHealthInspectionFence.collection.collectionName,
      indexes: async () => modelIndexes(PlanHealthInspectionFence),
    },
    createCollection: async () => undefined,
    createIndexes: async () => { indexesCreated += 1; },
  };
  const admissionModel = {
    modelName: AgentQueueAdmission.modelName,
    collection: {
      collectionName: AgentQueueAdmission.collection.collectionName,
      findOne: async () => (missingAdmission ? null : admission),
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
      countDocuments: async () => unrankedRecords,
    },
    createCollection: async () => undefined,
    createIndexes: async () => { indexesCreated += 1; },
  };
  return {
    eventModel, leaseModel, fenceModel, admissionModel, agentRunModel, legacyLease, eventRows, eventUpdates,
    get indexesCreated() { return indexesCreated; },
    get priorityBackfill() { return priorityBackfill; },
    get droppedEventIndexes() { return droppedEventIndexes; },
  };
}

function legacyEvent(id, overrides = {}) {
  return {
    _id: id,
    userId: 'user-1',
    profileId: 'profile-1',
    recommendationId: null,
    reason: 'RECOMMENDATION_MISSING',
    monitorVersion: 'plan-health-monitor-1.0.0',
    fingerprint: `legacy-${id}`,
    severity: 'BLOCKED',
    recommendation: 'A current authoritative recommendation is not available.',
    detectedAt: new Date(`2026-09-${String(Number(id.slice(-1)) + 1).padStart(2, '0')}T00:00:00.000Z`),
    status: 'UNREAD',
    ...overrides,
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
  assert.equal(fixture.indexesCreated, 4);
  assert.deepEqual(fixture.priorityBackfill.filter, { priorityRank: { $exists: false } });
  assert.deepEqual(fixture.priorityBackfill.pipeline[0].$set.priorityRank, {
    $cond: [{ $eq: ['$priority', 'PLAN_HEALTH_BACKGROUND'] }, 100, 0],
  });
  assert.equal((await verifyPlanHealthPersistence(fixture)).ready, true);
});

test('worker runtime readiness fails closed without the numeric queue-priority index', async () => {
  const fixture = persistenceFixture({ omitPriorityIndex: true });
  await assert.rejects(verifyAgentRuntimePersistence(fixture), error => error.code === 'PLAN_HEALTH_PERSISTENCE_UNAVAILABLE');
});

test('Plan Health readiness fails closed when its unique event identity index is missing', async () => {
  const fixture = persistenceFixture({ omitFingerprintIndex: true });
  await assert.rejects(verifyPlanHealthPersistence(fixture), error => error.code === 'PERSISTENCE_INDEXES_UNAVAILABLE');
});

test('PlanReview runtime readiness fails closed when queue admission state is absent or legacy runs remain unranked', async () => {
  await assert.rejects(
    verifyAgentRuntimePersistence(persistenceFixture({ missingAdmission: true })),
    error => error.code === 'AGENT_QUEUE_ADMISSION_UNAVAILABLE',
  );
  await assert.rejects(
    verifyAgentRuntimePersistence(persistenceFixture({ unrankedRecords: 1 })),
    error => error.code === 'PLAN_HEALTH_PERSISTENCE_UNAVAILABLE',
  );
});

test('migration reconciles active duplicates without deleting history and retains acknowledgement provenance', async () => {
  const acknowledgedAt = new Date('2026-09-10T10:00:00.000Z');
  const rows = [
    legacyEvent('event-1', { status: 'UNREAD', detectedAt: new Date('2026-09-11T00:00:00.000Z') }),
    legacyEvent('event-2', { status: 'ACKNOWLEDGED', acknowledgedAt, detectedAt: new Date('2026-09-12T00:00:00.000Z') }),
    legacyEvent('event-3', { status: 'RESOLVED', resolvedAt: new Date('2026-09-13T00:00:00.000Z') }),
  ];
  const fixture = persistenceFixture({ legacyFingerprintIndex: true, legacyEvents: rows });

  await migratePlanHealthPersistence(fixture);

  assert.equal(fixture.eventRows.length, 3, 'migration retains every historical event document');
  assert.equal(fixture.eventRows.filter(row => ['UNREAD', 'READ', 'OPEN', 'ACKNOWLEDGED'].includes(row.status)).length, 1);
  assert.equal(fixture.eventRows.find(row => row._id === 'event-2').status, 'ACKNOWLEDGED');
  assert.equal(fixture.eventRows.find(row => row._id === 'event-2').acknowledgedAt, acknowledgedAt);
  assert.equal(fixture.eventRows.find(row => row._id === 'event-1').status, 'SUPERSEDED');
  assert.equal(fixture.eventRows.find(row => row._id === 'event-3').status, 'RESOLVED');
  assert.equal(fixture.eventRows[0].fingerprint, fixture.eventRows[1].fingerprint);
});

test('migration folds exactly two active duplicates into one canonical current event', async () => {
  const fixture = persistenceFixture({ legacyEvents: [legacyEvent('event-1'), legacyEvent('event-2')] });
  await migratePlanHealthPersistence(fixture);
  assert.equal(fixture.eventRows.length, 2);
  assert.equal(fixture.eventRows.filter(row => ['UNREAD', 'READ', 'OPEN', 'ACKNOWLEDGED'].includes(row.status)).length, 1);
  assert.equal(fixture.eventRows.filter(row => row.status === 'SUPERSEDED').length, 1);
});

test('migration preserves resolved history while reconciling it with an unread duplicate', async () => {
  const resolvedAt = new Date('2026-09-20T00:00:00.000Z');
  const fixture = persistenceFixture({ legacyEvents: [
    legacyEvent('event-1', { status: 'UNREAD' }),
    legacyEvent('event-2', { status: 'RESOLVED', resolvedAt }),
  ] });
  await migratePlanHealthPersistence(fixture);
  assert.equal(fixture.eventRows.filter(row => row.status === 'UNREAD').length, 1);
  assert.equal(fixture.eventRows.find(row => row._id === 'event-2').status, 'RESOLVED');
  assert.equal(fixture.eventRows.find(row => row._id === 'event-2').resolvedAt, resolvedAt);
});

test('migration interruption after a durable event update can be rerun without losing or duplicating history', async () => {
  const fixture = persistenceFixture({
    legacyEvents: [legacyEvent('event-1'), legacyEvent('event-2'), legacyEvent('event-3')],
    failEventUpdateAfter: 1,
  });
  await assert.rejects(migratePlanHealthPersistence(fixture), error => error.code === 'INJECTED_MIGRATION_INTERRUPTION');
  assert.equal(fixture.eventRows.length, 3);
  await migratePlanHealthPersistence(fixture);
  assert.equal(fixture.eventRows.length, 3);
  assert.equal(fixture.eventRows.filter(row => ['UNREAD', 'READ', 'OPEN', 'ACKNOWLEDGED'].includes(row.status)).length, 1);
  assert.equal(new Set(fixture.eventRows.map(row => row.fingerprint)).size, 1);
});

test('migration retains the correctly named active unique index without dropping it', async () => {
  const fixture = persistenceFixture();
  await migratePlanHealthPersistence(fixture);
  assert.deepEqual(fixture.droppedEventIndexes, []);
  const activeFingerprintIndex = modelIndexes(PlanHealthEvent).find(index => index.name === 'uniq_active_plan_health_fingerprint');
  assert.equal(activeFingerprintIndex.unique, true);
  assert.deepEqual(activeFingerprintIndex.partialFilterExpression, {
    status: { $in: ['UNREAD', 'READ', 'OPEN', 'ACKNOWLEDGED'] },
  });
});

test('migration deterministically folds ten identical active rows to one active identity and is idempotent', async () => {
  const rows = Array.from({ length: 10 }, (_, index) => legacyEvent(`event-${index}`));
  const fixture = persistenceFixture({ legacyEvents: rows });

  await migratePlanHealthPersistence(fixture);
  const firstStatuses = fixture.eventRows.map(row => [row._id, row.status]);
  const firstEventUpdateCount = fixture.eventUpdates.length;
  await migratePlanHealthPersistence(fixture);

  assert.equal(fixture.eventRows.length, 10);
  assert.equal(fixture.eventRows.filter(row => ['UNREAD', 'READ', 'OPEN', 'ACKNOWLEDGED'].includes(row.status)).length, 1);
  assert.equal(fixture.eventRows.filter(row => row.status === 'SUPERSEDED').length, 9);
  assert.deepEqual(fixture.eventRows.map(row => [row._id, row.status]), firstStatuses);
  assert.equal(fixture.eventUpdates.length, firstEventUpdateCount, 'a second migration performs no event rewrites');
});

test('migration keeps profile and recommendation identities independent', async () => {
  const fixture = persistenceFixture({ legacyEvents: [
    legacyEvent('event-1'),
    legacyEvent('event-2', { profileId: 'profile-2' }),
    legacyEvent('event-3', { recommendationId: 'recommendation-1' }),
  ] });

  await migratePlanHealthPersistence(fixture);

  assert.equal(fixture.eventRows.length, 3);
  assert.equal(fixture.eventRows.filter(row => row.status === 'UNREAD').length, 3);
  assert.equal(new Set(fixture.eventRows.map(row => row.fingerprint)).size, 3);
});

test('migration fails closed on ambiguous identity without deleting evidence', async () => {
  const invalid = legacyEvent('event-invalid', { profileId: null });
  const fixture = persistenceFixture({ legacyEvents: [invalid] });

  await assert.rejects(
    migratePlanHealthPersistence(fixture),
    error => error.code === 'PHASE5_PLAN_HEALTH_DUPLICATE_IDENTITY_AMBIGUOUS',
  );
  assert.equal(fixture.eventRows.length, 1);
  assert.equal(fixture.eventRows[0].profileId, null);
});
