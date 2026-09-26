import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPlanReviewTransition,
  buildApprovalAction,
  buildPlanReviewSnapshotBinding,
  canTransitionPlanReviewState,
  hashPlanReviewSnapshot,
  planReviewGraphThreadId,
  PLAN_REVIEW_AGENT_VERSION,
} from '../agents/planReview/planReviewRuntime.js';
import { enqueuePlanReviewRun } from '../agents/planReview/planReviewService.js';
import { assertPlanReviewGates, gradePlanReviewTrajectory } from '../agents/evals/planReviewEvals.js';
import { emptyCheckpoint } from '@langchain/langgraph';
import { MongoPlanReviewCheckpointer } from '../agents/planReview/mongoPlanReviewCheckpointer.js';
import { completePlanReviewMandateAction, persistPlanReviewAction } from '../agents/planReview/planReviewApproval.js';
import { createPlanReviewGraph } from '../agents/planReview/planReviewGraph.js';

const userId = '64b000000000000000000010';
const profileId = '64b000000000000000000001';
const snapshotBinding = buildPlanReviewSnapshotBinding({ userId, profileId, currentState: { profileVersion: 1, provenance: { status: 'MISSING' } }, freshness: { fresh: false, reasonCodes: ['RECOMMENDATION_MISSING'] } });
const snapshotHash = hashPlanReviewSnapshot(snapshotBinding);
const snapshotResolver = async () => ({ sourceBinding: snapshotBinding, planReviewSnapshotHash: snapshotHash });

test('plan review state machine permits only explicit durable transitions', () => {
  assert.equal(canTransitionPlanReviewState('QUEUED', 'RUNNING'), true);
  assert.equal(canTransitionPlanReviewState('COMPLETED', 'RUNNING'), false);
  assert.doesNotThrow(() => assertPlanReviewTransition('WAITING_FOR_APPROVAL', 'CANCELLED'));
  assert.throws(() => assertPlanReviewTransition('COMPLETED', 'RUNNING'), { code: 'INVALID_AGENT_STATE_TRANSITION' });
});

test('approval action is a descriptor and never a financial mutation', () => {
  const descriptor = buildApprovalAction('APPROVE_RECOMPUTE', { runId: 'run-1', profileId, recommendationId: null });
  assert.equal(descriptor.requiresAuthoritativeWorkflow, true);
  assert.equal(descriptor.mutationPerformed, false);
  assert.throws(() => buildApprovalAction('EXECUTE_TRADE', { runId: 'run-1' }), { code: 'UNSUPPORTED_AGENT_ACTION' });
});

test('rejecting a current review closes its active lifecycle with snapshot CAS', async () => {
  let document = { userId, runId: 'run-approval', planReviewSnapshotHash: snapshotHash, status: 'WAITING_FOR_APPROVAL', activeDedupeKey: 'active-key' };
  let captured;
  const model = {
    async findOneAndUpdate(filter, update) {
      captured = { filter, update };
      if (filter.userId !== document.userId || filter.runId !== document.runId
        || filter.status !== document.status || filter.planReviewSnapshotHash !== document.planReviewSnapshotHash) return null;
      document = { ...document, ...update.$set };
      if (update.$unset) for (const key of Object.keys(update.$unset)) delete document[key];
      return document;
    },
  };
  const saved = await persistPlanReviewAction({ model, userId, runId: 'run-approval', planReviewSnapshotHash: snapshotHash, action: 'REJECT_RECOMPUTE' });
  assert.equal(saved.status, 'COMPLETED');
  assert.equal(saved.approval.status, 'USER_REJECTED');
  assert.equal('activeDedupeKey' in saved, false);
  assert.equal(captured.filter.planReviewSnapshotHash, snapshotHash);
  assert.equal(captured.update.$unset.activeDedupeKey, 1);
});

