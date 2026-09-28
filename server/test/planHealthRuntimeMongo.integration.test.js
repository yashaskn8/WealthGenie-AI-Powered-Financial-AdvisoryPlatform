import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import test from 'node:test';
import AgentCheckpoint from '../models/AgentCheckpoint.js';
import AgentGraphCheckpoint from '../models/AgentGraphCheckpoint.js';
import AgentRun from '../models/AgentRun.js';
import AgentRunEvent from '../models/AgentRunEvent.js';
import PlanHealthEvent from '../models/PlanHealthEvent.js';
import PlanHealthInspectionFence from '../models/PlanHealthInspectionFence.js';
import PlanHealthSchedulerLease from '../models/PlanHealthSchedulerLease.js';
import FinancialProfileState from '../models/FinancialProfileState.js';
import {
  claimNextPlanReviewRun,
  createPlanReviewWorker,
  recoverExpiredPlanReviewRuns,
} from '../agents/planReview/planReviewWorkerCore.js';
import { claimPlanHealthSchedulerLease, runPlanHealthScan } from '../services/planHealthScheduler.js';
import { inspectPlanHealth, planHealthEventFingerprint } from '../services/planHealthMonitor.js';
import { migratePlanHealthPersistence } from '../services/planHealthPersistence.js';
import { migratePlanReviewPersistenceIndexes } from '../services/planReviewPersistence.js';
import { buildPlanReviewSnapshotBinding, hashPlanReviewSnapshot } from '../agents/planReview/planReviewRuntime.js';
import { enqueuePlanReviewRun } from '../agents/planReview/planReviewService.js';
import AgentQueueAdmission from '../models/AgentQueueAdmission.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mongoTestHelper.js';

async function setupRuntimeMongo() {
  await setupTestDatabase({ requireReplicaSet: true });
  await migratePlanReviewPersistenceIndexes();
  await migratePlanHealthPersistence();
}

function scopeProfileStateReads(model, userIds) {
  return {
    find(filter = {}) {
      return model.find({ $and: [filter, { userId: { $in: userIds } }] });
    },
  };
}

function admissionSnapshot(userId, profileId, profileVersion = 1) {
  const sourceBinding = buildPlanReviewSnapshotBinding({
    userId,
    profileId,
    currentState: { profileVersion },
    freshness: { fresh: false, reasonCodes: ['RECOMMENDATION_MISSING'] },
  });
  return { sourceBinding, planReviewSnapshotHash: hashPlanReviewSnapshot(sourceBinding) };
}

function enqueueFixture({ userId, profileId, snapshot = admissionSnapshot(userId, profileId), limits }) {
  return enqueuePlanReviewRun({
    userId,
    profileId,
    model: AgentRun,
    admissionModel: AgentQueueAdmission,
    mongo: mongoose,
    snapshotResolver: async () => snapshot,
    runtimeConfig: {
      agentPlanReview: {
        maxQueuedRunsPerUser: 20,
        maxActiveRunsPerUser: 1,
        maxGlobalQueuedRuns: 100,
        ...limits,
      },
    },
  });
}

async function createRunningRun({ userId, profileId, runId }) {
  const sourceBinding = buildPlanReviewSnapshotBinding({
    userId,
    profileId,
    currentState: { profileVersion: 1 },
    freshness: { fresh: false, reasonCodes: ['RECOMMENDATION_MISSING'] },
  });
  return AgentRun.create({
    runId,
    agentType: 'PLAN_REVIEW',
    userId,
    profileId,
    status: 'RUNNING',
    workerId: 'phase5-checkpoint-test-worker',
    priority: 'INTERACTIVE_PLAN_REVIEW',
    priorityRank: 0,
    queuedAt: new Date(),
    leaseUntil: new Date(Date.now() + 60000),
    sourceBinding,
    planReviewSnapshotHash: hashPlanReviewSnapshot(sourceBinding),
    attempt: 1,
    executionGeneration: 1,
    maxAttempts: 2,
    checkpointSequence: 0,
    eventSequence: 0,
  });
}

function collectPlanNodes(node, nodes = []) {
  if (Array.isArray(node)) {
    for (const value of node) collectPlanNodes(value, nodes);
    return nodes;
  }
  if (!node || typeof node !== 'object') return nodes;
  if (typeof node.stage === 'string') nodes.push(node);
  for (const value of Object.values(node)) collectPlanNodes(value, nodes);
  return nodes;
}

function indexPatternStartsWith(actual, requiredPrefix) {
  const actualEntries = Object.entries(actual || {});
  const requiredEntries = Object.entries(requiredPrefix || {});
  return requiredEntries.length > 0 && requiredEntries.every(([field, direction], index) => (
    actualEntries[index]?.[0] === field && actualEntries[index]?.[1] === direction
  ));
}

function assertEfficientQueryPlan(explain, {
  label,
  allowedIndexPrefixes = [],
  allowedIndexNames = [],
  expectedReturned,
  maxDocsExamined = 100,
  maxKeysExamined = 100,
} = {}) {
  const winningNodes = collectPlanNodes(explain?.queryPlanner?.winningPlan);
  const executedNodes = collectPlanNodes(explain?.executionStats?.executionStages);
  const planNodes = [...winningNodes, ...executedNodes];
  const stages = planNodes.map(node => node.stage);
  const winningIndexScans = winningNodes.filter(node => node.stage === 'IXSCAN');

  assert.ok(!stages.includes('COLLSCAN'), `${label} unexpectedly performed a collection scan; stages=${stages}`);
  assert.ok(!stages.includes('SORT'), `${label} unexpectedly used a blocking sort; stages=${stages}`);
  assert.ok(winningIndexScans.length > 0, `${label} must use IXSCAN; stages=${stages}`);

  const everyIndexScanIsSuitable = winningIndexScans.every(scan => (
    allowedIndexNames.includes(scan.indexName)
    || allowedIndexPrefixes.some(prefix => indexPatternStartsWith(scan.keyPattern, prefix))
  ));
  assert.ok(everyIndexScanIsSuitable, `${label} selected an unrelated or unsuitable index; IXSCANs=${JSON.stringify(winningIndexScans.map(({ indexName, keyPattern }) => ({ indexName, keyPattern })))}`);

  const stats = explain.executionStats;
  assert.ok(Number.isFinite(stats?.totalDocsExamined), `${label} explain is missing totalDocsExamined`);
  assert.ok(Number.isFinite(stats?.totalKeysExamined), `${label} explain is missing totalKeysExamined`);
  assert.ok(stats.totalDocsExamined <= maxDocsExamined,
    `${label} examined too many documents: ${stats.totalDocsExamined} > ${maxDocsExamined}`);
  assert.ok(stats.totalKeysExamined <= maxKeysExamined,
    `${label} examined too many index keys: ${stats.totalKeysExamined} > ${maxKeysExamined}`);
  assert.equal(stats.nReturned, expectedReturned, `${label} returned an unexpected number of rows`);
}

const graphGenerationIndexPrefixes = [
  { runId: 1 }, // Run-scoped fallback is permitted only while its measured scan stays bounded.
  { threadId: 1 }, // Thread-scoped lookup is likewise scan-bounded by executionStats.
  { threadId: 1, checkpointId: 1 }, // Exact checkpoint lookup index.
  { runId: 1, userId: 1, executionGeneration: 1, threadId: 1, checkpointId: 1 }, // Full generation identity.
];

