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
