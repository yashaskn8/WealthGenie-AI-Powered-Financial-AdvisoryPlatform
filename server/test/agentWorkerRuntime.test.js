import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimNextPlanReviewRun,
  createPlanReviewWorker,
  reconcilePlanReviewReplayCheckpoint,
  recoverExpiredPlanReviewRuns,
} from '../agents/planReview/planReviewWorker.js';
import { claimPlanHealthSchedulerLease, runPlanHealthScan } from '../services/planHealthScheduler.js';
import { inspectPlanHealth } from '../services/planHealthMonitor.js';
import { buildPlanReviewSnapshotBinding, hashPlanReviewSnapshot } from '../agents/planReview/planReviewRuntime.js';
import { canonicalSha256 } from '../utils/canonicalJson.js';
import { PrometheusMetrics } from '../services/metricsCollector.js';

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
    // The owner/generation-qualified lease lookup must not return another
    // worker's row; a stale worker fails before attempting publication.
    findOne: () => lean(null),
    updateOne: async () => ({ modifiedCount: 0 }),
  };
  const worker = createPlanReviewWorker({ model, worker: 'worker-a', runtimeConfig: { agentPlanReview: { leaseMs: 60000, heartbeatMs: 15000 } } });
  await assert.rejects(
    worker.finishRun({ runId: 'run-fenced', workerId: 'worker-a', executionGeneration: 1 }, { recommendedAction: 'NONE' }),
    error => error.code === 'AGENT_LEASE_LOST',
  );
});

test('durable provider-budget reservations survive process-equivalent recovery before the next checkpoint', async () => {
  const profileId = '64b000000000000000000041';
  const binding = buildPlanReviewSnapshotBinding({ userId, profileId, currentState: { profileVersion: 1 }, freshness: { fresh: false, reasonCodes: ['RECOMMENDATION_MISSING'] } });
  const snapshotHash = hashPlanReviewSnapshot(binding);
  const run = {
    runId: 'run-budget-reservation', userId, profileId, status: 'QUEUED', attempt: 0, executionGeneration: 0,
    maxAttempts: 2, queuedAt: new Date(0), priority: 'INTERACTIVE_PLAN_REVIEW', modelCallCount: 0, tokenUsage: 0,
  };
  const model = {
    findOne(filter) {
      if (filter.status === 'QUEUED') return { sort() { return this; }, lean: async () => null };
      return { lean: async () => (filter.runId === run.runId && filter.workerId === run.workerId ? run : null) };
    },
    async findOneAndUpdate(_filter, update) {
      Object.assign(run, update.$set);
      for (const [key, amount] of Object.entries(update.$inc || {})) run[key] = Number(run[key] || 0) + amount;
      return run;
    },
    async updateOne(filter, update) {
      if (filter.runId !== run.runId || filter.workerId !== run.workerId || filter.executionGeneration !== run.executionGeneration || filter.status !== run.status) return { modifiedCount: 0 };
      for (const [key, amount] of Object.entries(update.$max || {})) run[key] = Math.max(Number(run[key] || 0), amount);
      Object.assign(run, update.$set || {});
      for (const key of Object.keys(update.$unset || {})) delete run[key];
      return { modifiedCount: 1 };
    },
  };
  const worker = createPlanReviewWorker({
    model,
    worker: 'worker-budget-test',
    runtimeConfig: { agentPlanReview: { leaseMs: 60000, heartbeatMs: 60000 } },
    runPlanReviewImpl: async ({ dependencies }) => {
      await dependencies.onModelBudgetReservation({ modelCallCount: 1, tokenUsage: 240 });
      const error = new Error('deterministic budget stop after reservation');
      error.code = 'AGENT_BUDGET_EXCEEDED';
      throw error;
    },
  });
  await worker.processNext();
  assert.equal(run.status, 'BUDGET_EXCEEDED');
  assert.equal(run.modelCallCount, 1);
  assert.equal(run.tokenUsage, 240);

  const checkpointPayload = {
    schemaVersion: 'plan-review-replay-checkpoint-1.0.0',
    runId: run.runId,
    planReviewSnapshotHash: snapshotHash,
    sourceBinding: binding,
    counters: { stepCount: 2, toolCallCount: 1, modelCallCount: 0, tokenUsage: 0, toolCallCounts: {} },
  };
  const checkpoint = { ...checkpointPayload, checkpointHash: canonicalSha256(checkpointPayload) };
  const reconciled = reconcilePlanReviewReplayCheckpoint({
    ...run,
    status: 'RUNNING',
    planReviewSnapshotHash: snapshotHash,
    sourceBinding: binding,
    checkpoint: { state: checkpoint },
  });
  assert.equal(reconciled.counters.modelCallCount, 1);
  assert.equal(reconciled.counters.tokenUsage, 240);
  assert.equal(canonicalSha256({
    schemaVersion: reconciled.schemaVersion,
    runId: reconciled.runId,
    planReviewSnapshotHash: reconciled.planReviewSnapshotHash,
    sourceBinding: reconciled.sourceBinding,
    counters: reconciled.counters,
  }), reconciled.checkpointHash);
});