test('query-plan contract accepts compatible indexes and rejects scans, unsuitable indexes, and amplification', () => {
  const compoundIndex = {
    stage: 'FETCH',
    inputStage: {
      stage: 'IXSCAN',
      indexName: 'runId_1_userId_1_executionGeneration_1_threadId_1_checkpointId_1',
      keyPattern: { runId: 1, userId: 1, executionGeneration: 1, threadId: 1, checkpointId: 1 },
    },
  };
  const makeExplain = (winningPlan, overrides = {}) => ({
    queryPlanner: { winningPlan },
    executionStats: {
      nReturned: 1,
      totalDocsExamined: 1,
      totalKeysExamined: 1,
      executionStages: winningPlan,
      ...overrides,
    },
  });
  const contract = {
    label: 'graph checkpoint generation retrieval',
    allowedIndexPrefixes: graphGenerationIndexPrefixes,
    expectedReturned: 1,
  };

  assert.doesNotThrow(() => assertEfficientQueryPlan(makeExplain(compoundIndex), contract),
    'FETCH + IXSCAN through the full compound identity index is a valid plan');

  for (const keyPattern of [
    { runId: 1 },
    { threadId: 1 },
    { threadId: 1, checkpointId: 1 },
  ]) {
    assert.doesNotThrow(() => assertEfficientQueryPlan(makeExplain({
      stage: 'IXSCAN', indexName: Object.keys(keyPattern).join('_'), keyPattern,
    }), contract), `supported index prefix ${JSON.stringify(keyPattern)} should not depend on a Mongo version-specific index name`);
  }

  assert.throws(() => assertEfficientQueryPlan(makeExplain({
    stage: 'FETCH', inputStage: { stage: 'IXSCAN', indexName: 'userId_1', keyPattern: { userId: 1 } },
  }), contract), /unrelated or unsuitable index/);
  assert.throws(() => assertEfficientQueryPlan(makeExplain({
    stage: 'FETCH', inputStage: { stage: 'IXSCAN', indexName: 'runId_1', keyPattern: { runId: 1 } },
  }, { totalDocsExamined: 101 }), contract), /too many documents/);
  assert.throws(() => assertEfficientQueryPlan(makeExplain({
    stage: 'IXSCAN', indexName: 'runId_1', keyPattern: { runId: 1 },
  }, { totalKeysExamined: 101 }), contract), /too many index keys/);
  assert.doesNotThrow(() => assertEfficientQueryPlan(makeExplain({
    stage: 'OR', inputStages: [
      compoundIndex.inputStage,
      { stage: 'IXSCAN', indexName: 'threadId_1_checkpointId_1', keyPattern: { threadId: 1, checkpointId: 1 } },
    ],
  }), contract), 'multiple compatible index scans remain valid when their aggregate scan stays bounded');
  assert.throws(() => assertEfficientQueryPlan(makeExplain({
    stage: 'OR', inputStages: [
      compoundIndex.inputStage,
      { stage: 'IXSCAN', indexName: 'userId_1', keyPattern: { userId: 1 } },
    ],
  }), contract), /unsuitable index/);
  assert.throws(() => assertEfficientQueryPlan(makeExplain({
    stage: 'FETCH', inputStage: { stage: 'COLLSCAN' },
  }), contract), /COLLSCAN/);
  assert.throws(() => assertEfficientQueryPlan(makeExplain({
    stage: 'FETCH', inputStage: { stage: 'IXSCAN', indexName: 'runId_1', keyPattern: { runId: 1 } },
    extraStage: { stage: 'COLLSCAN' },
  }), contract), /COLLSCAN/);
  assert.throws(() => assertEfficientQueryPlan(makeExplain({ stage: 'EOF' }), contract), /must use IXSCAN/);
});

test('Mongo checkpoint insert rolls back when the AgentRun progress CAS fails afterward', async () => {
  await setupRuntimeMongo();
  const userId = new mongoose.Types.ObjectId();
  const profileId = new mongoose.Types.ObjectId();
  const runId = `phase5-checkpoint-cas-rollback-${crypto.randomUUID()}`;
  try {
    const run = await createRunningRun({ userId, profileId, runId });
    const model = {
      findOne: (...args) => AgentRun.findOne(...args),
      async updateOne() { return { modifiedCount: 0 }; },
    };
    const worker = createPlanReviewWorker({
      model,
      checkpointModel: AgentCheckpoint,
      graphCheckpointModel: AgentGraphCheckpoint,
      mongo: mongoose,
      worker: run.workerId,
    });

    await assert.rejects(
      worker.updateProgress(run, { node: 'load_context', state: {}, event: { type: 'NODE_ENTERED' } }),
      error => error.code === 'AGENT_LEASE_LOST',
    );

    const durable = await AgentRun.findOne({ runId, userId }).lean();
    assert.equal(durable.checkpointSequence, 0);
    assert.equal(await AgentCheckpoint.countDocuments({ runId, userId }), 0,
      'the checkpoint inserted earlier in the transaction must roll back with the failed AgentRun CAS');
  } finally {
    await Promise.all([
      AgentRun.deleteMany({ runId, userId }),
      AgentCheckpoint.deleteMany({ runId, userId }),
      AgentGraphCheckpoint.deleteMany({ runId, userId }),
    ]);
    await teardownTestDatabase();
  }
});

test('Mongo optional progress-event failure is best effort and rolls back only its event-sequence update', async () => {
  await setupRuntimeMongo();
  const userId = new mongoose.Types.ObjectId();
  const profileId = new mongoose.Types.ObjectId();
  const runId = `phase5-progress-event-failure-${crypto.randomUUID()}`;
  try {
    const run = await createRunningRun({ userId, profileId, runId });
    const worker = createPlanReviewWorker({
      model: AgentRun,
      checkpointModel: AgentCheckpoint,
      graphCheckpointModel: AgentGraphCheckpoint,
      eventModel: {
        async create() { throw Object.assign(new Error('injected progress event store failure'), { code: 'EVENT_STORE_UNAVAILABLE' }); },
      },
      mongo: mongoose,
      worker: run.workerId,
    });

    await assert.doesNotReject(worker.appendEvent(run, 0, { type: 'NODE_ENTERED' }));

    const durable = await AgentRun.findOne({ runId, userId }).lean();
    assert.equal(durable.eventSequence, 0, 'failed append cannot durably consume an event sequence');
    assert.equal(await AgentRunEvent.countDocuments({ runId, userId }), 0);
  } finally {
    await Promise.all([
      AgentRun.deleteMany({ runId, userId }),
      AgentRunEvent.deleteMany({ runId, userId }),
      AgentCheckpoint.deleteMany({ runId, userId }),
      AgentGraphCheckpoint.deleteMany({ runId, userId }),
    ]);
    await teardownTestDatabase();
  }
});