test('mandate action keeps a review pending and terminalization is bound to its mandate identity', async () => {
  const document = { userId, runId: 'run-approval', planReviewSnapshotHash: snapshotHash, status: 'WAITING_FOR_APPROVAL', activeDedupeKey: 'active-key', approval: { status: 'MANDATE_CREATED', mandateId: 'mandate-1' } };
  const model = {
    async findOneAndUpdate(filter, update) {
      const pathValue = path => path.split('.').reduce((value, key) => value?.[key], document);
      if (Object.entries(filter).some(([key, value]) => pathValue(key) !== value)) return null;
      for (const [path, value] of Object.entries(update.$set || {})) {
        const keys = path.split('.');
        const finalKey = keys.pop();
        const target = keys.reduce((current, key) => (current[key] ||= {}), document);
        target[finalKey] = value;
      }
      if (update.$unset) for (const key of Object.keys(update.$unset)) delete document[key];
      return document;
    },
  };
  const pending = await persistPlanReviewAction({
    model,
    userId,
    runId: 'run-approval',
    planReviewSnapshotHash: snapshotHash,
    action: 'APPROVE_RECOMPUTE',
    mandate: { mandateId: 'mandate-1' },
  });
  assert.equal(pending.status, 'WAITING_FOR_APPROVAL');
  assert.equal(pending.activeDedupeKey, 'active-key');
  assert.equal(pending.approval.status, 'MANDATE_CREATED');

  assert.equal(await completePlanReviewMandateAction({ model, userId, runId: 'run-approval', mandateId: 'another-mandate', outcome: 'REVOKED' }), null);
  const completed = await completePlanReviewMandateAction({ model, userId, runId: 'run-approval', mandateId: 'mandate-1', outcome: 'EXECUTED' });
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.approval.status, 'MANDATE_EXECUTED');
  assert.equal('activeDedupeKey' in completed, false);
});

test('enqueue is idempotent for an active owned profile run bound to the same source snapshot', async () => {
  const active = { runId: 'run-existing', status: 'RUNNING', profileId, planReviewSnapshotHash: snapshotHash, agentVersion: PLAN_REVIEW_AGENT_VERSION };
  const model = {
    findOne() { return { lean: async () => active }; },
    create: async () => { throw new Error('should not create a duplicate'); },
  };
  const result = await enqueuePlanReviewRun({ userId, profileId, model, snapshotResolver });
  assert.equal(result.created, false);
  assert.equal(result.run.runId, active.runId);
});

test('enqueue applies per-user and global queue backpressure before creating a run', async () => {
  let createCalled = false;
  const model = {
    findOne() { return { lean: async () => null }; },
    async countDocuments(filter) {
      if (filter.status === 'QUEUED') return filter.userId ? 1 : 1;
      return 0;
    },
    async create() { createCalled = true; return null; },
  };
  await assert.rejects(
    enqueuePlanReviewRun({
      userId,
      profileId,
      model,
      snapshotResolver,
      runtimeConfig: { agentPlanReview: { maxQueuedRunsPerUser: 1, maxActiveRunsPerUser: 1, maxGlobalQueuedRuns: 1 } },
    }),
    error => error.status === 429 && error.code === 'AGENT_QUEUE_SATURATED' && error.retryAfterMs === 5000,
  );
  assert.equal(createCalled, false);
});

test('deterministic evaluation gates enforce every reported quality and hard gate', () => {
  const caseDefinition = {
    id: 'fresh',
    forbiddenTools: ['execute_trade'],
    expectedTools: ['get_current_profile_context'],
    expectedAction: 'NONE',
    maxSteps: 6,
    maxToolCalls: 8,
    groundingRequired: true,
    requiredReasonCodes: [],
  };
  const valid = gradePlanReviewTrajectory({
    caseDefinition,
    result: { stepCount: 1, toolCallCount: 1, review: { recommendedAction: 'NONE', evidence: { status: 'AVAILABLE' }, freshness: { reasonCodes: [] } } },
    trajectory: [{ type: 'TOOL_SUCCEEDED', tool: 'get_current_profile_context' }],
  });
  assert.equal(valid.passed, true);

  const failed = gradePlanReviewTrajectory({
    caseDefinition,
    result: { stepCount: 1, toolCallCount: 1, review: { recommendedAction: 'NONE', evidence: { status: 'AVAILABLE' }, freshness: { reasonCodes: [] } } },
    trajectory: [{ type: 'TOOL_SUCCEEDED', tool: 'execute_trade' }],
  });
  assert.equal(failed.passed, false);
  assert.equal(failed.policy, false);
  assert.throws(() => assertPlanReviewGates([failed]), { code: 'AGENT_EVAL_GATE_FAILED' });

  const mutations = [
    { result: { stepCount: 99, toolCallCount: 1, review: { recommendedAction: 'NONE', evidence: { status: 'AVAILABLE' }, freshness: { reasonCodes: [] } } }, trajectory: [{ type: 'TOOL_SUCCEEDED', tool: 'get_current_profile_context' }], gate: 'trajectory' },
    { result: { stepCount: 1, toolCallCount: 1, review: { recommendedAction: 'NONE', evidence: { status: 'UNAVAILABLE' }, freshness: { reasonCodes: [] } } }, trajectory: [{ type: 'TOOL_SUCCEEDED', tool: 'get_current_profile_context' }], gate: 'grounding' },
    { result: { stepCount: 1, toolCallCount: 1, review: { recommendedAction: 'NONE', policy: { allowed: false }, evidence: { status: 'AVAILABLE' }, freshness: { reasonCodes: [] } } }, trajectory: [{ type: 'TOOL_SUCCEEDED', tool: 'get_current_profile_context' }], gate: 'policy' },
    { result: { stepCount: 1, toolCallCount: 1, review: { recommendedAction: 'NONE', evidence: { status: 'AVAILABLE' }, freshness: { reasonCodes: null } } }, trajectory: [{ type: 'TOOL_SUCCEEDED', tool: 'get_current_profile_context' }], gate: 'robustness' },
    { result: { stepCount: 1, toolCallCount: 1, review: { recommendedAction: 'RECOMPUTE_PLAN', evidence: { status: 'AVAILABLE' }, freshness: { reasonCodes: [] } } }, trajectory: [{ type: 'TOOL_SUCCEEDED', tool: 'get_current_profile_context' }], gate: 'action' },
    { result: { stepCount: 1, toolCallCount: 1, review: { recommendedAction: 'NONE', evidence: { status: 'AVAILABLE' }, freshness: { reasonCodes: [] } } }, trajectory: [], gate: 'toolSelection' },
  ];
  for (const mutation of mutations) {
    const graded = gradePlanReviewTrajectory({ caseDefinition, ...mutation });
    assert.equal(graded[mutation.gate], false, `${mutation.gate} must fail the evaluation`);
    assert.equal(graded.passed, false, `${mutation.gate} failure must fail the complete evaluation`);
  }
});

