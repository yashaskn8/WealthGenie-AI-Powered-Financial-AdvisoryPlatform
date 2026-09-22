import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimNextPlanReviewRun,
  createPlanReviewWorker,
  recoverExpiredPlanReviewRuns,
} from '../agents/planReview/planReviewWorker.js';
import { claimPlanHealthSchedulerLease, runPlanHealthScan } from '../services/planHealthScheduler.js';
import { inspectPlanHealth } from '../services/planHealthMonitor.js';

const userId = '64b000000000000000000010';

function lean(value) {
  return { lean: async () => value };
}

test('two worker instances race atomically and exactly one claims a queued run', async () => {
  let run = {
    runId: 'run-race',
    agentType: 'PLAN_REVIEW',
    userId,
    status: 'QUEUED',
    attempt: 0,
    executionGeneration: 0,
    maxAttempts: 2,
    queuedAt: new Date(0),
    priority: 'INTERACTIVE_PLAN_REVIEW',
  };
  const model = {
    async findOneAndUpdate() {
      if (run.status !== 'QUEUED') return null;
      run = { ...run, status: 'RUNNING', workerId: 'winner', attempt: 1, executionGeneration: 1 };
      return { ...run };
    },
  };
  const [first, second] = await Promise.all([
    claimNextPlanReviewRun({ model, worker: 'worker-a' }),
    claimNextPlanReviewRun({ model, worker: 'worker-b' }),
  ]);
  assert.equal(Boolean(first) + Boolean(second), 1);
});

test('fencing rejects a stale worker terminal write', async () => {
  const model = {
    findOne: () => lean({ runId: 'run-fenced', status: 'RUNNING', workerId: 'worker-b', executionGeneration: 2 }),
    updateOne: async () => ({ modifiedCount: 0 }),
  };
  const worker = createPlanReviewWorker({ model, worker: 'worker-a', runtimeConfig: { agentPlanReview: { leaseMs: 60000, heartbeatMs: 15000 } } });
  await assert.rejects(
    worker.finishRun({ runId: 'run-fenced', workerId: 'worker-a', executionGeneration: 1 }, { recommendedAction: 'NONE' }),
    error => error.code === 'AGENT_LEASE_LOST',
  );
});

test('expired runs at the retry ceiling are terminally recovered and not reclaimed', async () => {
  let update = null;
  const model = {
    async updateMany(filter, mutation) { update = { filter, mutation }; return { modifiedCount: 1 }; },
  };
  const count = await recoverExpiredPlanReviewRuns({ model, nowValue: new Date('2026-01-01T00:00:00.000Z') });
  assert.equal(count, 1);
  assert.equal(update.mutation.$set.status, 'FAILED');
  assert.equal(update.mutation.$set.failure.code, 'INTERNAL_RUNTIME_FAILURE');
  assert.equal(update.mutation.$unset.activeDedupeKey, 1);
});

test('scheduler lease race allows one owner for a period', async () => {
  let lease = null;
  const model = {
    async findOneAndUpdate(_filter, update) {
      if (lease) return null;
      lease = { ...update.$setOnInsert, ...update.$set };
      return lease;
    },
  };
  const [a, b] = await Promise.all([
    claimPlanHealthSchedulerLease({ model, periodKey: '2026-01-01', owner: 'a' }),
    claimPlanHealthSchedulerLease({ model, periodKey: '2026-01-01', owner: 'b' }),
  ]);
  assert.equal(Boolean(a) + Boolean(b), 1);
});

test('scheduled health scan uses bounded profile batches and remains read-only when empty', async () => {
  const profiles = [];
  const lease = {
    findOneAndUpdate: async (_filter, update) => ({ ...update.$setOnInsert, ...update.$set, owner: 'scheduler' }),
    updateOne: async () => ({ modifiedCount: 1 }),
  };
  const profileModel = {
    find() {
      const query = {
        sort() { return query; },
        limit() { return query; },
        lean: async () => profiles,
      };
      return query;
    },
  };
  const result = await runPlanHealthScan({ profileModel, leaseModel: lease, owner: 'scheduler', batchSize: 2 });
  assert.deepEqual(result, { claimed: true, scanned: 0, events: 0, deduplicated: 0, periodKey: result.periodKey });
});

test('plan health supersedes older active events and reopens resolved fingerprints', async () => {
  const profile = {
    _id: '64b000000000000000000011',
    userId,
    monthlyTakeHome: 100000,
    monthlySavings: 20000,
    age: 35,
    riskTolerance: 'Moderate',
    hasLumpSum: false,
    lumpSumAmount: 0,
    investmentGoals: ['Wealth Growth'],
    investmentHorizonYears: 10,
  };
  const stored = new Map();
  const eventModel = {
    async updateMany(filter, mutation) {
      for (const [key, value] of stored) {
        if (value.profileId === filter.profileId && filter.fingerprint.$ne !== value.fingerprint && filter.status.$in.includes(value.status)) {
          stored.set(key, { ...value, ...mutation.$set });
        }
      }
    },
    async create(event) {
      if (stored.has(event.fingerprint)) {
        const error = new Error('duplicate');
        error.code = 11000;
        throw error;
      }
      stored.set(event.fingerprint, { ...event, status: 'UNREAD' });
      return { toObject: () => stored.get(event.fingerprint) };
    },
    findOne(filter) {
      return { lean: async () => stored.get(filter.fingerprint) || null };
    },
    findOneAndUpdate(_filter, mutation) {
      return {
        lean: async () => {
          const current = stored.get(_filter.fingerprint);
          const updated = { ...current, ...mutation.$set };
          delete updated.acknowledgedAt;
          delete updated.resolvedAt;
          delete updated.supersededAt;
          stored.set(_filter.fingerprint, updated);
          return updated;
        },
      };
    },
  };
  let recommendationId = '64b000000000000000000012';
  const dependencies = {
    profileModel: { findOne: () => lean(profile) },
    recommendationModel: {
      findOne: () => ({
        sort() { return this; },
        lean: async () => ({
          _id: recommendationId,
          profileId: profile._id,
          userId,
          generatedAt: new Date(),
          modelVersion: 'model-1',
          regulatoryRuleVersion: 'regulatory-1',
        }),
      }),
    },
  };
  const first = await inspectPlanHealth({ userId, profileId: profile._id, profileModel: dependencies.profileModel, eventModel, dependencies });
  assert.equal(first.status, 'ATTENTION');
  const firstEvent = [...stored.values()][0];
  stored.set(firstEvent.fingerprint, { ...firstEvent, status: 'RESOLVED' });
  const reopened = await inspectPlanHealth({ userId, profileId: profile._id, profileModel: dependencies.profileModel, eventModel, dependencies });
  assert.equal(reopened.event.status, 'UNREAD');
  recommendationId = '64b000000000000000000013';
  const superseded = await inspectPlanHealth({ userId, profileId: profile._id, profileModel: dependencies.profileModel, eventModel, dependencies });
  assert.equal(superseded.event.status, 'UNREAD');
  assert.equal(stored.get(firstEvent.fingerprint).status, 'SUPERSEDED');
});
