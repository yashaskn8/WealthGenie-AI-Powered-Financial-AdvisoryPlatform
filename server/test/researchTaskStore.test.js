import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskState } from '@a2a-js/sdk';
import { MongoResearchTaskStore, mergeResearchTask } from '../services/researchTaskStore.js';

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