test('failed-run usage reconciliation cannot reduce already durable provider-budget reservations', async () => {
  const run = {
    runId: 'run-budget-monotonic',
    workerId: 'worker-budget-test',
    executionGeneration: 3,
    status: 'RUNNING',
    attempt: 1,
    maxAttempts: 2,
    modelCallCount: 2,
    tokenUsage: 640,
  };
  const model = {
    async updateOne(filter, update) {
      assert.deepEqual(filter, {
        runId: run.runId,
        workerId: run.workerId,
        executionGeneration: run.executionGeneration,
        status: 'RUNNING',
      });
      for (const [key, amount] of Object.entries(update.$max || {})) {
        run[key] = Math.max(Number(run[key] || 0), amount);
      }
      Object.assign(run, update.$set || {});
      return { modifiedCount: 1 };
    },
  };
  const worker = createPlanReviewWorker({
    model,
    worker: run.workerId,
    runtimeConfig: { agentPlanReview: { leaseMs: 60000, heartbeatMs: 60000 } },
  });
  const error = new Error('provider returned partial usage after reservation');
  error.planReviewUsage = { modelCallCount: 1, tokenUsage: 240 };

  await worker.failRun(run, error);

  assert.equal(run.modelCallCount, 2);
  assert.equal(run.tokenUsage, 640);
  assert.equal(run.status, 'QUEUED');
});

test('worker publication fences the exact profile and recommendation pointer in one transaction', async () => {
  const profileId = '64b000000000000000000011';
  const pointer = {
    _id: '64b000000000000000000012',
    userId,
    profileId,
    currentRecommendationId: '64b000000000000000000013',
    currentAllocationRevision: 2,
    currentAllocationRevisionId: '64b000000000000000000014',
    generationRevision: 3,
    profileInputHash: 'a'.repeat(64),
    profileVersion: 5,
    portfolioFingerprint: 'b'.repeat(64),
    returnAssumptionVersion: 'assumption-1',
    returnAssumptionHash: 'c'.repeat(64),
    returnAssumptionSource: 'WEALTHGENIE_MODEL_POLICY',
  };
  const sourceBinding = buildPlanReviewSnapshotBinding({
    userId,
    profileId,
    currentState: {
      profileVersion: 5,
      recommendation: { _id: pointer.currentRecommendationId, recommendationGeneration: 3, profileInputHash: pointer.profileInputHash },
      allocationRevision: { _id: pointer.currentAllocationRevisionId, revision: 2 },
      statePointer: pointer,
      portfolioFingerprint: pointer.portfolioFingerprint,
      provenance: { status: 'PERSISTED_REVISION' },
    },
    freshness: { fresh: true, reasonCodes: [] },
  });
  const sourceHash = hashPlanReviewSnapshot(sourceBinding);
  const run = {
    runId: 'run-publication-fence', userId, profileId, workerId: 'worker-a', executionGeneration: 1,
    status: 'RUNNING', leaseUntil: new Date(Date.now() + 60000), sourceBinding, planReviewSnapshotHash: sourceHash,
    checkpointSequence: 0,
  };
  const writes = [];
  const session = { withTransaction: async callback => callback(), endSession: async () => {} };
  const model = {
    findOne: () => lean(run),
    async updateOne(filter, update, options) { writes.push({ model: 'run', filter, update, options }); return { modifiedCount: 1 }; },
  };
  const profileModel = {
    async updateOne(filter, update, options) { writes.push({ model: 'profile', filter, update, options }); return { modifiedCount: 1 }; },
  };
  const stateModel = {
    async updateOne(filter, update, options) { writes.push({ model: 'state', filter, update, options }); return { modifiedCount: 1 }; },
  };
  const worker = createPlanReviewWorker({
    model,
    profileModel,
    stateModel,
    mongo: { startSession: async () => session },
    snapshotResolver: async () => ({ sourceBinding, planReviewSnapshotHash: sourceHash, currentState: { statePointer: pointer } }),
    worker: 'worker-a',
  });
  await worker.finishRun(run, { recommendedAction: 'NONE', findings: [], evidence: { entries: [] }, execution: { stepCount: 2, toolCallCount: 1, modelCallCount: 0 } });
  assert.deepEqual(writes.map(item => item.model), ['profile', 'state', 'run']);
  assert.ok(writes.every(item => item.options?.session === session));
  assert.equal(writes[0].update.$inc.planReviewPublicationFence, 1);
  assert.equal(writes[1].filter.currentAllocationRevisionId, pointer.currentAllocationRevisionId);
  assert.equal(writes[2].filter.planReviewSnapshotHash, sourceHash);
});

