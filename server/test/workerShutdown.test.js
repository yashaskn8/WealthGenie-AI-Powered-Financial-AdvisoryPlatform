import assert from 'node:assert/strict';
import test from 'node:test';
import { awaitWithinShutdownDeadline, closeWorkerInfrastructure } from '../worker.js';

function deterministicTimer() {
  let callback;
  return {
    setTimer(fn) { callback = fn; return { unref() {} }; },
    clearTimer() { callback = null; },
    expire() { const fn = callback; callback = null; fn?.(); },
  };
}

test('the single shutdown deadline bounds a hung PlanHealth scan before closing shared dependencies', async () => {
  const timer = deterministicTimer();
  let workerStopCalled = false;
  let dependencyCloseCalled = false;
  const pending = closeWorkerInfrastructure({ agentPlanReview: { shutdownGraceMs: 20000 } }, {
    stopPlanHealthScheduler: () => new Promise(() => {}),
    worker: { async stop() { workerStopCalled = true; return { drained: true }; } },
    healthServer: { async close() { dependencyCloseCalled = true; } },
    mongoConnection: { readyState: 1, async close() { dependencyCloseCalled = true; } },
    redisClient: null,
    tracingSdk: { async shutdown() { dependencyCloseCalled = true; } },
    clock: () => 100,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });
  assert.equal(workerStopCalled, true, 'PlanReview drain starts concurrently and is not held behind PlanHealth');
  timer.expire();
  await assert.rejects(pending, error => error.code === 'AGENT_WORKER_SHUTDOWN_DEADLINE');
  assert.equal(dependencyCloseCalled, false, 'shared persistence is not closed while durable work may still be running');
});

test('shutdown deadline wrapper accepts completed work without waiting for its timeout', async () => {
  const timer = deterministicTimer();
  const value = await awaitWithinShutdownDeadline(
    Promise.resolve('drained'),
    500,
    'test drain',
    { clock: () => 100, setTimer: timer.setTimer, clearTimer: timer.clearTimer },
  );
  assert.equal(value, 'drained');
});