test('Mongo transaction admission race admits exactly one of 100 PlanReviews at per-user capacity one', async () => {
  await setupRuntimeMongo();
  const userId = new mongoose.Types.ObjectId();
  try {
    const requests = Array.from({ length: 100 }, async (_, index) => {
      const profileId = new mongoose.Types.ObjectId();
      const sourceBinding = buildPlanReviewSnapshotBinding({
        userId,
        profileId,
        currentState: { profileVersion: index + 1 },
        freshness: { fresh: false, reasonCodes: ['RECOMMENDATION_MISSING'] },
      });
      const planReviewSnapshotHash = hashPlanReviewSnapshot(sourceBinding);
      return enqueuePlanReviewRun({
        userId,
        profileId,
        model: AgentRun,
        admissionModel: AgentQueueAdmission,
        mongo: mongoose,
        snapshotResolver: async () => ({ sourceBinding, planReviewSnapshotHash }),
        runtimeConfig: { agentPlanReview: { maxQueuedRunsPerUser: 100, maxActiveRunsPerUser: 1, maxGlobalQueuedRuns: 100 } },
      });
    });
    const results = await Promise.allSettled(requests);
    const accepted = results.filter(result => result.status === 'fulfilled');
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].value.created, true);
    assert.equal(results.filter(result => result.status === 'rejected').length, 99);
    for (const result of results.filter(item => item.status === 'rejected')) {
      assert.equal(result.reason.code, 'AGENT_QUEUE_SATURATED');
    }
    assert.equal(await AgentRun.countDocuments({ userId, status: { $in: ['QUEUED', 'RUNNING', 'WAITING_FOR_APPROVAL'] } }), 1);
  } finally {
    await AgentRun.deleteMany({ userId });
    await teardownTestDatabase();
  }
});

test('Mongo admission capacity is isolated per user under concurrent queue pressure', async () => {
  await setupRuntimeMongo();
  const userIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  const runIds = [];
  try {
    const attempts = userIds.flatMap(userId => Array.from({ length: 20 }, () => {
      const profileId = new mongoose.Types.ObjectId();
      return enqueueFixture({
        userId,
        profileId,
        limits: { maxQueuedRunsPerUser: 20, maxActiveRunsPerUser: 1, maxGlobalQueuedRuns: 2 },
      });
    }));
    const results = await Promise.allSettled(attempts);
    const accepted = results.filter(result => result.status === 'fulfilled');
    assert.equal(accepted.length, 2);
    assert.equal(accepted.filter(result => result.value.created).length, 2);
    assert.equal(results.filter(result => result.status === 'rejected').length, 38);
    for (const rejected of results.filter(result => result.status === 'rejected')) {
      assert.equal(rejected.reason.code, 'AGENT_QUEUE_SATURATED');
    }
    for (const userId of userIds) {
      const activeForUser = await AgentRun.countDocuments({
        userId,
        status: { $in: ['QUEUED', 'RUNNING', 'WAITING_FOR_APPROVAL'] },
      });
      assert.equal(activeForUser, 1);
    }
    runIds.push(...accepted.map(result => result.value.run.runId));
  } finally {
    await AgentRun.deleteMany({ runId: { $in: runIds } });
    await teardownTestDatabase();
  }
});

test('Mongo admission transaction enforces the global queue limit across users', async () => {
  await setupRuntimeMongo();
  const userIds = Array.from({ length: 4 }, () => new mongoose.Types.ObjectId());
  const runIds = [];
  try {
    const attempts = userIds.flatMap(userId => Array.from({ length: 5 }, () => enqueueFixture({
      userId,
      profileId: new mongoose.Types.ObjectId(),
      limits: { maxQueuedRunsPerUser: 5, maxActiveRunsPerUser: 5, maxGlobalQueuedRuns: 2 },
    })));
    const results = await Promise.allSettled(attempts);
    const accepted = results.filter(result => result.status === 'fulfilled');
    assert.equal(accepted.length, 2);
    assert.equal(accepted.filter(result => result.value.created).length, 2);
    assert.equal(results.filter(result => result.status === 'rejected').length, 18);
    assert.ok(results.filter(result => result.status === 'rejected')
      .every(result => result.reason.code === 'AGENT_QUEUE_SATURATED'));
    assert.equal(await AgentRun.countDocuments({ agentType: 'PLAN_REVIEW', status: 'QUEUED' }), 2);
    runIds.push(...accepted.map(result => result.value.run.runId));
  } finally {
    await AgentRun.deleteMany({ runId: { $in: runIds } });
    await teardownTestDatabase();
  }
});

test('Mongo admission rolls back its durable epoch and inserted run when run insertion fails', async () => {
  await setupRuntimeMongo();
  const userId = new mongoose.Types.ObjectId();
  const profileId = new mongoose.Types.ObjectId();
  const runId = `phase5-insert-rollback-${crypto.randomUUID()}`;
  const snapshot = admissionSnapshot(userId, profileId);
  const failingModel = {
    updateMany: AgentRun.updateMany.bind(AgentRun),
    findOne: AgentRun.findOne.bind(AgentRun),
    countDocuments: AgentRun.countDocuments.bind(AgentRun),
    async create(documents, options) {
      await AgentRun.create(documents.map(document => ({ ...document, runId })), options);
      throw Object.assign(new Error('simulated write failure after insert'), { code: 'INJECTED_RUN_INSERT_FAILURE' });
    },
  };
  try {
    const before = await AgentQueueAdmission.findOne({ _id: 'plan-review' }).lean();
    await assert.rejects(enqueuePlanReviewRun({
      userId,
      profileId,
      model: failingModel,
      admissionModel: AgentQueueAdmission,
      mongo: mongoose,
      snapshotResolver: async () => snapshot,
      runtimeConfig: { agentPlanReview: { maxQueuedRunsPerUser: 10, maxActiveRunsPerUser: 2, maxGlobalQueuedRuns: 10 } },
    }), error => error.code === 'INJECTED_RUN_INSERT_FAILURE');
    const after = await AgentQueueAdmission.findOne({ _id: 'plan-review' }).lean();
    assert.equal(after.epoch, before.epoch, 'the admission-fence increment rolls back with the failed insert');
    assert.equal(await AgentRun.countDocuments({ runId, userId }), 0, 'the inserted run rolls back with its transaction');
  } finally {
    await AgentRun.deleteMany({ runId, userId });
    await teardownTestDatabase();
  }
});

test('Mongo duplicate admission races resolve to one logical run without capacity errors', async () => {
  await setupRuntimeMongo();
  const userId = new mongoose.Types.ObjectId();
  const profileId = new mongoose.Types.ObjectId();
  const snapshot = admissionSnapshot(userId, profileId);
  const runIds = [];
  try {
    const results = await Promise.all(Array.from({ length: 20 }, () => enqueueFixture({
      userId,
      profileId,
      snapshot,
      limits: { maxQueuedRunsPerUser: 1, maxActiveRunsPerUser: 1, maxGlobalQueuedRuns: 10 },
    })));
    assert.equal(results.filter(result => result.created).length, 1);
    assert.equal(new Set(results.map(result => result.run.runId)).size, 1);
    runIds.push(results[0].run.runId);
    assert.equal(await AgentRun.countDocuments({ runId: results[0].run.runId, userId }), 1);
  } finally {
    await AgentRun.deleteMany({ runId: { $in: runIds } });
    await teardownTestDatabase();
  }
});

