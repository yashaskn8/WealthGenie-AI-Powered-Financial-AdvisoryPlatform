import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createHealthRouter } from '../routes/health.js';
import { assertFetchResponseMatchesOpenApi } from './helpers/openapiRuntimeContract.js';

async function withVerificationServer(options, callback) {
  const app = express();
  app.use('/health', createHealthRouter(options));
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('runtime verification reports only the running process build and connected dependency capabilities', async () => {
  await withVerificationServer({
    requireRedis: true,
    timeoutMs: 100,
    verificationTimeoutMs: 100,
    buildSha: 'A'.repeat(40),
    verifyMongoTransaction: async () => true,
    verifyRedisConnection: async () => true,
    isMongoConnected: () => true,
  }, async baseUrl => {
    const response = await fetch(`${baseUrl}/health/verification`);
    const body = await assertFetchResponseMatchesOpenApi(response, 'GET', '/health/verification');
    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      status: 'VERIFIED',
      buildSha: 'a'.repeat(40),
      mongo: { connected: true, transactionCapable: true, databaseIdentityVerified: false },
      redis: { required: true, connected: true },
      marketProvider: 'NSE',
      marketProviderTokenPresent: true,
    });
    assert.doesNotMatch(JSON.stringify(body), /mongodb|redis:\/\/|password|credential|secret/i);
  });
});

test('runtime verification fails closed when the connected Mongo or required Redis probe fails', async () => {
  await withVerificationServer({
    requireRedis: true,
    timeoutMs: 100,
    verificationTimeoutMs: 100,
    buildSha: 'b'.repeat(40),
    verifyMongoTransaction: async () => false,
    verifyRedisConnection: async () => false,
    isMongoConnected: () => true,
  }, async baseUrl => {
    const response = await fetch(`${baseUrl}/health/verification`);
    const body = await assertFetchResponseMatchesOpenApi(response, 'GET', '/health/verification');
    assert.equal(response.status, 503);
    assert.equal(body.status, 'NOT_VERIFIED');
    assert.deepEqual(body.mongo, { connected: true, transactionCapable: false, databaseIdentityVerified: false });
    assert.deepEqual(body.redis, { required: true, connected: false });
  });
});

test('runtime verification puts a deterministic deadline around an unresponsive Redis probe', async () => {
  await withVerificationServer({
    requireRedis: true,
    timeoutMs: 30,
    verificationTimeoutMs: 30,
    buildSha: 'c'.repeat(40),
    verifyMongoTransaction: async () => true,
    verifyRedisConnection: async () => new Promise(() => {}),
    isMongoConnected: () => true,
  }, async baseUrl => {
    const response = await fetch(`${baseUrl}/health/verification`, { signal: AbortSignal.timeout(1000) });
    const body = await assertFetchResponseMatchesOpenApi(response, 'GET', '/health/verification');
    assert.equal(response.status, 503);
    assert.equal(body.redis.connected, false);
  });
});

test('optional Redis is reported truthfully without making runtime verification fail', async () => {
  let redisCalled = false;
  await withVerificationServer({
    requireRedis: false,
    timeoutMs: 100,
    verificationTimeoutMs: 100,
    buildSha: 'd'.repeat(40),
    verifyMongoTransaction: async () => true,
    verifyRedisConnection: async () => { redisCalled = true; return false; },
    isMongoConnected: () => true,
  }, async baseUrl => {
    const response = await fetch(`${baseUrl}/health/verification`);
    const body = await assertFetchResponseMatchesOpenApi(response, 'GET', '/health/verification');
    assert.equal(response.status, 200);
    assert.equal(body.redis.required, false);
    assert.equal(body.redis.connected, false);
  });
  assert.equal(redisCalled, true);
});

test('demo database verification is exact, rejects reserved/mismatched names before transaction probing, and does not expose the name', async t => {
  const scenarios = [
    { label: 'exact isolated database', configured: 'wealthgenie_demo', actual: 'wealthgenie_demo', requested: 'wealthgenie_demo', expectedStatus: 200, expectedIdentity: true, expectedTransactionCalls: 1 },
    { label: 'actual database differs', configured: 'wealthgenie_demo', actual: 'test', requested: 'wealthgenie_demo', expectedStatus: 503, expectedIdentity: false, expectedTransactionCalls: 0 },
    { label: 'backend and preflight expectations differ', configured: 'wealthgenie_demo', actual: 'wealthgenie_demo', requested: 'other_demo', expectedStatus: 503, expectedIdentity: false, expectedTransactionCalls: 0 },
    { label: 'reserved default database', configured: 'test', actual: 'test', requested: 'test', expectedStatus: 503, expectedIdentity: false, expectedTransactionCalls: 0 },
    { label: 'missing expected database signaled with empty header', configured: undefined, actual: 'test', requested: '', expectedStatus: 503, expectedIdentity: false, expectedTransactionCalls: 0 },
    { label: 'missing actual database identity', configured: 'wealthgenie_demo', actual: null, requested: 'wealthgenie_demo', expectedStatus: 503, expectedIdentity: false, expectedTransactionCalls: 0 },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.label, async () => {
      let transactionCalls = 0;
      await withVerificationServer({
        requireRedis: false,
        timeoutMs: 100,
        verificationTimeoutMs: 100,
        expectedDemoDatabase: scenario.configured,
        verifyMongoTransaction: async () => { transactionCalls += 1; return true; },
        verifyRedisConnection: async () => false,
        isMongoConnected: () => true,
        getMongoDatabaseName: () => scenario.actual,
      }, async baseUrl => {
        const response = await fetch(`${baseUrl}/health/verification`, {
          headers: { 'X-Demo-Expected-Mongodb-Database': scenario.requested },
        });
        const body = await assertFetchResponseMatchesOpenApi(response, 'GET', '/health/verification');
        assert.equal(response.status, scenario.expectedStatus);
        assert.equal(body.mongo.databaseIdentityVerified, scenario.expectedIdentity);
        assert.doesNotMatch(JSON.stringify(body), /wealthgenie_demo|other_demo|mongodb|password|credential|secret/i);
      });
      assert.equal(transactionCalls, scenario.expectedTransactionCalls);
    });
  }
});
