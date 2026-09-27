import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getRuntimeConfig } from '../config/runtime.js';
import { createMcpCapacityController, McpCapacityError } from '../mcp/mcpCapacity.js';
import { createMcpRuntime } from '../mcp/mcpRuntime.js';

function testConfig(overrides = {}) {
  const base = getRuntimeConfig({ NODE_ENV: 'test' }).mcp;
  return { ...base, ...overrides };
}

describe('MCP capacity fail-closed and lease controls', () => {
  it('bounds per-user requests and local concurrent tools without evicting active work', async () => {
    let now = 120000;
    const capacity = createMcpCapacityController({
      config: testConfig({ maxRequestsPerWindow: 1, maxConcurrentPerUser: 1 }),
      env: { NODE_ENV: 'test' },
      getRedisState: () => ({ available: false, client: null }),
      now: () => now,
    });
    await capacity.checkRequest('user-a');
    await assert.rejects(capacity.checkRequest('user-a'), error => error.code === 'MCP_CAPACITY_EXCEEDED' && error.status === 429);
    const release = await capacity.acquireToolPermit('user-a', 'sip_projection', 'LOW');
    await assert.rejects(capacity.acquireToolPermit('user-a', 'lump_sum_projection', 'LOW'), error => error.code === 'MCP_CAPACITY_EXCEEDED');
    assert.equal(await release(), true);
    assert.equal(await release(), false);
    const next = await capacity.acquireToolPermit('user-a', 'lump_sum_projection', 'LOW');
    assert.equal(await next(), true);
    now += 60001;
    await capacity.checkRequest('user-a');
  });

  it('fails closed when Redis is marked available but a capacity command fails', async () => {
    const capacity = createMcpCapacityController({
      config: testConfig(),
      env: { NODE_ENV: 'production' },
      getRedisState: () => ({ available: true, client: { isReady: true, eval: async () => { throw new Error('redis command failure'); } } }),
    });
    await assert.rejects(capacity.checkRequest('user-a'), error => error instanceof McpCapacityError && error.status === 503);
    await assert.rejects(capacity.acquireToolPermit('user-a', 'sip_projection', 'LOW'), error => error.code === 'MCP_CAPACITY_UNAVAILABLE');
  });

  it('aggregates tool-call quotas across tools in the same cost class', async () => {
    const capacity = createMcpCapacityController({
      config: testConfig({
        maxToolCallsPerWindow: { LOW: 1, MEDIUM: 2, HIGH: 1 },
        maxConcurrentPerUser: 2,
      }),
      env: { NODE_ENV: 'test' },
      getRedisState: () => ({ available: false, client: null }),
    });
    const release = await capacity.acquireToolPermit('user-a', 'sip_projection', 'LOW');
    await release();
    await assert.rejects(
      capacity.acquireToolPermit('user-a', 'lump_sum_projection', 'LOW'),
      error => error.code === 'MCP_CAPACITY_EXCEEDED' && error.status === 429,
    );
    const medium = await capacity.acquireToolPermit('user-a', 'tax_calculator', 'MEDIUM');
    assert.equal(await medium(), true, 'a separate cost class has its own budget');
  });

  it('requires distributed capacity in production and reports readiness truthfully', async () => {
    const capacity = createMcpCapacityController({
      config: { ...testConfig(), enabled: true, remoteEnabled: true, isProduction: true },
      env: { NODE_ENV: 'production' },
      getRedisState: () => ({ available: false, client: null }),
    });
    assert.equal(capacity.isReady(), false);
    await assert.rejects(capacity.checkRequest('user-a'), error => error.status === 503);
  });

  it('does not release a newer Redis lease when an expired permit resumes late', async () => {
    let now = 1000;
    const sets = new Map();
    const rateCounts = new Map();
    const fakeRedis = {
      isReady: true,
      async eval(script, { keys, arguments: args }) {
        if (script.includes("redis.call('INCR'")) {
          const count = (rateCounts.get(keys[0]) || 0) + 1;
          rateCounts.set(keys[0], count);
          return [count, 60000];
        }
        if (script.includes("redis.call('ZSCORE'")) {
          const user = sets.get(keys[0]) || new Map();
          const global = sets.get(keys[1]) || new Map();
          const [token, ttl] = args;
          if (user.get(token) !== global.get(token) || Number(user.get(token)) <= now) return 0;
          const expiry = now + Number(ttl);
          user.set(token, expiry);
          global.set(token, expiry);
          sets.set(keys[0], user);
          sets.set(keys[1], global);
          return 1;
        }
        if (script.includes("local redisTime = redis.call('TIME')")) {
          const maxUser = Number(args[0]);
          const maxGlobal = Number(args[1]);
          const expiry = now + Number(args[2]);
          const token = args[3];
          const user = sets.get(keys[0]) || new Map();
          const global = sets.get(keys[1]) || new Map();
          for (const [member, score] of user) if (score <= now) user.delete(member);
          for (const [member, score] of global) if (score <= now) global.delete(member);
          if (user.size >= maxUser || global.size >= maxGlobal) return 0;
          user.set(token, Number(expiry));
          global.set(token, Number(expiry));
          sets.set(keys[0], user); sets.set(keys[1], global);
          return 1;
        }
        const [token] = args;
        let removed = 0;
        for (const key of keys) {
          const entries = sets.get(key) || new Map();
          removed = Math.max(removed, entries.delete(token) ? 1 : 0);
        }
        return removed;
      },
    };
    const capacity = createMcpCapacityController({
      config: testConfig({ maxConcurrentPerUser: 1, permitTtlMs: 100 }),
      env: { NODE_ENV: 'production' },
      getRedisState: () => ({ available: true, client: fakeRedis }),
      now: () => now,
      keyPrefix: 'wg:{mcp}:phase6-test:',
    });
    const releaseOld = await capacity.acquireToolPermit('user-a', 'sip_projection', 'LOW');
    now = 1200;
    const releaseNew = await capacity.acquireToolPermit('user-a', 'sip_projection', 'LOW');
    assert.equal(await releaseOld(), false);
    assert.equal([...sets.values()][0].size, 1);
    assert.equal(await releaseNew(), true);
  });

  it('renews distributed capacity leases past their initial expiry while retaining token fencing', async () => {
    let now = 1000;
    let heartbeat;
    let signalRenewed;
    const renewed = new Promise(resolve => { signalRenewed = resolve; });
    const sets = new Map();
    const rates = new Map();
    const fakeRedis = {
      isReady: true,
      async eval(script, { keys, arguments: args }) {
        if (script.includes("redis.call('INCR'")) {
          const count = (rates.get(keys[0]) || 0) + 1;
          rates.set(keys[0], count);
          return [count, 60000, `${keys[0]}:window`];
        }
        if (script.includes("redis.call('ZSCORE'")) {
          const [token, ttl] = args;
          const user = sets.get(keys[0]) || new Map();
          const global = sets.get(keys[1]) || new Map();
          if (user.get(token) !== global.get(token) || Number(user.get(token)) <= now) return 0;
          const expiry = now + Number(ttl);
          user.set(token, expiry);
          global.set(token, expiry);
          sets.set(keys[0], user);
          sets.set(keys[1], global);
          signalRenewed();
          return 1;
        }
        if (script.includes('ZREMRANGEBYSCORE')) {
          const [,, ttl, token] = args;
          const expiry = now + Number(ttl);
          for (const key of keys) {
            const entries = sets.get(key) || new Map();
            for (const [member, score] of entries) if (score <= now) entries.delete(member);
            entries.set(token, expiry);
            sets.set(key, entries);
          }
          return 1;
        }
        const [token] = args;
        let removed = 0;
        for (const key of keys) removed = Math.max(removed, sets.get(key)?.delete(token) ? 1 : 0);
        return removed;
      },
    };
    const capacity = createMcpCapacityController({
      config: testConfig({ maxConcurrentPerUser: 1, permitTtlMs: 1000 }),
      env: { NODE_ENV: 'production' },
      getRedisState: () => ({ available: true, client: fakeRedis }),
      now: () => now,
      scheduleHeartbeat(callback) { heartbeat = callback; return { unref() {} }; },
      cancelHeartbeat() {},
      keyPrefix: 'wg:{mcp}:renewal-contract:',
    });
    const release = await capacity.acquireToolPermit('user-a', 'sip_projection', 'LOW');
    now = 1800;
    heartbeat();
    await renewed;
    const owned = [...sets.values()].filter(entries => entries.has(release.token));
    assert.equal(owned.length, 2);
    assert.ok(owned.every(entries => entries.get(release.token) === 2800));
    assert.equal(await release(), true);
  });

  it('keeps readiness down when Redis revocation GET or a required EVAL fails', async () => {
    const clients = [
      { isReady: true, async get() { throw new Error('GET denied'); }, async eval() { return [1, 60000, 'rate-key']; }, async del() {} },
      { isReady: true, async get() { return null; }, async eval() { throw new Error('EVAL denied'); }, async del() {} },
    ];
    for (const [index, client] of clients.entries()) {
      const capacity = createMcpCapacityController({
        config: { ...testConfig(), enabled: true, remoteEnabled: true, isProduction: true },
        env: { NODE_ENV: 'production' },
        getRedisState: () => ({ available: true, client }),
        keyPrefix: `wg:{mcp}:readiness-test-${index}:`,
      });
      assert.equal(await capacity.probe(), false);
      assert.equal(capacity.isReady(), false);
    }
  });
});