test('Mongo terminal failure releases admission capacity for a later run', async () => {
  await setupRuntimeMongo();
  const userId = new mongoose.Types.ObjectId();
  const profileId = new mongoose.Types.ObjectId();
  const runIds = [];
  try {
    const initial = await enqueueFixture({ userId, profileId });
    runIds.push(initial.run.runId);
    const claimed = await claimNextPlanReviewRun({ model: AgentRun, worker: 'phase5-terminal-worker' });
    assert.equal(claimed.runId, initial.run.runId);
    const worker = createPlanReviewWorker({
      model: AgentRun,
      checkpointModel: AgentCheckpoint,
      graphCheckpointModel: AgentGraphCheckpoint,
      eventModel: AgentRunEvent,
      mongo: mongoose,
      worker: 'phase5-terminal-worker',
      runtimeConfig: { agentPlanReview: { leaseMs: 60000, heartbeatMs: 60000 } },
    });
    const terminal = await worker.failRun(claimed, Object.assign(new Error('deterministic test failure'), {
      code: 'PLAN_REVIEW_SOURCE_BINDING_INVALID',
    }));
    assert.equal(terminal.status, 'FAILED');
    const persisted = await AgentRun.findOne({ runId: initial.run.runId, userId }).lean();
    assert.equal(persisted.status, 'FAILED');
    assert.equal(Object.hasOwn(persisted, 'activeDedupeKey'), false);

    const retried = await enqueueFixture({ userId, profileId, snapshot: admissionSnapshot(userId, profileId, 2) });
    assert.equal(retried.created, true);
    assert.notEqual(retried.run.runId, initial.run.runId);
    runIds.push(retried.run.runId);
  } finally {
    await AgentRun.deleteMany({ runId: { $in: runIds } });
    await AgentRunEvent.deleteMany({ runId: { $in: runIds } });
    await teardownTestDatabase();
  }
});

test('Mongo unique PlanHealth fingerprint deduplicates concurrent inspections', async () => {
  await setupRuntimeMongo();
  const userId = new mongoose.Types.ObjectId();
  const profileId = new mongoose.Types.ObjectId();
  const profile = {
    _id: profileId,
    userId,
    version: 1,
    monthlyTakeHome: 120000,
    monthlySavings: 30000,
    age: 35,
    riskTolerance: 'Moderate',
    hasLumpSum: false,
    lumpSumAmount: 0,
    investmentGoals: ['Wealth Growth'],
    investmentHorizonYears: 10,
  };
  await FinancialProfileState.create({
    userId, currentProfileId: profileId, revision: 1, promotionFence: 0, resolutionStatus: 'CURRENT',
  });
  const profileModel = { findOne: () => ({ lean: async () => profile }) };
  const recommendationModel = {
    findOne() {
      const query = { sort() { return query; }, lean: async () => null };
      return query;
    },
  };
  const fingerprint = planHealthEventFingerprint({
    userId, profileId, profileStateRevision: 1, recommendationId: null, reason: 'RECOMMENDATION_MISSING',
  });
  try {
    const results = await Promise.all(Array.from({ length: 12 }, () => inspectPlanHealth({
      userId,
      profileId,
      profileModel,
      profileStateModel: FinancialProfileState,
      eventModel: PlanHealthEvent,
      dependencies: { profileModel, recommendationModel, auditModel: null },
    })));
    assert.ok(results.every(result => result.status === 'ATTENTION'));
    assert.equal(new Set(results.map(result => String(result.event._id))).size, 1);
    assert.equal(await PlanHealthEvent.countDocuments({ fingerprint }), 1);
    const indexes = await PlanHealthEvent.collection.indexes();
    const activeFingerprintIndex = indexes.find(index => index.name === 'uniq_active_plan_health_fingerprint');
    assert.equal(activeFingerprintIndex?.unique, true);
    assert.deepEqual(activeFingerprintIndex?.partialFilterExpression, {
      status: { $in: ['UNREAD', 'READ', 'OPEN', 'ACKNOWLEDGED'] },
    });
  } finally {
    await PlanHealthEvent.deleteMany({ fingerprint });
    await FinancialProfileState.deleteMany({ userId });
    await teardownTestDatabase();
  }
});

test('Mongo Phase 5 migration preserves legacy duplicates and creates one active fingerprint identity', async () => {
  await setupRuntimeMongo();
  const userId = new mongoose.Types.ObjectId();
  const profileId = new mongoose.Types.ObjectId();
  const acknowledgedAt = new Date('2026-09-10T10:00:00.000Z');
  const eventIds = Array.from({ length: 10 }, () => new mongoose.Types.ObjectId());
  try {
    await PlanHealthEvent.collection.dropIndex('uniq_active_plan_health_fingerprint');
    await PlanHealthEvent.collection.insertMany(eventIds.map((eventId, index) => ({
      _id: eventId,
      userId,
      profileId,
      recommendationId: null,
      reason: 'RECOMMENDATION_MISSING',
      severity: 'BLOCKED',
      recommendation: 'A current authoritative recommendation is not available.',
      detectedAt: new Date(`2026-09-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`),
      status: index === 0 ? 'ACKNOWLEDGED' : 'UNREAD',
      fingerprint: `legacy-${index}`,
      monitorVersion: 'plan-health-monitor-1.0.0',
      acknowledgedAt: index === 0 ? acknowledgedAt : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })));

    await migratePlanHealthPersistence();

    const persisted = await PlanHealthEvent.find({ userId, profileId }).sort({ _id: 1 }).lean();
    assert.equal(persisted.length, 10, 'no legacy history row is deleted');
    assert.equal(persisted.filter(event => ['UNREAD', 'READ', 'OPEN', 'ACKNOWLEDGED'].includes(event.status)).length, 1);
    const acknowledged = persisted.find(event => String(event._id) === String(eventIds[0]));
    assert.equal(acknowledged.status, 'ACKNOWLEDGED');
    assert.equal(acknowledged.acknowledgedAt.getTime(), acknowledgedAt.getTime());
    assert.equal(persisted.filter(event => event.status === 'SUPERSEDED').length, 9);
    assert.equal(new Set(persisted.map(event => event.fingerprint)).size, 1);
    const activeIndex = (await PlanHealthEvent.collection.indexes())
      .find(index => index.name === 'uniq_active_plan_health_fingerprint');
    assert.equal(activeIndex?.unique, true);
    assert.deepEqual(activeIndex?.partialFilterExpression, {
      status: { $in: ['UNREAD', 'READ', 'OPEN', 'ACKNOWLEDGED'] },
    });

    await migratePlanHealthPersistence();
    assert.equal(await PlanHealthEvent.countDocuments({ userId, profileId }), 10, 'repeat migration is non-destructive');
  } finally {
    await PlanHealthEvent.deleteMany({ userId, profileId });
    await teardownTestDatabase();
  }
});

