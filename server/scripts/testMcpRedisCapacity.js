import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { getRuntimeConfig } from '../config/runtime.js';
import { createMcpCapacityController, McpCapacityError } from '../mcp/mcpCapacity.js';

const url = process.env.MCP_TEST_REDIS_URL;
if (!url) throw new Error('MCP_TEST_REDIS_URL is required for the Redis-backed MCP contract.');

const client = createClient({ url });
const keyPrefix = `wg:{mcp}:ci-${randomUUID()}:`;
const base = getRuntimeConfig({ NODE_ENV: 'test' }).mcp;
const config = {
  ...base,
  maxRequestsPerWindow: 2,
  maxConcurrentPerUser: 1,
  maxConcurrentGlobal: 5,
  permitTtlMs: 90000,
  toolTimeoutMs: 30000,
};
const capacity = createMcpCapacityController({
  config,
  env: { NODE_ENV: 'production' },
  keyPrefix,
  getRedisState: () => ({ available: client.isReady, client }),
});

try {
  await client.connect();
  await capacity.checkRequest('mcp-redis-contract-user');
  await capacity.checkRequest('mcp-redis-contract-user');
  await assert.rejects(capacity.checkRequest('mcp-redis-contract-user'), error => (
    error instanceof McpCapacityError && error.code === 'MCP_CAPACITY_EXCEEDED' && error.status === 429
  ));

  const active = await capacity.acquireToolPermit('mcp-redis-contract-user', 'sip_projection', 'LOW');
  await assert.rejects(capacity.acquireToolPermit('mcp-redis-contract-user', 'sip_projection', 'LOW'), error => (
    error.code === 'MCP_CAPACITY_EXCEEDED'
  ));
  assert.equal(await active(), true);
  assert.equal(await active(), false, 'release must be idempotent');

  const leaseUser = 'mcp-redis-lease-user';
  const leaseUserHash = createHash('sha256').update(leaseUser).digest('hex');
  const leaseUserKey = `${keyPrefix}concurrent:user:${leaseUserHash}`;
  const leaseGlobalKey = `${keyPrefix}concurrent:global`;
  const oldPermit = await capacity.acquireToolPermit(leaseUser, 'sip_projection', 'LOW');
  const [userMembers, globalMembers] = await Promise.all([
    client.zRange(leaseUserKey, 0, -1),
    client.zRange(leaseGlobalKey, 0, -1),
  ]);
  assert.equal(userMembers.length, 1, 'the active user permit must be present in Redis');
  assert.deepEqual(globalMembers, userMembers, 'the same permit token must fence user and global capacity');
  // Age the isolated fixture lease directly in Redis. The production Lua uses
  // Redis TIME, so advancing a process-local injected clock would not exercise
  // the real distributed expiry path.
  await Promise.all([
    client.zAdd(leaseUserKey, { score: 0, value: userMembers[0] }),
    client.zAdd(leaseGlobalKey, { score: 0, value: userMembers[0] }),
  ]);
  const newPermit = await capacity.acquireToolPermit('mcp-redis-lease-user', 'sip_projection', 'LOW');
  assert.equal(await oldPermit(), false, 'late owner must not release a reclaimed permit');
  await assert.rejects(capacity.acquireToolPermit('mcp-redis-lease-user', 'lump_sum_projection', 'LOW'), error => (
    error.code === 'MCP_CAPACITY_EXCEEDED'
  ));
  assert.equal(await newPermit(), true);
  console.log('MCP Redis capacity contract: request quotas, concurrent permits, and stale lease fencing passed.');
} finally {
  try {
    const keys = [];
    for await (const key of client.scanIterator({ MATCH: `${keyPrefix}*`, COUNT: 100 })) keys.push(key);
    if (keys.length) await client.del(keys);
  } finally {
    if (client.isOpen) await client.quit();
  }
}