test('RUN_COMPLETED and success metrics are written only with the durable terminal CAS', async () => {
  const profileId = '64b000000000000000000031';
  const binding = buildPlanReviewSnapshotBinding({ userId, profileId, currentState: { profileVersion: 1 }, freshness: { fresh: false, reasonCodes: ['RECOMMENDATION_MISSING'] } });
  const hash = hashPlanReviewSnapshot(binding);
  const run = {
    runId: 'run-terminal-event', userId, profileId, workerId: 'worker-a', executionGeneration: 1,
    status: 'RUNNING', leaseUntil: new Date(Date.now() + 60000), sourceBinding: binding, planReviewSnapshotHash: hash,
    eventSequence: 0, trajectory: [],
  };
  const events = [];
  let insideTransaction = false;
  const session = {
    async withTransaction(callback) {
      insideTransaction = true;
      await callback();
      insideTransaction = false;
    },
    async endSession() {},
  };
  const model = {
    findOne(filter) { return lean(!filter.status || run.status === filter.status ? run : null); },
    async updateOne(filter, update, options) {
      if (run.status !== filter.status || options.session !== session) return { modifiedCount: 0 };
      Object.assign(run, update.$set || {});
      for (const [key, amount] of Object.entries(update.$inc || {})) run[key] = Number(run[key] || 0) + amount;
      if (update.$push?.trajectory?.$each) run.trajectory.push(...update.$push.trajectory.$each);
      return { modifiedCount: 1 };
    },
  };
  const worker = createPlanReviewWorker({
    model,
    profileModel: { updateOne: async () => ({ modifiedCount: 1 }) },
    stateModel: { updateOne: async () => ({ modifiedCount: 1 }) },
    eventModel: { async create(rows, options) { assert.equal(insideTransaction, true); assert.equal(options.session, session); events.push(...rows); } },
    mongo: { startSession: async () => session },
    snapshotResolver: async () => ({ sourceBinding: binding, planReviewSnapshotHash: hash, currentState: {} }),
    worker: 'worker-a',
  });
  const beforeCompleted = PrometheusMetrics.counters.agent_runs_completed_total;
  const result = await worker.finishRun(run, {
    recommendedAction: 'NONE', findings: [], evidence: { entries: [] },
    execution: { stepCount: 5, toolCallCount: 0, modelCallCount: 0, tokenUsage: 0 },
  });

  assert.deepEqual(result, { committed: true, status: 'COMPLETED', runId: run.runId });
  assert.equal(run.status, 'COMPLETED');
  assert.equal(run.eventSequence, 1);
  assert.equal(run.trajectory.at(-1).type, 'RUN_COMPLETED');
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'RUN_COMPLETED');
  assert.equal(events[0].sequence, 1);
  assert.equal(PrometheusMetrics.counters.agent_runs_completed_total, beforeCompleted + 1);
  await assert.rejects(worker.finishRun(run, { recommendedAction: 'NONE' }), error => error.code === 'AGENT_LEASE_LOST');
  assert.equal(events.length, 1, 'replay after terminalization cannot emit another completion event');
});

