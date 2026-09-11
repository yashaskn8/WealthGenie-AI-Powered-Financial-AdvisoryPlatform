import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMarketContextRefreshDelay,
  MARKET_CONTEXT_CLOSED_REFRESH_MS,
  MARKET_CONTEXT_HOLIDAY_REFRESH_MS,
  MARKET_CONTEXT_OPEN_REFRESH_MS,
  withMarketRefreshLease,
} from '../jobs/marketDataRefresh.js';
import {
  releaseCacheNX,
  setCacheNX,
  setRedisAvailable,
  setRedisClient,
} from '../config/redis.js';

function resultForSession(status) {
  return { marketSnapshot: { marketSession: { status } } };
}

test('market context refresh cadence stays inside the open-session age contract', () => {
  assert.equal(
    getMarketContextRefreshDelay(resultForSession('MARKET_OPEN')),
    MARKET_CONTEXT_OPEN_REFRESH_MS,
  );
  assert.ok(MARKET_CONTEXT_OPEN_REFRESH_MS < 15 * 60 * 1000);
  assert.ok(MARKET_CONTEXT_OPEN_REFRESH_MS >= 5 * 60 * 1000);
});

test('market context refresh cadence backs off outside an active session', () => {
  assert.equal(
    getMarketContextRefreshDelay(resultForSession('MARKET_CLOSED')),
    MARKET_CONTEXT_CLOSED_REFRESH_MS,
  );
  assert.equal(
    getMarketContextRefreshDelay(resultForSession('MARKET_HOLIDAY')),
    MARKET_CONTEXT_HOLIDAY_REFRESH_MS,
  );
  assert.equal(
    getMarketContextRefreshDelay(resultForSession('UNKNOWN')),
    MARKET_CONTEXT_CLOSED_REFRESH_MS,
  );
});

function createLeaseRedisClient() {
  const values = new Map();

  function removeExpired(key) {
    const entry = values.get(key);
    if (entry && entry.expiresAt <= Date.now()) values.delete(key);
    return values.get(key);
  }

  return {
    async set(key, value, options = {}) {
      if (removeExpired(key) && options.NX) return null;
      values.set(key, {
        value,
        expiresAt: Date.now() + (Number(options.EX) * 1000),
      });
      return 'OK';
    },
    async eval(_script, { keys, arguments: args }) {
      const entry = removeExpired(keys[0]);
      if (entry?.value !== args[0]) return 0;
      values.delete(keys[0]);
      return 1;
    },
    values,
  };
}

test.afterEach(() => {
  setRedisAvailable(false);
  setRedisClient(null);
});

test('distributed market refresh lease allows one replica and skips the duplicate', async () => {
  const client = createLeaseRedisClient();
  setRedisClient(client);
  setRedisAvailable(true);

  let firstStarted;
  const firstStartedPromise = new Promise(resolve => { firstStarted = resolve; });
  let releaseFirst;
  const releaseFirstPromise = new Promise(resolve => { releaseFirst = resolve; });
  let executions = 0;

  const first = withMarketRefreshLease('Primary Market Context', async () => {
    executions += 1;
    firstStarted();
    await releaseFirstPromise;
    return 'first';
  });
  await firstStartedPromise;

  const second = await withMarketRefreshLease('Primary Market Context', async () => {
    executions += 1;
    return 'second';
  });

  assert.equal(second, null);
  assert.equal(executions, 1);
  releaseFirst();
  assert.equal(await first, 'first');
});

test('distributed market refresh lease uses ownership-safe release and expiry recovery', async () => {
  const client = createLeaseRedisClient();
  setRedisClient(client);
  setRedisAvailable(true);

  assert.equal(await setCacheNX('test:market-refresh', 'owner-a', 1), true);
  assert.equal(await releaseCacheNX('test:market-refresh', 'owner-b'), false);
  assert.equal(await releaseCacheNX('test:market-refresh', 'owner-a'), true);

  assert.equal(await setCacheNX('test:market-refresh', 'owner-a', 1), true);
  await new Promise(resolve => setTimeout(resolve, 1_100));
  assert.equal(await setCacheNX('test:market-refresh', 'owner-b', 1), true);
});

test('production refresh skips safely when Redis cannot provide a lease', async () => {
  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  setRedisAvailable(false);
  setRedisClient(null);
  let executed = false;

  try {
    const result = await withMarketRefreshLease('AMFI NAV Refresh', async () => {
      executed = true;
    });
    assert.equal(result, null);
    assert.equal(executed, false);
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  }
});