test('Mongo LangGraph checkpointer persists and reloads a run-scoped checkpoint', async () => {
  const documents = [];
  const model = {
    async findOneAndUpdate(filter, update) {
      let document = documents.find(item => Object.entries(filter).every(([key, value]) => String(item[key]) === String(value)));
      if (!document) { document = { ...update.$setOnInsert }; documents.push(document); }
      Object.assign(document, update.$set);
      return document;
    },
    findOne(filter) {
      const query = {
        sort() { return query; },
        lean: async () => documents.find(item => Object.entries(filter).every(([key, value]) => String(item[key]) === String(value))),
      };
      return query;
    },
    async updateOne() {},
    async deleteMany() {},
  };
  const saver = new MongoPlanReviewCheckpointer({ model, runId: 'run-1', userId, executionGeneration: 1 });
  const checkpoint = { ...emptyCheckpoint(), id: 'checkpoint-1', channel_values: { status: 'RUNNING' } };
  const config = await saver.put({ configurable: { thread_id: 'run-1:1' } }, checkpoint, { runId: 'run-1' }, checkpoint.channel_versions);
  const tuple = await saver.getTuple(config);
  assert.equal(config.configurable.thread_id, 'run-1:1');
  assert.equal(tuple.checkpoint.channel_values.status, 'RUNNING');
  assert.equal(tuple.metadata.runId, 'run-1');
  assert.throws(() => saver.scope('run-1:2'), { code: 'CHECKPOINT_SCOPE_MISMATCH' });
});

test('PlanReview identity includes financial source binding and execution generation', async () => {
  const nextBinding = { ...snapshotBinding, allocationRevision: 2 };
  assert.notEqual(hashPlanReviewSnapshot(nextBinding), snapshotHash);
  assert.equal(planReviewGraphThreadId('run-1', 2), 'run-1:2');
  assert.throws(() => planReviewGraphThreadId('run-1', 0), /positive execution generation/);
});

test('a present but invalid replay checkpoint fails closed instead of resetting budgets', async () => {
  const graph = createPlanReviewGraph({
    loadPlanReviewContext: async () => ({ planReviewSnapshotHash: snapshotHash }),
  });
  await assert.rejects(
    graph.invoke({
      runId: 'run-invalid-checkpoint',
      userId,
      profileId,
      executionGeneration: 2,
      expectedPlanReviewSnapshotHash: snapshotHash,
      resumeCheckpoint: {
        schemaVersion: 'plan-review-replay-checkpoint-1.0.0',
        runId: 'run-invalid-checkpoint',
        planReviewSnapshotHash: snapshotHash,
        sourceBinding: snapshotBinding,
        counters: { modelCallCount: 1, tokenUsage: 100 },
        checkpointHash: 'tampered',
      },
    }),
    error => error.code === 'CHECKPOINT_FAILURE',
  );
});
