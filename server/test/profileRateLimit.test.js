import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeProfileBuildQuota,
  PROFILE_BUILD_RATE_LIMIT_SCRIPT,
} from '../services/profileRateLimit.js';

test('profile quota increments and sets its expiry atomically in one Redis script', async () => {
  let invocation;
  const allowed = await consumeProfileBuildQuota('user-1', {
    available: true,
    client: {
      async eval(script, options) {
        invocation = { script, options };
        return 3;
      },
    },
  });
  assert.equal(allowed, true);
  assert.equal(invocation.script, PROFILE_BUILD_RATE_LIMIT_SCRIPT);
  assert.deepEqual(invocation.options, {
    keys: ['profile:ratelimit:user-1'],
    arguments: ['3600'],
  });
  assert.match(invocation.script, /INCR/);
  assert.match(invocation.script, /EXPIRE/);
});

test('profile quota rejects after the configured limit is exhausted', async () => {
  const allowed = await consumeProfileBuildQuota('user-1', {
    available: true,
    limit: 2,
    client: { async eval() { return 3; } },
  });
  assert.equal(allowed, false);
});

test('profile quota fails closed when Redis is unavailable or its command fails', async t => {
  await t.test('unavailable client', async () => {
    await assert.rejects(
      consumeProfileBuildQuota('user-1', { available: false, client: null }),
      error => error.status === 503 && error.code === 'PROFILE_RATE_LIMIT_UNAVAILABLE',
    );
  });
  await t.test('command exception', async () => {
    await assert.rejects(
      consumeProfileBuildQuota('user-1', {
        available: true,
        client: { async eval() { throw new Error('redis unavailable'); } },
      }),
      error => error.status === 503 && error.code === 'PROFILE_RATE_LIMIT_UNAVAILABLE',
    );
  });
  await t.test('invalid response', async () => {
    await assert.rejects(
      consumeProfileBuildQuota('user-1', {
        available: true,
        client: { async eval() { return 'not-a-count'; } },
      }),
      error => error.status === 503 && error.code === 'PROFILE_RATE_LIMIT_UNAVAILABLE',
    );
  });
});
