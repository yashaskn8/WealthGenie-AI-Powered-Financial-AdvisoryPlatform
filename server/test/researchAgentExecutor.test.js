import test from 'node:test';
import assert from 'node:assert/strict';
import { Role, TaskState } from '@a2a-js/sdk';
import { ResearchAgentExecutor } from '../agents/research/researchAgentServer.js';
import { stableResearchId } from '../agents/research/researchConstants.js';
import { createResearchBrief } from '../agents/research/researchSchemas.js';
import { buildResearchArtifact, hashResearchBrief } from '../agents/research/researchArtifact.js';
import { researchRequestFingerprint } from '../services/researchTaskStore.js';

test('duplicate execution for one task joins the in-flight run and does not duplicate work or events', async () => {
  let runCount = 0;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  let releaseRun;
  const runGate = new Promise(resolve => { releaseRun = resolve; });
  const executor = new ResearchAgentExecutor({
    run: async () => {
      runCount += 1;
      markStarted();
      await runGate;
      return { artifact: { artifactId: 'artifact-one', claims: [] } };
    },
    provider: {},
    documentFetcher: {},
    taskStore: { isCanceled: async () => false },
    budget: {},
  });
  const requestContext = {
    taskId: 'task-overlap',
    contextId: 'context-overlap',
    context: { user: { identity: { agentType: 'PLAN_REVIEW' } } },
    userMessage: {
      messageId: 'input-message',
      contextId: 'context-overlap',
      taskId: 'task-overlap',
      parts: [{ content: { $case: 'data', value: { query: 'public regulatory source' } } }],
    },
  };
  const events = [];
  const eventBus = { publish: event => events.push(event) };

  const first = executor.execute(requestContext, eventBus);
  await started;
  const second = executor.execute(requestContext, eventBus);
  assert.equal(runCount, 1, 'a duplicate task delivery must join, not start another provider run');

  releaseRun();
  await Promise.all([first, second]);

  assert.equal(runCount, 1);
  assert.equal(events.length, 4, 'the shared event bus must receive one lifecycle and artifact sequence');
  assert.equal(executor.inFlight.size, 0);
  assert.equal(executor.activeTasks.size, 0);
});

test('invalid research input returns a terminal failed Task instead of an unassociated execution error', async () => {
  let runCount = 0;
  const events = [];
  const executor = new ResearchAgentExecutor({
    run: async () => { runCount += 1; throw new Error('invalid input must not reach research'); },
    taskStore: { isCanceled: async () => false },
  });

  await executor.execute({
    taskId: 'task-invalid-input',
    contextId: 'context-invalid-input',
    context: { user: { identity: { agentType: 'PLAN_REVIEW' } } },
    userMessage: {
      messageId: 'message-invalid-input',
      role: Role.ROLE_USER,
      contextId: 'context-invalid-input',
      taskId: 'task-invalid-input',
      parts: [{ content: { $case: 'text', value: 'A generic message without a structured research brief.' } }],
    },
  }, { publish: event => events.push(event) });

  assert.equal(runCount, 0, 'unstructured text must not be converted into fabricated research evidence');
  assert.equal(events.length, 2);
  assert.equal(events[0].data.id, 'task-invalid-input');
  assert.equal(events[0].data.status.state, TaskState.TASK_STATE_SUBMITTED);
  assert.equal(events[1].data.status.state, TaskState.TASK_STATE_FAILED);
  assert.match(events[1].data.status.message.parts[0].content.value, /A2A_TASK_RECOVERY_INPUT_UNAVAILABLE/);
});

