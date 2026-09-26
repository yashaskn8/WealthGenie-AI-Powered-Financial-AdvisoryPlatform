import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import test from 'node:test';
import AgentCheckpoint from '../models/AgentCheckpoint.js';
import AgentGraphCheckpoint from '../models/AgentGraphCheckpoint.js';
import AgentRun from '../models/AgentRun.js';
import AgentRunEvent from '../models/AgentRunEvent.js';
import PlanHealthEvent from '../models/PlanHealthEvent.js';
import PlanHealthSchedulerLease from '../models/PlanHealthSchedulerLease.js';
import { recoverExpiredPlanReviewRuns } from '../agents/planReview/planReviewWorkerCore.js';
import { claimPlanHealthSchedulerLease } from '../services/planHealthScheduler.js';
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

test('Mongo transaction admission race admits exactly one PlanReview at per-user capacity one', async () => {
  await setupRuntimeMongo();
  const userId = new mongoose.Types.ObjectId();
  try {
    const requests = Array.from({ length: 24 }, async (_, index) => {
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
        runtimeConfig: { agentPlanReview: { maxQueuedRunsPerUser: 24, maxActiveRunsPerUser: 1, maxGlobalQueuedRuns: 24 } },
      });
    });
    const results = await Promise.allSettled(requests);
    const accepted = results.filter(result => result.status === 'fulfilled');
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].value.created, true);
    assert.equal(results.filter(result => result.status === 'rejected').length, 23);
    for (const result of results.filter(item => item.status === 'rejected')) {
      assert.equal(result.reason.code, 'AGENT_QUEUE_SATURATED');
    }
    assert.equal(await AgentRun.countDocuments({ userId, status: { $in: ['QUEUED', 'RUNNING', 'WAITING_FOR_APPROVAL'] } }), 1);
  } finally {
    await AgentRun.deleteMany({ userId });
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
  const profileModel = { findOne: () => ({ lean: async () => profile }) };
  const recommendationModel = {
    findOne() {
      const query = { sort() { return query; }, lean: async () => null };
      return query;
    },
  };
  const fingerprint = planHealthEventFingerprint({ userId, profileId, recommendationId: null, reason: 'RECOMMENDATION_MISSING' });
  try {
    const results = await Promise.all(Array.from({ length: 12 }, () => inspectPlanHealth({
      userId,
      profileId,
      profileModel,
      eventModel: PlanHealthEvent,
      dependencies: { profileModel, recommendationModel, auditModel: null },
    })));
    assert.ok(results.every(result => result.status === 'ATTENTION'));
    assert.equal(new Set(results.map(result => String(result.event._id))).size, 1);
    assert.equal(await PlanHealthEvent.countDocuments({ fingerprint }), 1);
    const indexes = await PlanHealthEvent.collection.indexes();
    assert.ok(indexes.some(index => index.name === 'fingerprint_1' && index.unique === true));
  } finally {
    await PlanHealthEvent.deleteMany({ fingerprint });
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

    await PlanHealthSchedulerLease.updateOne({ _id: periodKey, owner: firstOwner.owner, executionGeneration: 1 }, {
      $set: { leaseUntil: new Date(nowValue.getTime() - 1) },
    });
    const takeoverAt = new Date(nowValue.getTime() + 1);
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
