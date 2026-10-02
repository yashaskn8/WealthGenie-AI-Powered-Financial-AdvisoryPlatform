import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMarketContextRefreshDelay,
  MARKET_CONTEXT_CLOSED_REFRESH_MS,
  MARKET_CONTEXT_HOLIDAY_REFRESH_MS,
  MARKET_CONTEXT_OPEN_REFRESH_MS,
  collectAmfiPersistenceFailures,
  refreshAmfiSnapshots,
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

test('scheduled AMFI refresh remains the forced durable persistence owner', async () => {
  const calls = [];
  const infoEvents = [];
  const errorEvents = [];
  const result = await refreshAmfiSnapshots({
    fetchCurrent: async options => {
      calls.push(['current', options]);
      return { status: 'AVAILABLE', productCount: 14_366, persistence: { status: 'PERSISTED' } };
    },
    fetchHistorical: async options => {
      calls.push(['historical', options]);
      return { status: 'AVAILABLE', productCount: 8_275, persistence: { status: 'PERSISTED' } };
    },
    log: {
      info: (message, fields) => infoEvents.push([message, fields]),
      error: (message, fields) => errorEvents.push([message, fields]),
    },
  });

  assert.deepEqual(calls, [
    ['current', { forceRefresh: true }],
    ['historical', { forceRefresh: true }],
  ]);
  assert.equal(result.current.persistence.status, 'PERSISTED');
  assert.equal(result.historical.persistence.status, 'PERSISTED');
  assert.equal(infoEvents.length, 1);
  assert.equal(infoEvents[0][1].persistenceOwner, 'SCHEDULED_REFRESH');
  assert.equal(infoEvents[0][1].currentPersistenceStatus, 'PERSISTED');
  assert.equal(errorEvents.length, 0);
});

test('scheduled refresh reports durable-write failures without reporting success', async () => {
  const infoEvents = [];
  const errorEvents = [];
  await refreshAmfiSnapshots({
    fetchCurrent: async () => ({
      status: 'AVAILABLE',
      persistence: {
        status: 'PERSISTENCE_ERROR',
        error: { code: 'MARKET_PERSISTENCE_FAILED', message: 'private storage diagnostic' },
      },
    }),
    fetchHistorical: async () => ({ status: 'SOURCE_ERROR', persistence: { status: 'NOT_PERSISTED' } }),
    log: {
      info: (...args) => infoEvents.push(args),
      error: (...args) => errorEvents.push(args),
    },
  });

  assert.equal(infoEvents.length, 0);
  assert.equal(errorEvents.length, 1);
  assert.equal(errorEvents[0][0], 'AMFI refresh completed without durable persistence');
  assert.equal(errorEvents[0][1].persistenceFailures[0].persistenceStatus, 'PERSISTENCE_ERROR');
  assert.equal(errorEvents[0][1].persistenceFailures[0].code, 'MARKET_PERSISTENCE_FAILED');
  assert.equal(JSON.stringify(errorEvents).includes('private storage diagnostic'), false);
});

test('manual refresh can distinguish durable AMFI failures from unavailable source snapshots', () => {
  const failures = collectAmfiPersistenceFailures(
    {
      status: 'AVAILABLE',
      persistence: {
        status: 'PERSISTENCE_ERROR',
        error: { code: 'MARKET_PERSISTENCE_FAILED', message: 'sensitive database detail' },
      },
    },
    { status: 'SOURCE_ERROR', persistence: { status: 'NOT_PERSISTED' } },
  );

  assert.deepEqual(failures, [{
    snapshotKind: 'current',
    persistenceStatus: 'PERSISTENCE_ERROR',
    code: 'MARKET_PERSISTENCE_FAILED',
  }]);
  assert.equal(JSON.stringify(failures).includes('sensitive database detail'), false);
  assert.deepEqual(collectAmfiPersistenceFailures(
    { status: 'SOURCE_ERROR', persistence: { status: 'NOT_PERSISTED' } },
    { status: 'UNAVAILABLE', persistence: { status: 'NOT_PERSISTED' } },
  ), []);
});
