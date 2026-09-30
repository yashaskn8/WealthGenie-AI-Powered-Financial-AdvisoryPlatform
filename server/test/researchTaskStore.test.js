import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskState } from '@a2a-js/sdk';
import { MongoResearchTaskStore, mergeResearchTask, researchRequestFingerprint } from '../services/researchTaskStore.js';
import { createResearchBrief } from '../agents/research/researchSchemas.js';

class FakeTaskModel {
  constructor() { this.rows = new Map(); this.nextId = 0; }

  findOne(filter) {
    const row = this.rows.get(filter.taskId);
    const matches = row && (!filter.ownerKey || row.ownerKey === filter.ownerKey);
    return {
      select: () => ({ lean: async () => matches ? { statusState: row.statusState } : null }),
      lean: async () => matches ? structuredClone(row) : null,
    };
  }

  async create(value) {
    if (this.rows.has(value.taskId)) throw Object.assign(new Error('duplicate'), { code: 11000 });
    const row = { ...structuredClone(value), _id: String(++this.nextId) };
    this.rows.set(value.taskId, row);
    return row;
  }

  findOneAndUpdate(filter, update) {
    return {
      lean: async () => {
        const row = [...this.rows.values()].find(item => item._id === filter._id
          && item.ownerKey === filter.ownerKey
          && item.revision === filter.revision
          && !filter.statusState.$nin.includes(item.statusState));
        if (!row) return null;
        Object.assign(row, structuredClone(update.$set));
        row.revision += update.$inc.revision;
        return structuredClone(row);
      },
    };
  }
}

function context(subject) {
  return { user: { identity: { provider: 'development', authenticated: true, subject, agentType: 'PLAN_REVIEW' } } };
}

function task(state, timestamp, { id = 'task-1', contextId = 'context-1', history = [], artifacts = [] } = {}) {
  return { id, contextId, status: { state, timestamp }, history, artifacts, metadata: { agentType: 'FINANCIAL_RESEARCH' } };
}

test('semantic ResearchBrief fingerprint ignores transport identity and normalizes unordered request sets', () => {
  const brief = createResearchBrief({
    researchBriefId: 'brief-one',
    asOf: '2026-09-01T12:00:00.000Z',
    topic: '  Official   savings rates ',
    question: 'Verify the current official public savings rate',
    requestedFactTypes: ['rate', 'effective_date'],
    instrumentCategories: ['deposits', 'small-savings'],
    knownEvidenceIds: ['RBI-1', 'DEA-2'],
    knownSourceDates: [{ sourceId: 'RBI-1', date: '2026-09-01T00:00:00.000Z' }],
  });
  const retried = {
    ...brief,
    researchBriefId: 'brief-two',
    asOf: '2026-09-01T23:59:59.999Z',
    requestedFactTypes: [...brief.requestedFactTypes].reverse(),
    instrumentCategories: [...brief.instrumentCategories].reverse(),
    knownEvidenceIds: [...brief.knownEvidenceIds].reverse(),
  };
  assert.equal(researchRequestFingerprint(brief), researchRequestFingerprint(retried));
  assert.notEqual(researchRequestFingerprint(brief), researchRequestFingerprint({
    ...retried,
    question: 'Verify a materially different official public savings rate',
  }));
  assert.notEqual(researchRequestFingerprint(brief), researchRequestFingerprint({
    ...retried,
    asOf: '2026-09-02T00:00:00.000Z',
  }), 'explicit research as-of dates are semantic constraints, not transport timestamps');
  assert.notEqual(researchRequestFingerprint(brief), researchRequestFingerprint({
    ...retried,
    regulatoryContext: { ...retried.regulatoryContext, policyVersion: 'different-policy' },
  }));
});

test('invalid claimed recovery input releases the exact task and global capacity leases', async () => {
  const ownerKey = 'a'.repeat(64);
  const candidate = {
    _id: 'recovery-row',
    taskId: 'recovery-without-message',
    ownerKey,
    revision: 4,
    executionFence: 8,
    statusState: TaskState.TASK_STATE_SUBMITTED,
    task: task(TaskState.TASK_STATE_SUBMITTED, new Date().toISOString()),
  };
  const calls = [];
  const updates = [];
  const capacityExpiresAt = new Date(Date.now() + 15_000);
  let leaseToken;
  const claimed = {
    ...candidate,
    revision: 5,
    executionFence: 9,
    executionMessageId: null,
  };
  const model = {
    collection: {
      findOneAndUpdate: async (filter, update) => {
        calls.push(filter);
        updates.push(update);
        if (calls.length === 1) {
          leaseToken = update[0].$set.executionLeaseToken.$literal;
          claimed.executionLeaseToken = leaseToken;
          claimed.executionCapacityToken = leaseToken;
          return { value: claimed, ok: 1 };
        }
        return { value: null, ok: 1, lastErrorObject: { n: 0 } };
      },
    },
  };
  const released = [];
  const store = new MongoResearchTaskStore({ model, env: { NODE_ENV: 'test' }, leaseMs: 3_000 });
  store.capacity = {
    acquire: async () => ({ acquired: true, sameTaskHeld: false, expiresAt: capacityExpiresAt }),
    release: async lease => { released.push(lease); },
  };

  await assert.rejects(
    store.claimTaskRecord(candidate),
    error => error.code === 'A2A_TASK_RECOVERY_INPUT_UNAVAILABLE',
  );
  assert.equal(calls.length, 2, 'cleanup conditionally clears the just-created task lease');
  assert.equal(calls[1].taskId, candidate.taskId);
  assert.equal(calls[1].ownerKey, ownerKey);
  assert.equal(calls[1].executionLeaseToken, leaseToken);
  assert.equal(calls[1].executionFence, 9);
  assert.equal(
    updates[0][0].$set.executionLeaseExpiresAt.$literal.getTime(),
    capacityExpiresAt.getTime() - 1_000,
    'task execution expiry is derived from the acquired global capacity lease',
  );
  assert.equal(released.length, 1, 'global capacity reservation is released too');
  assert.equal(released[0].taskId, candidate.taskId);
  assert.equal(released[0].token, leaseToken);
  assert.equal(store.activeLeases.has(candidate.taskId), false);
});