test('recovery execution persists one deterministic artifact and completes the durable task', async () => {
  const task = {
    id: 'task-recovery',
    contextId: 'context-recovery',
    status: { state: TaskState.TASK_STATE_WORKING, timestamp: new Date().toISOString() },
    history: [{
      messageId: 'message-recovery',
      role: Role.ROLE_USER,
      contextId: 'context-recovery',
      taskId: 'task-recovery',
      parts: [{ content: { $case: 'data', value: { researchBriefId: 'brief-recovery', topic: 'official research', question: 'Find the current public fact', jurisdiction: 'IN', asOf: new Date().toISOString() } } }],
    }],
    artifacts: [],
    metadata: { agentType: 'FINANCIAL_RESEARCH' },
  };
  let persisted;
  let claimed = false;
  const store = {
    durable: true,
    leaseMs: 3_000,
    claimNextRecoverable: async () => {
      if (claimed) return null;
      claimed = true;
      return { task: structuredClone(task), taskId: task.id, lease: { token: 'recovery-token', fence: 2, messageId: 'message-recovery' } };
    },
    renewClaimedExecutionLease: async () => true,
    saveClaimed: async updated => { persisted = structuredClone(updated); },
  };
  const executor = new ResearchAgentExecutor({
    run: async input => ({ artifact: { artifactId: input.artifactId, taskId: input.taskId, financialAuthorityDelta: 0 } }),
    provider: {},
    documentFetcher: {},
    taskStore: store,
  });

  assert.equal(await executor.recoverOne(), true);
  assert.equal(await executor.recoverOne(), false);
  assert.equal(persisted.status.state, TaskState.TASK_STATE_COMPLETED);
  assert.equal(persisted.artifacts.length, 1);
  assert.equal(persisted.artifacts[0].artifactId, stableResearchId('A', 'task-recovery'));
  assert.equal(persisted.artifacts[0].metadata.financialAuthorityDelta, 0);
  assert.equal(executor.inFlight.size, 0);
});

test('durable execution persists the lease-fenced terminal result before publishing success', async () => {
  const task = {
    id: 'task-durable-success',
    contextId: 'context-durable-success',
    status: { state: TaskState.TASK_STATE_SUBMITTED, timestamp: new Date().toISOString() },
    history: [],
    artifacts: [],
    metadata: { agentType: 'FINANCIAL_RESEARCH' },
  };
  const userMessage = {
    messageId: 'message-durable-success',
    role: Role.ROLE_USER,
    contextId: task.contextId,
    taskId: task.id,
    parts: [{ content: { $case: 'data', value: { researchBriefId: 'brief-durable-success' } } }],
  };
  task.history.push(userMessage);
  let terminalCommitObserved = false;
  let persistedTask;
  const events = [];
  const lease = { token: 'worker-token', fence: 1, messageId: userMessage.messageId };
  const store = {
    durable: true,
    leaseMs: 3_000,
    prepareAndClaim: async () => ({ task: structuredClone(task), lease }),
    saveClaimed: async committed => {
      assert.equal(committed.status.state, TaskState.TASK_STATE_COMPLETED);
      assert.equal(committed.artifacts.length, 1);
      terminalCommitObserved = true;
      persistedTask = structuredClone(committed);
    },
    forgetExecutionLease: () => {},
  };
  const executor = new ResearchAgentExecutor({
    run: async input => ({ artifact: { artifactId: input.artifactId, taskId: input.taskId, financialAuthorityDelta: 0 } }),
    provider: {},
    documentFetcher: {},
    taskStore: store,
  });
  const eventBus = { publish: event => events.push({ event, afterTerminalCommit: terminalCommitObserved }) };

  await executor.execute({
    taskId: task.id,
    contextId: task.contextId,
    task: structuredClone(task),
    context: { user: { identity: { agentType: 'PLAN_REVIEW' } } },
    userMessage,
  }, eventBus);

  assert.equal(persistedTask.status.state, TaskState.TASK_STATE_COMPLETED);
  assert.ok(events.slice(2).length >= 2, 'artifact and completion events are emitted');
  assert.ok(events.slice(2).every(item => item.afterTerminalCommit), 'no client-visible success precedes the durable terminal commit');
  assert.equal(events.length, 4, 'one lifecycle pair and one persisted result pair are emitted');
});

