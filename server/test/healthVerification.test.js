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
      mongo: { connected: true, transactionCapable: true },
      redis: { required: true, connected: true },
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
    assert.deepEqual(body.mongo, { connected: true, transactionCapable: false });
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