test('task lease renewal never extends beyond its renewed distributed capacity lease', async () => {
  const ownerContext = context('lease-renew-owner');
  const capacityExpiresAt = new Date(Date.now() + 12_000);
  let updatePipeline;
  let updateFilter;
  const model = {
    collection: {
      findOneAndUpdate: async (filter, update) => {
        updateFilter = filter;
        updatePipeline = update;
        return { value: { _id: 'active-task-row' }, ok: 1 };
      },
    },
  };
  const store = new MongoResearchTaskStore({ model, env: { NODE_ENV: 'test' }, leaseMs: 3_000 });
  store.capacity = { renew: async () => capacityExpiresAt };

  assert.equal(await store.renewExecutionLease('active-task', ownerContext, { token: 'lease-token', fence: 4 }), true);
  assert.equal(
    updatePipeline[0].$set.executionLeaseExpiresAt.$literal.getTime(),
    capacityExpiresAt.getTime() - 1_000,
  );
  assert.ok(updateFilter.$expr.$and.length >= 2, 'renewal fails if the bounded task expiry has already elapsed');
});

test('Mongo ResearchTaskStore scopes task IDs to verified agent identity and preserves terminal state', async () => {
  const store = new MongoResearchTaskStore({ model: new FakeTaskModel(), env: { NODE_ENV: 'test' } });
  const callerA = context('plan-review-A');
  const callerB = context('plan-review-B');
  await store.save(task(TaskState.TASK_STATE_SUBMITTED, '2026-09-27T10:00:00.000Z'), callerA);
  assert.equal((await store.load('task-1', callerB)), undefined);
  await assert.rejects(store.save(task(TaskState.TASK_STATE_WORKING, '2026-09-27T10:00:01.000Z'), callerB), error => error.code === 'A2A_TASK_OWNER_CONFLICT');
  await store.save(task(TaskState.TASK_STATE_WORKING, '2026-09-27T10:00:01.000Z'), callerA);
  await store.save(task(TaskState.TASK_STATE_CANCELED, '2026-09-27T10:00:02.000Z'), callerA);
  await store.save(task(TaskState.TASK_STATE_COMPLETED, '2026-09-27T10:00:03.000Z'), callerA);
  const current = await store.load('task-1', callerA);
  assert.equal(current.status.state, TaskState.TASK_STATE_CANCELED, 'a later worker cannot overwrite a committed cancellation');
  assert.equal(await store.isCanceled('task-1', callerA), true);
});

test('concurrent task updates merge message and artifact IDs without rewriting task identity', () => {
  const before = task(TaskState.TASK_STATE_WORKING, '2026-09-27T10:00:00.000Z', {
    history: [{ messageId: 'input', parts: [] }],
  });
  const concurrent = task(TaskState.TASK_STATE_WORKING, '2026-09-27T10:00:01.000Z', {
    history: [{ messageId: 'input', parts: [] }, { messageId: 'message-B', parts: [] }],
    artifacts: [{ artifactId: 'artifact-B', parts: [] }],
  });
  const merged = mergeResearchTask(before, concurrent);
  assert.deepEqual(merged.history.map(message => message.messageId), ['input', 'message-B']);
  assert.deepEqual(merged.artifacts.map(artifact => artifact.artifactId), ['artifact-B']);
  assert.throws(() => mergeResearchTask(before, { ...concurrent, contextId: 'other-context' }), error => error.code === 'A2A_TASK_IDENTITY_CONFLICT');
});

test('concurrent Mongo task updates use revision CAS and retain both message histories', async () => {
  const model = new FakeTaskModel();
  const store = new MongoResearchTaskStore({ model, env: { NODE_ENV: 'test' } });
  const caller = context('plan-review-concurrent');
  const submitted = task(TaskState.TASK_STATE_SUBMITTED, '2026-09-27T10:00:00.000Z');
  await store.save(submitted, caller);

  const updateA = task(TaskState.TASK_STATE_WORKING, '2026-09-27T10:00:01.000Z', {
    history: [...submitted.history, { messageId: 'message-A', parts: [] }],
  });
  const updateB = task(TaskState.TASK_STATE_WORKING, '2026-09-27T10:00:02.000Z', {
    history: [...submitted.history, { messageId: 'message-B', parts: [] }],
    artifacts: [{ artifactId: 'artifact-B', parts: [] }],
  });
  await Promise.all([store.save(updateA, caller), store.save(updateB, caller)]);

  const persisted = await store.load(submitted.id, caller);
  assert.deepEqual(persisted.history.map(message => message.messageId), ['message-A', 'message-B']);
  assert.deepEqual(persisted.artifacts.map(artifact => artifact.artifactId), ['artifact-B']);
  assert.equal(model.rows.get(submitted.id).revision, 2);
});