test('Mongo scheduler lease has one owner, supports expired takeover, and fences the stale owner', async () => {
  await setupRuntimeMongo();
  const periodKey = `phase5-${crypto.randomUUID()}`;
  const nowValue = new Date();
  try {
    const initial = await Promise.all(['owner-a', 'owner-b'].map(owner => claimPlanHealthSchedulerLease({
      model: PlanHealthSchedulerLease, periodKey, owner, leaseMs: 60000, nowValue,
    })));
    assert.equal(initial.filter(Boolean).length, 1);
    const firstOwner = initial.find(Boolean);
    assert.equal(firstOwner.executionGeneration, 1);
    const originalLeaseUntil = firstOwner.leaseUntil;

    const renewedAt = new Date();
    const heartbeat = await PlanHealthSchedulerLease.updateOne({
      _id: periodKey,
      owner: firstOwner.owner,
      executionGeneration: firstOwner.executionGeneration,
      status: 'RUNNING',
      leaseUntil: { $gt: renewedAt },
    }, {
      $set: {
        lastHeartbeatAt: renewedAt,
        leaseUntil: new Date(renewedAt.getTime() + 120000),
      },
    });
    assert.equal(heartbeat.modifiedCount, 1);
    const renewedLease = await PlanHealthSchedulerLease.findOne({ _id: periodKey }).lean();
    assert.ok(renewedLease.leaseUntil > originalLeaseUntil);
    const claimAtOriginalExpiry = await claimPlanHealthSchedulerLease({
      model: PlanHealthSchedulerLease,
      periodKey,
      owner: 'owner-before-renewed-expiry',
      leaseMs: 60000,
      nowValue: new Date(originalLeaseUntil.getTime() + 1),
    });
    assert.equal(claimAtOriginalExpiry, null, 'a heartbeat renewal prevents an early takeover');

    await PlanHealthSchedulerLease.updateOne({ _id: periodKey, owner: firstOwner.owner, executionGeneration: 1 }, {
      $set: { leaseUntil: new Date(Date.now() - 1) },
    });
    const takeoverAt = new Date();
    const takeovers = await Promise.all(['owner-c', 'owner-d'].map(owner => claimPlanHealthSchedulerLease({
      model: PlanHealthSchedulerLease, periodKey, owner, leaseMs: 60000, nowValue: takeoverAt,
    })));
    assert.equal(takeovers.filter(Boolean).length, 1);
    const successor = takeovers.find(Boolean);
    assert.equal(successor.executionGeneration, 2);
    const staleHeartbeat = await PlanHealthSchedulerLease.updateOne({
      _id: periodKey,
      owner: firstOwner.owner,
      executionGeneration: firstOwner.executionGeneration,
      status: 'RUNNING',
    }, { $set: { lastHeartbeatAt: new Date() } });
    assert.equal(staleHeartbeat.modifiedCount, 0);
    assert.equal(await PlanHealthSchedulerLease.countDocuments({ _id: periodKey }), 1);
  } finally {
    await PlanHealthSchedulerLease.deleteOne({ _id: periodKey });
    await teardownTestDatabase();
  }
});

test('Mongo PlanHealth scheduler resumes strictly after the last durably completed batch cursor', async () => {
  await setupRuntimeMongo();
  const ids = [1, 2, 3, 4].map(value => new mongoose.Types.ObjectId(`00000000000000000000000${value}`));
  const stateUserIds = ids.map((_, index) => new mongoose.Types.ObjectId((0x11 + index).toString(16).padStart(24, '0')));
  const profileModel = {
    find(filter = {}) {
      const wanted = new Set((filter._id?.$in || []).map(String));
      const rows = ids.map((_id, index) => ({ _id, userId: stateUserIds[index] }))
        .filter(profile => wanted.has(String(profile._id)));
      return { lean: async () => rows };
    },
  };
  const firstPeriod = `phase5-cursor-${crypto.randomUUID()}`;
  const inspectedByA = [];
  const inspectedByB = [];
  const interruption = Object.assign(new Error('simulated process loss after durable cursor advance'), { code: 'TEST_PROCESS_LOSS' });
  const stopA = new AbortController();
  try {
    await FinancialProfileState.insertMany(ids.map((currentProfileId, index) => ({
      userId: stateUserIds[index],
      currentProfileId,
      revision: 1,
      promotionFence: 0,
      resolutionStatus: 'CURRENT',
    })));
    await assert.rejects(runPlanHealthScan({
      profileModel,
      profileStateModel: scopeProfileStateReads(FinancialProfileState, stateUserIds),
      leaseModel: PlanHealthSchedulerLease,
      publicationFenceModel: PlanHealthInspectionFence,
      periodKey: firstPeriod,
      owner: 'cursor-owner-a',
      batchSize: 2,
      concurrency: 1,
      signal: stopA.signal,
      inspect: async ({ profileId }) => {
        inspectedByA.push(String(profileId));
        if (String(profileId) === String(ids[2])) stopA.abort(interruption);
        return { status: 'HEALTHY' };
      },
    }), error => error.code === 'TEST_PROCESS_LOSS');

    const interruptedLease = await PlanHealthSchedulerLease.findOne({ _id: firstPeriod }).lean();
    assert.equal(String(interruptedLease.profileStateCursor), String(stateUserIds[1]));
    assert.equal(interruptedLease.status, 'FAILED');

    const resumed = await runPlanHealthScan({
      profileModel,
      profileStateModel: scopeProfileStateReads(FinancialProfileState, stateUserIds),
      leaseModel: PlanHealthSchedulerLease,
      publicationFenceModel: PlanHealthInspectionFence,
      periodKey: firstPeriod,
      owner: 'cursor-owner-b',
      batchSize: 2,
      concurrency: 1,
      inspect: async ({ profileId }) => {
        inspectedByB.push(String(profileId));
        return { status: 'HEALTHY' };
      },
    });
    assert.equal(resumed.scanned, 2);
    assert.deepEqual(inspectedByA.slice(0, 2), ids.slice(0, 2).map(String));
    assert.ok(inspectedByA.includes(String(ids[2])));
    assert.deepEqual(inspectedByB, ids.slice(2).map(String));
    const completedLease = await PlanHealthSchedulerLease.findOne({ _id: firstPeriod }).lean();
    assert.equal(completedLease.status, 'COMPLETED');
    assert.equal(String(completedLease.profileStateCursor), String(stateUserIds[3]));
  } finally {
    await FinancialProfileState.deleteMany({ userId: { $in: stateUserIds } });
    await PlanHealthInspectionFence.deleteMany({ periodKey: firstPeriod });
    await PlanHealthSchedulerLease.deleteOne({ _id: firstPeriod });
    await teardownTestDatabase();
  }
});