test('cancellation winning immediately before worker terminal CAS suppresses success metrics and event', async () => {
  const profileId = '64b000000000000000000032';
  const binding = buildPlanReviewSnapshotBinding({ userId, profileId, currentState: { profileVersion: 1 }, freshness: { fresh: false, reasonCodes: ['RECOMMENDATION_MISSING'] } });
  const hash = hashPlanReviewSnapshot(binding);
  const run = {
    runId: 'run-cancel-wins-finalization', userId, profileId, status: 'QUEUED', queuedAt: new Date(0),
    priority: 'INTERACTIVE_PLAN_REVIEW', attempt: 0, executionGeneration: 0, maxAttempts: 2,
    sourceBinding: binding, planReviewSnapshotHash: hash,
  };
  const events = [];
  const session = { withTransaction: async callback => callback(), endSession: async () => {} };
  const model = {
    findOne(filter) {
      const matches = (!filter.status || filter.status === run.status)
        && (!filter.runId || filter.runId === run.runId)
        && (!filter.workerId || filter.workerId === run.workerId)
        && (!filter.executionGeneration || filter.executionGeneration === run.executionGeneration);
      return { sort() { return this; }, lean: async () => matches ? run : null };
    },
    async findOneAndUpdate(_filter, update) {
      Object.assign(run, update.$set || {});
      for (const [key, amount] of Object.entries(update.$inc || {})) run[key] = Number(run[key] || 0) + amount;
      return run;
    },
    async updateOne(filter, update) {
      if (filter.status !== run.status) return { modifiedCount: 0 };
      if (filter.status === 'RUNNING' && run.status === 'CANCELLED') return { modifiedCount: 0 };
      Object.assign(run, update.$set || {});
      return { modifiedCount: 1 };
    },
  };
  const beforeJobs = PrometheusMetrics.counters.agent_worker_jobs_completed_total;
  const beforeQueue = PrometheusMetrics.counters.agent_queue_runs_completed_total;
  const worker = createPlanReviewWorker({
    model,
    worker: 'worker-cancel-test',
    runtimeConfig: { agentPlanReview: { leaseMs: 60000, heartbeatMs: 60000 } },
    profileModel: {
      async updateOne() {
        run.status = 'CANCELLED';
        return { modifiedCount: 1 };
      },
    },
    stateModel: { updateOne: async () => ({ modifiedCount: 1 }) },
    eventModel: { async create(rows) { events.push(...rows); } },
    mongo: { startSession: async () => session },
    snapshotResolver: async () => ({ sourceBinding: binding, planReviewSnapshotHash: hash, currentState: {} }),
    runPlanReviewImpl: async ({ dependencies }) => {
      assert.ok(dependencies.signal instanceof AbortSignal);
      return { recommendedAction: 'NONE', findings: [], evidence: { entries: [] }, execution: { stepCount: 5, toolCallCount: 0, modelCallCount: 0, tokenUsage: 0 } };
    },
  });

  await worker.processNext();
  assert.equal(run.status, 'CANCELLED');
  assert.equal(PrometheusMetrics.counters.agent_worker_jobs_completed_total, beforeJobs);
  assert.equal(PrometheusMetrics.counters.agent_queue_runs_completed_total, beforeQueue);
  assert.equal(events.filter(event => event.eventType === 'RUN_COMPLETED').length, 0);
});

