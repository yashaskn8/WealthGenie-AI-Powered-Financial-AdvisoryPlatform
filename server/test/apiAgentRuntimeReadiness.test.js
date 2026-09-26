import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyEnabledApiAgentPersistence } from '../server.js';

test('API startup verifies Phase 5 queue persistence only when PlanReview is enabled', async () => {
  const calls = [];
  const result = await verifyEnabledApiAgentPersistence({ agenticPlanReviewEnabled: true, planHealth: { enabled: false } }, async options => {
    calls.push(options);
    return { ready: true };
  });

  assert.deepEqual(calls, [{ force: true }]);
  assert.deepEqual(result, { ready: true });
});

test('API startup fails before listening when queue admission persistence is missing', async () => {
  await assert.rejects(
    verifyEnabledApiAgentPersistence({ agenticPlanReviewEnabled: true }, async () => {
      throw Object.assign(new Error('queue admission missing'), { code: 'AGENT_QUEUE_ADMISSION_UNAVAILABLE' });
    }),
    error => error.code === 'AGENT_QUEUE_ADMISSION_UNAVAILABLE',
  );
});

test('API startup does not require Phase 5 queue persistence when PlanReview is disabled', async () => {
  let called = false;
  const result = await verifyEnabledApiAgentPersistence({ agenticPlanReviewEnabled: false, planHealth: { enabled: false } }, async () => {
    called = true;
    throw new Error('must not run');
  });

  assert.equal(called, false);
  assert.deepEqual(result, { ready: true, skipped: true });
});