test('Mongo worker takeover fences every stale-generation write including best-effort progress events', async () => {
  await setupRuntimeMongo();
  const userId = new mongoose.Types.ObjectId();
  const profileId = new mongoose.Types.ObjectId();
  const runId = `phase5-takeover-${crypto.randomUUID()}`;
  const sourceBinding = buildPlanReviewSnapshotBinding({
    userId,
    profileId,
    currentState: { profileVersion: 1 },
    freshness: { fresh: false, reasonCodes: ['RECOMMENDATION_MISSING'] },
  });
  const planReviewSnapshotHash = hashPlanReviewSnapshot(sourceBinding);
  const startedAt = new Date();
  try {
    await AgentRun.create({
      runId,
      agentType: 'PLAN_REVIEW',
      userId,
      profileId,
      status: 'QUEUED',
      priority: 'INTERACTIVE_PLAN_REVIEW',
      priorityRank: 0,
      sourceBinding,
      planReviewSnapshotHash,
      attempt: 0,
      executionGeneration: 0,
      maxAttempts: 2,
      eventSequence: 0,
    });

    const generationA = await claimNextPlanReviewRun({
      model: AgentRun, worker: 'phase5-worker-a', leaseMs: 60000, nowValue: startedAt,
    });
    assert.equal(generationA.executionGeneration, 1);
    const takeoverAt = new Date(startedAt.getTime() + 2);
    await AgentRun.updateOne({
      runId, userId, workerId: generationA.workerId, executionGeneration: 1,
    }, { $set: { leaseUntil: new Date(takeoverAt.getTime() - 1) } });

    const generationB = await claimNextPlanReviewRun({
      model: AgentRun, worker: 'phase5-worker-b', leaseMs: 60000, nowValue: takeoverAt,
    });
    assert.equal(generationB.runId, runId);
    assert.equal(generationB.executionGeneration, 2);
    assert.equal(generationB.workerId, 'phase5-worker-b');

    const workerA = createPlanReviewWorker({
      model: AgentRun,
      checkpointModel: AgentCheckpoint,
      graphCheckpointModel: AgentGraphCheckpoint,
      eventModel: AgentRunEvent,
      mongo: mongoose,
      worker: 'phase5-worker-a',
      runtimeConfig: { agentPlanReview: { leaseMs: 60000, heartbeatMs: 60000 } },
    });
    await assert.rejects(
      workerA.updateProgress(generationA, { node: 'load_context', state: {}, event: { type: 'NODE_ENTERED' } }),
      error => error.code === 'AGENT_LEASE_LOST',
    );
    await assert.rejects(
      workerA.persistModelBudgetReservation(generationA, { modelCallCount: 1, tokenUsage: 32 }),
      error => error.code === 'AGENT_LEASE_LOST',
    );
    await assert.rejects(
      workerA.finishRun(generationA, { recommendedAction: 'NONE', execution: {} }),
      error => error.code === 'AGENT_LEASE_LOST',
    );
    await assert.rejects(
      workerA.failRun(generationA, new Error('late provider result')),
      error => error.code === 'AGENT_LEASE_LOST',
    );
    await workerA.appendEvent(generationA, 1, { type: 'NODE_ENTERED' }, 'load_context');

    const persisted = await AgentRun.findOne({ runId, userId }).lean();
    assert.equal(persisted.status, 'RUNNING');
    assert.equal(persisted.workerId, 'phase5-worker-b');
    assert.equal(persisted.executionGeneration, 2);
    assert.equal(persisted.eventSequence, 0);
    assert.equal(await AgentRunEvent.countDocuments({ runId, userId }), 0);
    assert.equal(await AgentCheckpoint.countDocuments({ runId, userId }), 0);

    const workerB = createPlanReviewWorker({
      model: AgentRun,
      checkpointModel: AgentCheckpoint,
      graphCheckpointModel: AgentGraphCheckpoint,
      eventModel: AgentRunEvent,
      mongo: mongoose,
      worker: 'phase5-worker-b',
      runtimeConfig: { agentPlanReview: { leaseMs: 60000, heartbeatMs: 60000 } },
    });
    assert.equal(await workerB.assertLease(generationB).then(() => true), true, 'successor lease remains authoritative');
    await Promise.all(Array.from({ length: 8 }, (_, index) => workerB.appendEvent(
      generationB,
      index + 1,
      { type: 'NODE_ENTERED', at: new Date().toISOString() },
      `node-${index}`,
    )));
    const successorEvents = await AgentRunEvent.find({ runId, userId }).sort({ sequence: 1 }).lean();
    assert.deepEqual(successorEvents.map(event => event.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.ok(successorEvents.every(event => event.executionGeneration === 2));
    const afterSuccessorEvents = await AgentRun.findOne({ runId, userId }).lean();
    assert.equal(afterSuccessorEvents.eventSequence, 8);
    assert.equal(afterSuccessorEvents.executionGeneration, 2);
  } finally {
    await Promise.all([
      AgentRun.collection.deleteMany({ runId, userId }),
      AgentRunEvent.collection.deleteMany({ runId, userId }),
      AgentCheckpoint.collection.deleteMany({ runId, userId }),
      AgentGraphCheckpoint.collection.deleteMany({ runId, userId }),
    ]);
    await teardownTestDatabase();
  }
});

test('Mongo timeout durably invalidates an inspection blocked before publication; a fresh generation can publish', async () => {
  await setupRuntimeMongo();
  const userId = new mongoose.Types.ObjectId();
  const profileId = new mongoose.Types.ObjectId();
  const profile = {
    _id: profileId,
    userId,
    version: 1,
    monthlyTakeHome: 120000,
    monthlySavings: 30000,
    age: 35,
    riskTolerance: 'Moderate',
    hasLumpSum: false,
    lumpSumAmount: 0,
    investmentGoals: ['Wealth Growth'],
    investmentHorizonYears: 10,
  };
  await FinancialProfileState.create({
    userId, currentProfileId: profileId, revision: 1, promotionFence: 0, resolutionStatus: 'CURRENT',
  });
  const profileModel = {
    find(filter = {}) {
      const rows = filter._id?.$gt && String(profileId) <= String(filter._id.$gt) ? [] : [profile];
      const query = { sort() { return query; }, limit() { return query; }, lean: async () => rows };
      return query;
    },
    findOne: () => ({ lean: async () => profile }),
  };
  const recommendationModel = {
    findOne() {
      const query = { sort() { return query; }, lean: async () => null };
      return query;
    },
  };
  const publicationFenceModel = {
    create: (...args) => PlanHealthInspectionFence.create(...args),
    findOne: (...args) => PlanHealthInspectionFence.findOne(...args),
    async updateOne(filter, update, options) {
      const result = await PlanHealthInspectionFence.updateOne(filter, update, options);
      if (update.$set?.status === 'TIMED_OUT' && result.modifiedCount === 1) timeoutPersisted();
      return result;
    },
  };
  let timeoutCallback;
  let announcePublication;
  let releasePublication;
  let signalTimeoutPersisted;
  const atPublication = new Promise(resolve => { announcePublication = resolve; });
  const publicationBarrier = new Promise(resolve => { releasePublication = resolve; });
  const timedOut = new Promise(resolve => { signalTimeoutPersisted = resolve; });
  const timeoutPersisted = () => signalTimeoutPersisted();
  let blockPublication = true;
  const freshPeriod = `phase5-fresh-${crypto.randomUUID()}`;
  const inspect = options => inspectPlanHealth({
    ...options,
    profileModel,
    eventModel: PlanHealthEvent,
    publicationFenceModel,
    mongo: mongoose,
    dependencies: {
      profileModel,
      recommendationModel,
      auditModel: null,
      beforePublication: async () => {
        if (!blockPublication) return;
        announcePublication();
        await publicationBarrier;
      },
    },
  });
  const firstPeriod = `phase5-timeout-${crypto.randomUUID()}`;
  try {
    const timedOutScan = runPlanHealthScan({
      profileModel,
      profileStateModel: scopeProfileStateReads(FinancialProfileState, [userId]),
      leaseModel: PlanHealthSchedulerLease,
      publicationFenceModel,
      inspect,
      owner: 'timeout-owner',
      periodKey: firstPeriod,
      batchSize: 1,
      concurrency: 1,
      profileTimeoutMs: 60000,
      setTimeoutImpl(callback) { timeoutCallback = callback; return { unref() {} }; },
      clearTimeoutImpl() {},
    });

    await atPublication;
    timeoutCallback();
    await timedOut;
    const timedOutFence = await PlanHealthInspectionFence.findOne({ periodKey: firstPeriod }).lean();
    assert.equal(timedOutFence.status, 'TIMED_OUT');
    releasePublication();

    const timeoutResult = await timedOutScan;
    assert.equal(timeoutResult.failures, 1);
    assert.equal(await PlanHealthEvent.countDocuments({ userId, profileId }), 0, 'late transaction cannot create or alter an event');

    blockPublication = false;
    const fresh = await runPlanHealthScan({
      profileModel,
      profileStateModel: scopeProfileStateReads(FinancialProfileState, [userId]),
      leaseModel: PlanHealthSchedulerLease,
      publicationFenceModel,
      inspect,
      owner: 'fresh-owner',
      periodKey: freshPeriod,
      batchSize: 1,
      concurrency: 1,
    });
    assert.equal(fresh.failures, 0);
    assert.equal(fresh.events, 1);
    assert.equal(await PlanHealthEvent.countDocuments({ userId, profileId, status: 'UNREAD' }), 1);
  } finally {
    releasePublication();
    await PlanHealthEvent.deleteMany({ userId, profileId });
    await FinancialProfileState.deleteMany({ userId });
    await PlanHealthInspectionFence.deleteMany({ periodKey: { $in: [firstPeriod, freshPeriod] } });
    await PlanHealthSchedulerLease.deleteMany({ _id: { $in: [firstPeriod, freshPeriod] } });
    await teardownTestDatabase();
  }
});

test('Mongo user-profile promotion fences a late PlanHealth publication for the superseded profile', async () => {
  await setupRuntimeMongo();
  const userId = new mongoose.Types.ObjectId();
  const profileId = new mongoose.Types.ObjectId();
  const replacementProfileId = new mongoose.Types.ObjectId();
  const profile = {
    _id: profileId,
    userId,
    version: 1,
    monthlyTakeHome: 120000,
    monthlySavings: 30000,
    age: 35,
    riskTolerance: 'Moderate',
    hasLumpSum: false,
    lumpSumAmount: 0,
    investmentGoals: ['Wealth Growth'],
    investmentHorizonYears: 10,
  };
  await FinancialProfileState.create({
    userId, currentProfileId: profileId, revision: 1, promotionFence: 0, resolutionStatus: 'CURRENT',
  });
  const profileModel = { findOne: () => ({ lean: async () => profile }) };
  const recommendationModel = {
    findOne() {
      const query = { sort() { return query; }, lean: async () => null };
      return query;
    },
  };
  let promotedBetweenInspectionAndPublish = false;
  const profileStateModel = {
    findOne: (...args) => FinancialProfileState.findOne(...args),
    async updateOne(filter, update, options) {
      if (!promotedBetweenInspectionAndPublish && filter.currentProfileId
          && String(filter.currentProfileId) === String(profileId)) {
        promotedBetweenInspectionAndPublish = true;
        const promoted = await FinancialProfileState.updateOne({
          userId, currentProfileId: profileId, revision: 1, resolutionStatus: 'CURRENT',
        }, {
          $set: { currentProfileId: replacementProfileId, revision: 2 },
          $inc: { promotionFence: 1 },
        });
        assert.equal(promoted.modifiedCount, 1);
      }
      return FinancialProfileState.updateOne(filter, update, options);
    },
  };
  try {
    const pendingInspection = inspectPlanHealth({
      userId,
      profileId,
      profileModel,
      profileStateModel,
      eventModel: PlanHealthEvent,
      mongo: mongoose,
      dependencies: {
        profileModel,
        recommendationModel,
        auditModel: null,
      },
    });
    await assert.rejects(pendingInspection, error => error.code === 'PLAN_HEALTH_PROFILE_SUPERSEDED');
    assert.equal(promotedBetweenInspectionAndPublish, true, 'the test switches the canonical profile at the publication CAS boundary');
    assert.equal(await PlanHealthEvent.countDocuments({ userId, profileId }), 0,
      'late inspection cannot publish active health against a historical profile');
    const state = await FinancialProfileState.findOne({ userId }).lean();
    assert.equal(String(state.currentProfileId), String(replacementProfileId));
    assert.equal(state.revision, 2);
  } finally {
    await Promise.all([
      PlanHealthEvent.deleteMany({ userId, profileId }),
      FinancialProfileState.deleteMany({ userId }),
    ]);
    await teardownTestDatabase();
  }
});

test('Mongo periodic recovery atomically dead-letters exhausted runs, writes one event, and bounds checkpoint retention', async () => {
  await setupRuntimeMongo();
  const userId = new mongoose.Types.ObjectId();
  const profileId = new mongoose.Types.ObjectId();
  const runId = `phase5-expired-${crypto.randomUUID()}`;
  const workerId = 'phase5-expired-worker';
  const executionGeneration = 2;
  const nowValue = new Date();
  const threadId = `${runId}:${executionGeneration}`;
  try {
    await AgentRun.create({
      runId,
      agentType: 'PLAN_REVIEW',
      userId,
      profileId,
      status: 'RUNNING',
      priority: 'INTERACTIVE_PLAN_REVIEW',
      priorityRank: 0,
      planReviewSnapshotHash: 'a'.repeat(64),
      sourceBinding: { schemaVersion: 'phase5-mongo-recovery-test' },
      workerId,
      executionGeneration,
      attempt: 2,
      maxAttempts: 2,
      leaseUntil: new Date(nowValue.getTime() - 1000),
      eventSequence: 3,
      currentNode: 'synthesize_review',
      activeDedupeKey: `active-${runId}`,
      traceId: 'trace-phase5-safe',
      correlationId: 'correlation-phase5-safe',
    });
    await AgentCheckpoint.create({
      runId, userId, executionGeneration, workerId, sequence: 1, node: 'synthesize_review', state: { stepCount: 1 },
    });
    await AgentGraphCheckpoint.create({
      threadId,
      checkpointId: 'checkpoint-phase5-expired',
      parentCheckpointId: null,
      runId,
      userId,
      executionGeneration,
      workerId,
      checkpointType: 'json',
      checkpoint: '{}',
      metadataType: 'json',
      metadata: '{}',
      pendingWrites: [],
    });

    const recovered = await recoverExpiredPlanReviewRuns({ nowValue, mongo: mongoose });
    assert.equal(recovered, 1);
    const persisted = await AgentRun.findOne({ runId, userId }).lean();
    assert.equal(persisted.status, 'FAILED');
    assert.equal(persisted.completedAt instanceof Date, true);
    assert.equal(persisted.leaseUntil, null);
    assert.equal(persisted.failure.code, 'INTERNAL_RUNTIME_FAILURE');
    assert.equal(persisted.deadLetter.attempt, 2);
    assert.equal(persisted.deadLetter.executionGeneration, executionGeneration);
    assert.equal(persisted.deadLetter.lastNode, 'synthesize_review');
    assert.equal('activeDedupeKey' in persisted, false);
    const events = await AgentRunEvent.find({ runId, userId }).lean();
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, 'RUN_FAILED');
    assert.equal(events[0].sequence, 4);
    const retainedCheckpoint = await AgentCheckpoint.findOne({ runId, userId }).lean();
    const retainedGraph = await AgentGraphCheckpoint.findOne({ runId, userId }).lean();
    assert.ok(retainedCheckpoint.expiresAt > nowValue);
    assert.ok(retainedGraph.expiresAt > nowValue);
    assert.equal(await recoverExpiredPlanReviewRuns({ nowValue, mongo: mongoose }), 0, 'repeat recovery is idempotent');
    assert.equal(await AgentRunEvent.countDocuments({ runId, userId }), 1);
  } finally {
    await Promise.all([
      AgentRun.collection.deleteMany({ runId, userId }),
      AgentRunEvent.collection.deleteMany({ runId, userId }),
      AgentCheckpoint.collection.deleteMany({ runId, userId }),
      AgentGraphCheckpoint.collection.deleteMany({ runId, userId }),
    ]);
    await teardownTestDatabase();
  }
});

test('Mongo hot queue, scheduler, event, and checkpoint reads use their intended indexes', async () => {
  await setupRuntimeMongo();
  const targetUserId = new mongoose.Types.ObjectId();
  const targetRunId = 'query-plan-target-run';
  const targetThreadId = 'query-plan-target-thread';
  const targetProfileId = new mongoose.Types.ObjectId();
  const targetFingerprint = 'f'.repeat(64);
  const nowValue = new Date();
  try {
    await AgentRun.collection.insertMany(Array.from({ length: 1200 }, (_, index) => ({
      runId: `query-plan-run-${index}`,
      agentType: 'PLAN_REVIEW',
      userId: index < 20 ? targetUserId : new mongoose.Types.ObjectId(),
      profileId: new mongoose.Types.ObjectId(),
      status: index % 3 === 0 ? 'RUNNING' : 'QUEUED',
      priorityRank: index % 2 === 0 ? 0 : 100,
      queuedAt: new Date(nowValue.getTime() - index * 1000),
      planReviewSnapshotHash: 'a'.repeat(64),
      sourceBinding: { schemaVersion: 'query-plan-test' },
      executionGeneration: 0,
      attempt: 0,
      maxAttempts: 2,
    })));
    await PlanHealthSchedulerLease.collection.insertMany(Array.from({ length: 600 }, (_, index) => ({
      _id: `query-plan-lease-${index}`,
      periodKey: `period-${index}`,
      owner: 'query-plan-test',
      status: index % 3 === 0 ? 'RUNNING' : 'COMPLETED',
      leaseUntil: new Date(nowValue.getTime() + (index % 2 === 0 ? -60000 : 60000)),
      executionGeneration: 1,
    })));
    await PlanHealthEvent.collection.insertMany(Array.from({ length: 1200 }, (_, index) => ({
      userId: index < 20 ? targetUserId : new mongoose.Types.ObjectId(),
      profileId: index === 0 ? targetProfileId : new mongoose.Types.ObjectId(),
      recommendationId: null,
      reason: 'QUERY_PLAN_TEST',
      severity: 'INFO',
      recommendation: 'Synthetic index qualification row.',
      detectedAt: new Date(nowValue.getTime() - index * 1000),
      status: index % 4 === 0 ? 'UNREAD' : 'RESOLVED',
      fingerprint: index === 0 ? targetFingerprint : crypto.createHash('sha256').update(`fp-${index}`).digest('hex'),
      monitorVersion: 'query-plan-test',
    })));
    await AgentCheckpoint.collection.insertMany(Array.from({ length: 600 }, (_, index) => ({
      runId: index < 20 ? targetRunId : `checkpoint-run-${index}`,
      userId: index < 20 ? targetUserId : new mongoose.Types.ObjectId(),
      executionGeneration: index < 20 ? 2 : 1,
      workerId: 'query-plan-test',
      sequence: index < 20 ? index + 1 : 1,
      node: 'query_plan',
      state: { bounded: true },
      createdAt: new Date(nowValue.getTime() - index * 1000),
    })));
    await AgentGraphCheckpoint.collection.insertMany(Array.from({ length: 600 }, (_, index) => {
      const targetRunRow = index < 60;
      const targetUserRow = index < 120;
      const targetThreadRow = index < 12 || index === 59;
      return {
        threadId: targetThreadRow ? targetThreadId : `query-plan-thread-${index}`,
        // Place the exact target last in the run-scoped index so the runId-only
        // plan must examine the whole bounded run generation in this fixture.
        checkpointId: `checkpoint-${String(index === 59 ? 0 : index + 1).padStart(4, '0')}`,
        parentCheckpointId: null,
        runId: targetRunRow ? targetRunId : `graph-run-${index}`,
        userId: targetUserRow ? targetUserId : new mongoose.Types.ObjectId(),
        executionGeneration: targetThreadRow ? 2 : (index % 5) + 1,
        checkpointType: 'json',
        checkpoint: '{}',
        metadataType: 'json',
        metadata: '{}',
        pendingWrites: [],
        createdAt: new Date(nowValue.getTime() - index * 1000),
      };
    }));

    const generationRetrievalFilter = {
      runId: targetRunId,
      userId: targetUserId,
      executionGeneration: 2,
      threadId: targetThreadId,
      checkpointId: 'checkpoint-0000',
    };
    const exactGraphCheckpoint = await AgentGraphCheckpoint.findOne(generationRetrievalFilter).lean();
    assert.equal(exactGraphCheckpoint?.checkpointId, 'checkpoint-0000',
      'generation-scoped point retrieval must return the requested checkpoint');

    const listedGraphCheckpoints = await AgentGraphCheckpoint.find({
      runId: targetRunId,
      userId: targetUserId,
      executionGeneration: 2,
      threadId: targetThreadId,
    }).sort({ createdAt: -1 }).limit(20).lean();
    assert.equal(listedGraphCheckpoints.length, 13,
      'generation listing should return only the 13 checkpoints in the requested thread/generation');
    assert.ok(listedGraphCheckpoints.every(row => row.runId === targetRunId
      && String(row.userId) === String(targetUserId)
      && row.executionGeneration === 2
      && row.threadId === targetThreadId));
    assert.ok(listedGraphCheckpoints.every((row, index) => index === 0
      || listedGraphCheckpoints[index - 1].createdAt >= row.createdAt),
    'generation listing must retain descending createdAt ordering');

    const plans = [
      {
        label: 'AgentRun queue claim',
        query: AgentRun.find({ status: 'QUEUED' }).sort({ priorityRank: 1, queuedAt: 1 }).limit(10),
        allowedIndexPrefixes: [{ status: 1, priorityRank: 1, queuedAt: 1 }],
        expectedReturned: 10,
      },
      {
        label: 'PlanHealth scheduler lease',
        query: PlanHealthSchedulerLease.find({ status: 'RUNNING', leaseUntil: { $lte: nowValue } }).sort({ leaseUntil: 1 }).limit(10),
        allowedIndexPrefixes: [{ status: 1, leaseUntil: 1 }],
        expectedReturned: 10,
      },
      {
        label: 'PlanHealth active event identity',
        query: PlanHealthEvent.findOne({ fingerprint: targetFingerprint, status: { $in: ['UNREAD', 'READ', 'OPEN', 'ACKNOWLEDGED'] } }),
        // This named partial unique index is itself the active-event dedupe contract.
        allowedIndexNames: ['uniq_active_plan_health_fingerprint'],
        expectedReturned: 1,
      },
      {
        label: 'PlanHealth event history',
        query: PlanHealthEvent.find({ userId: targetUserId }).sort({ detectedAt: -1 }).limit(20),
        allowedIndexPrefixes: [{ userId: 1, detectedAt: -1 }],
        expectedReturned: 20,
      },
      {
        label: 'durable checkpoint retrieval',
        query: AgentCheckpoint.find({ runId: targetRunId, executionGeneration: 2 }).sort({ sequence: -1 }).limit(10),
        // Mongo may scan the ascending compound index backwards for sequence:-1.
        allowedIndexPrefixes: [{ runId: 1, executionGeneration: 1, sequence: 1 }],
        expectedReturned: 10,
      },
      {
        label: 'graph checkpoint generation retrieval',
        query: AgentGraphCheckpoint.findOne(generationRetrievalFilter),
        allowedIndexPrefixes: graphGenerationIndexPrefixes,
        expectedReturned: 1,
      },
      {
        label: 'graph checkpoint generation listing',
        query: AgentGraphCheckpoint.find({ runId: targetRunId, userId: targetUserId, executionGeneration: 2, threadId: targetThreadId }).sort({ createdAt: -1 }).limit(20),
        allowedIndexPrefixes: [{ threadId: 1, createdAt: -1 }],
        expectedReturned: 13,
      },
    ];

    for (const { query, ...contract } of plans) {
      const explain = await query.explain('executionStats');
      assertEfficientQueryPlan(explain, contract);
    }
  } finally {
    await teardownTestDatabase();
  }
});