describe('MCP request lifecycle and cancellation', () => {
  it('cancels a client-facing result immediately but holds active accounting until work settles', async () => {
    const runtime = createMcpRuntime({ toolTimeoutMs: 60000, shutdownGraceMs: 100 });
    runtime.markReady();
    const parent = new AbortController();
    let finish;
    let markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    const operation = runtime.startTool(() => new Promise(resolve => {
      finish = resolve;
      markStarted();
    }), parent.signal);
    await started;
    parent.abort(Object.assign(new Error('client disconnected'), { code: 'MCP_CLIENT_CANCELLED' }));
    await assert.rejects(operation.result, error => error.code === 'MCP_CLIENT_CANCELLED');
    assert.equal(runtime.snapshot().activeTools, 1, 'permit/accounting stays held while uncancellable work remains');
    finish('settled');
    await operation.settled;
    assert.equal(runtime.snapshot().activeTools, 0);
    await runtime.drain({ graceMs: 0 });
    assert.equal(runtime.isReady(), false);
    assert.throws(() => runtime.acquireRequest(), error => error.code === 'MCP_DRAINING');
  });

  it('does not start an executor when its parent request is already aborted', async () => {
    const runtime = createMcpRuntime({ toolTimeoutMs: 60000 });
    runtime.markReady();
    const parent = new AbortController();
    parent.abort(Object.assign(new Error('aborted'), { code: 'MCP_CLIENT_CANCELLED' }));
    let started = false;
    const operation = runtime.startTool(() => { started = true; }, parent.signal);
    await assert.rejects(operation.result);
    await operation.settled.catch(() => {});
    assert.equal(started, false);
    assert.equal(runtime.snapshot().activeTools, 0);
    await runtime.drain({ graceMs: 0 });
  });
});