test('semantic replay creates a new task-bound verified artifact without running research again', async () => {
  const sourceBrief = createResearchBrief({
    researchBriefId: 'source-brief',
    topic: 'Official current public rule',
    question: 'Verify the current official public financial rule',
    requestedFactTypes: ['statutory_rule'],
  });
  const targetBrief = {
    ...sourceBrief,
    researchBriefId: 'target-brief',
  };
  const sourceTask = {
    id: 'source-task',
    contextId: 'source-context',
    status: { state: TaskState.TASK_STATE_COMPLETED, timestamp: new Date().toISOString() },
    history: [{ role: Role.ROLE_USER, messageId: 'source-message', parts: [{ content: { $case: 'data', value: sourceBrief } }] }],
    artifacts: [{
      artifactId: 'source-artifact',
      parts: [{ content: { $case: 'data', value: buildResearchArtifact({ brief: sourceBrief, taskId: 'source-task', artifactId: 'source-artifact' }) } }],
    }],
  };
  const requestContext = {
    taskId: 'target-task',
    contextId: 'target-context',
    context: { user: { identity: { agentType: 'PLAN_REVIEW' } } },
    userMessage: {
      role: Role.ROLE_USER,
      messageId: 'target-message',
      contextId: 'target-context',
      taskId: 'target-task',
      parts: [{ content: { $case: 'data', value: targetBrief } }],
    },
  };
  const fingerprint = researchRequestFingerprint(targetBrief);
  let researchRuns = 0;
  let persistedReplay;
  const store = {
    durable: true,
    prepareAndClaim: async () => ({ semanticDuplicateTaskId: sourceTask.id, requestFingerprint: fingerprint }),
    load: async taskId => taskId === sourceTask.id ? structuredClone(sourceTask) : undefined,
    createSemanticReplay: async value => { persistedReplay = structuredClone(value.task); return persistedReplay; },
    retireSemanticDeduplication: async () => assert.fail('a verified semantic replay should remain reusable'),
  };
  const executor = new ResearchAgentExecutor({
    run: async () => { researchRuns += 1; throw new Error('the duplicate must not rerun research'); },
    taskStore: store,
  });
  const events = [];
  await executor.execute(requestContext, { publish: event => events.push(event) });

  const artifact = persistedReplay.artifacts[0].parts[0].content.value;
  assert.equal(researchRuns, 0);
  assert.equal(persistedReplay.id, requestContext.taskId);
  assert.equal(artifact.taskId, requestContext.taskId);
  assert.equal(artifact.researchBriefId, targetBrief.researchBriefId);
  assert.equal(artifact.researchBriefHash, hashResearchBrief(targetBrief));
  assert.equal(artifact.parentArtifactId, 'source-artifact');
  assert.equal(artifact.financialAuthorityDelta, 0);
  assert.equal(persistedReplay.artifacts[0].metadata.deduplicatedFromTaskId, sourceTask.id);
  assert.equal(persistedReplay.status.state, TaskState.TASK_STATE_COMPLETED);
  assert.equal(events.length, 2, 'the persisted alias publishes exactly the task and terminal status');
});

test('distributed capacity saturation returns a durable submitted task without starting local work', async () => {
  const task = {
    id: 'queued-capacity-task',
    contextId: 'queued-capacity-context',
    status: { state: TaskState.TASK_STATE_SUBMITTED, timestamp: new Date().toISOString() },
    history: [],
    artifacts: [],
  };
  let runCount = 0;
  const events = [];
  const executor = new ResearchAgentExecutor({
    run: async () => { runCount += 1; throw new Error('capacity-full task must remain queued'); },
    taskStore: {
      durable: true,
      prepareAndClaim: async () => ({ capacityUnavailable: true, task }),
    },
  });
  await executor.execute({
    taskId: task.id,
    contextId: task.contextId,
    context: { user: { identity: { agentType: 'PLAN_REVIEW' } } },
    userMessage: { messageId: 'queued-message', parts: [] },
  }, { publish: event => events.push(event) });
  assert.equal(runCount, 0);
  assert.equal(events.length, 2);
  assert.equal(events[0].data.id, task.id);
  assert.equal(events[1].data.status.state, TaskState.TASK_STATE_SUBMITTED);
});

test('recovery batches are deterministically bounded', async () => {
  const executor = new ResearchAgentExecutor({ taskStore: { durable: true } });
  let attempts = 0;
  executor.recoverOne = async () => { attempts += 1; return true; };
  assert.equal(await executor.recoverBatch(3), 3);
  assert.equal(attempts, 3);
  assert.equal(await executor.recoverBatch(1000), 25, 'even a misconfigured limit is bounded');
  assert.equal(attempts, 28);
});
