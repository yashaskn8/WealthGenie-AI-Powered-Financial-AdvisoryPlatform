import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPlanReviewTransition,
  buildApprovalAction,
  canTransitionPlanReviewState,
  PLAN_REVIEW_AGENT_VERSION,
} from '../agents/planReview/planReviewRuntime.js';
import { enqueuePlanReviewRun } from '../agents/planReview/planReviewService.js';
import { assertPlanReviewGates, gradePlanReviewTrajectory } from '../agents/evals/planReviewEvals.js';
import { emptyCheckpoint } from '@langchain/langgraph';
import { MongoPlanReviewCheckpointer } from '../agents/planReview/mongoPlanReviewCheckpointer.js';

const userId = '64b000000000000000000010';
const profileId = '64b000000000000000000001';

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

test('enqueue is idempotent for an active owned profile run', async () => {
  const active = { runId: 'run-existing', status: 'RUNNING', profileId, agentVersion: PLAN_REVIEW_AGENT_VERSION };
  const model = {
    findOne() { return { lean: async () => active }; },
    create: async () => { throw new Error('should not create a duplicate'); },
  };
  const result = await enqueuePlanReviewRun({ userId, profileId, model });
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
      runtimeConfig: { agentPlanReview: { maxQueuedRunsPerUser: 1, maxActiveRunsPerUser: 1, maxGlobalQueuedRuns: 1 } },
    }),
    error => error.status === 429 && error.code === 'AGENT_QUEUE_SATURATED' && error.retryAfterMs === 5000,
  );
  assert.equal(createCalled, false);
});

test('deterministic evaluation gates reject forbidden tools and wrong actions', () => {
  const caseDefinition = {
    id: 'fresh',
    forbiddenTools: ['execute_trade'],
    expectedAction: 'NONE',
    maxSteps: 6,
    groundingRequired: true,
  };
  const failed = gradePlanReviewTrajectory({
    caseDefinition,
    result: { review: { recommendedAction: 'NONE', evidence: { status: 'AVAILABLE' }, freshness: { reasonCodes: [] } } },
    trajectory: [{ type: 'TOOL_SUCCEEDED', tool: 'execute_trade' }],
  });
  assert.equal(failed.passed, false);
  assert.throws(() => assertPlanReviewGates([failed]), { code: 'AGENT_EVAL_GATE_FAILED' });
});

test('Mongo LangGraph checkpointer persists and reloads a run-scoped checkpoint', async () => {
  const documents = [];
  const model = {
    async findOneAndUpdate(filter, update) {
      let document = documents.find(item => item.threadId === filter.threadId && item.checkpointId === filter.checkpointId);
      if (!document) { document = {}; documents.push(document); }
      Object.assign(document, update.$set);
      return document;
    },
    findOne(filter) {
      const query = {
        sort() { return query; },
        lean: async () => documents.find(item => item.threadId === filter.threadId && (!filter.checkpointId || item.checkpointId === filter.checkpointId)),
      };
      return query;
    },
    async updateOne() {},
    async deleteMany() {},
  };
  const saver = new MongoPlanReviewCheckpointer({ model, runId: 'run-1', userId });
  const checkpoint = { ...emptyCheckpoint(), id: 'checkpoint-1', channel_values: { status: 'RUNNING' } };
  const config = await saver.put({ configurable: { thread_id: 'run-1' } }, checkpoint, { runId: 'run-1' }, checkpoint.channel_versions);
  const tuple = await saver.getTuple(config);
  assert.equal(config.configurable.thread_id, 'run-1');
  assert.equal(tuple.checkpoint.channel_values.status, 'RUNNING');
  assert.equal(tuple.metadata.runId, 'run-1');
});