test('source supersession winning before terminal publication is counted as superseded, never successful or failed', async () => {
  const profileId = '64b000000000000000000034';
  const binding = buildPlanReviewSnapshotBinding({ userId, profileId, currentState: { profileVersion: 1 }, freshness: { fresh: false, reasonCodes: ['RECOMMENDATION_MISSING'] } });
  const hash = hashPlanReviewSnapshot(binding);
  const supersedingBinding = { ...binding, profileVersion: 2 };
  const run = {
    runId: 'run-supersede-wins-finalization', userId, profileId, status: 'QUEUED', queuedAt: new Date(0),
    priority: 'INTERACTIVE_PLAN_REVIEW', attempt: 0, executionGeneration: 0, maxAttempts: 2,
    activeDedupeKey: 'active-snapshot-key', sourceBinding: binding, planReviewSnapshotHash: hash,
  };
  const events = [];
  const session = { withTransaction: async callback => callback(), endSession: async () => {} };
  const model = {
    findOne(filter) {
      const matches = (!filter.status || filter.status === run.status)
        && (!filter.runId || filter.runId === run.runId)
        && (!filter.workerId || filter.workerId === run.workerId)
        && (!filter.executionGeneration || filter.executionGeneration === run.executionGeneration);
      return { sort() { return this; }, lean: async () => matches ? run : null };
    },
    findOneAndUpdate(_filter, update) {
      Object.assign(run, update.$set || {});
      for (const [key, amount] of Object.entries(update.$inc || {})) run[key] = Number(run[key] || 0) + amount;
      return { lean: async () => ({ ...run }) };
    },
    async updateOne(filter, update) {
      if (filter.status !== run.status || filter.runId !== run.runId) return { modifiedCount: 0 };
      Object.assign(run, update.$set || {});
      for (const key of Object.keys(update.$unset || {})) delete run[key];
      return { modifiedCount: 1 };
    },
  };
  const beforeCompleted = PrometheusMetrics.counters.agent_worker_jobs_completed_total;
  const beforeFailed = PrometheusMetrics.counters.agent_worker_jobs_failed_total;
  const beforeSuperseded = PrometheusMetrics.counters.agent_worker_jobs_superseded_total;
  const worker = createPlanReviewWorker({
    model,
    worker: 'worker-supersede-test',
    runtimeConfig: { agentPlanReview: { leaseMs: 60000, heartbeatMs: 60000 } },
    profileModel: { updateOne: async () => ({ modifiedCount: 1 }) },
    stateModel: { updateOne: async () => ({ modifiedCount: 1 }) },
    eventModel: { async create(rows) { events.push(...(Array.isArray(rows) ? rows : [rows])); } },
    mongo: { startSession: async () => session },
    snapshotResolver: async () => ({
      sourceBinding: supersedingBinding,
      planReviewSnapshotHash: hashPlanReviewSnapshot(supersedingBinding),
      currentState: {},
    }),
    runPlanReviewImpl: async () => ({
      recommendedAction: 'NONE', findings: [], evidence: { entries: [] },
      execution: { stepCount: 4, toolCallCount: 0, modelCallCount: 0, tokenUsage: 0 },
    }),
  });

  await worker.processNext();

  assert.equal(run.status, 'SUPERSEDED');
  assert.equal(run.activeDedupeKey, undefined);
  assert.equal(run.deadLetter, null, 'supersession is not a failed/dead-letter job');
  assert.equal(PrometheusMetrics.counters.agent_worker_jobs_completed_total, beforeCompleted);
  assert.equal(PrometheusMetrics.counters.agent_worker_jobs_failed_total, beforeFailed);
  assert.equal(PrometheusMetrics.counters.agent_worker_jobs_superseded_total, beforeSuperseded + 1);
  assert.equal(events.filter(event => event.eventType === 'RUN_COMPLETED').length, 0);
  assert.ok(events.some(event => event.eventType === 'RUN_SUPERSEDED'));
});

test('worker refuses to publish a review after its bound source snapshot is superseded', async () => {
  const profileId = '64b000000000000000000021';
  const binding = buildPlanReviewSnapshotBinding({ userId, profileId, currentState: { profileVersion: 1 }, freshness: { fresh: false, reasonCodes: ['RECOMMENDATION_MISSING'] } });
  const hash = hashPlanReviewSnapshot(binding);
  const run = { runId: 'run-superseded', userId, profileId, workerId: 'worker-a', executionGeneration: 1, status: 'RUNNING', leaseUntil: new Date(Date.now() + 60000), sourceBinding: binding, planReviewSnapshotHash: hash };
  let runUpdate = false;
  const session = { withTransaction: async callback => callback(), endSession: async () => {} };
  const worker = createPlanReviewWorker({
    model: { findOne: () => lean(run), updateOne: async () => { runUpdate = true; return { modifiedCount: 1 }; } },
    profileModel: { updateOne: async () => ({ modifiedCount: 1 }) },
    stateModel: { updateOne: async () => ({ modifiedCount: 1 }) },
    mongo: { startSession: async () => session },
    snapshotResolver: async () => ({ sourceBinding: { ...binding, profileVersion: 2 }, planReviewSnapshotHash: 'd'.repeat(64), currentState: {} }),
    worker: 'worker-a',
  });
  await assert.rejects(worker.finishRun(run, { recommendedAction: 'NONE' }), error => error.code === 'PLAN_REVIEW_SOURCE_SUPERSEDED');
  assert.equal(runUpdate, false);
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
