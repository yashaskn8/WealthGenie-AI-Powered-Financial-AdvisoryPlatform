import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlanReviewRateLimiter } from '../middleware/rateLimiter.js';

function response() {
  return {
    headers: {},
    statusCode: 200,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('PlanReview limiter uses shared Redis quota and rejects over-limit work', async () => {
  const counts = new Map();
  const limiter = createPlanReviewRateLimiter({
    env: { NODE_ENV: 'production' },
    max: 1,
    now: () => 1_000,
    getRedisState: () => ({
      available: true,
      client: { async eval(_script, { keys }) { const hits = (counts.get(keys[0]) || 0) + 1; counts.set(keys[0], hits); return [hits, 30_000]; } },
    }),
  });
  const req = { user: { userId: 'user-1' }, ip: '127.0.0.1', headers: {} };
  let nextCalls = 0;
  await limiter(req, response(), () => { nextCalls += 1; });
  const denied = response();
  await limiter(req, denied, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.equal(denied.statusCode, 429);
  assert.equal(denied.body.code, 'PLAN_REVIEW_RATE_LIMIT_EXCEEDED');
});

test('separate Express instances consume the same Redis quota and recover after Redis returns', async () => {
  const counts = new Map();
  let redisAvailable = true;
  const getRedisState = () => ({
    available: redisAvailable,
    client: redisAvailable ? { async eval(_script, { keys }) {
      const hits = (counts.get(keys[0]) || 0) + 1;
      counts.set(keys[0], hits);
      return [hits, 30_000];
    } } : null,
  });
  const options = { env: { NODE_ENV: 'production' }, max: 1, getRedisState };
  const instanceA = createPlanReviewRateLimiter(options);
  const instanceB = createPlanReviewRateLimiter(options);
  const req = { user: { userId: 'user-shared' }, ip: '127.0.0.1' };
  let passed = 0;
  await instanceA(req, response(), () => { passed += 1; });
  const crossInstance = response();
  await instanceB(req, crossInstance, () => { passed += 1; });
  assert.equal(passed, 1);
  assert.equal(crossInstance.statusCode, 429);

  redisAvailable = false;
  const unavailable = response();
  await instanceA(req, unavailable, () => { passed += 1; });
  assert.equal(unavailable.statusCode, 503);
  assert.equal(passed, 1);

  redisAvailable = true;
  const recovered = response();
  await instanceA({ user: { userId: 'user-recovered' }, ip: '127.0.0.1' }, recovered, () => { passed += 1; });
  assert.equal(recovered.statusCode, 200);
  assert.equal(passed, 2);
});

test('PlanReview limiter fails closed in production when Redis is absent or its command fails', async () => {
  const absent = createPlanReviewRateLimiter({ env: { NODE_ENV: 'production' }, getRedisState: () => ({ available: false, client: null }) });
  const broken = createPlanReviewRateLimiter({
    env: { NODE_ENV: 'production' },
    getRedisState: () => ({ available: true, client: { eval: async () => { throw new Error('redis write failed'); } } }),
  });
  for (const limiter of [absent, broken]) {
    const res = response();
    let nextCalls = 0;
    await limiter({ user: { userId: 'user-1' }, ip: '127.0.0.1', headers: {} }, res, () => { nextCalls += 1; });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'PLAN_REVIEW_RATE_LIMIT_UNAVAILABLE');
    assert.equal(nextCalls, 0);
  }
});

test('development fallback is bounded and production ignores DISABLE_RATE_LIMIT', async () => {
  const dev = createPlanReviewRateLimiter({ env: { NODE_ENV: 'development' }, getRedisState: () => ({ available: false }), max: 1 });
  const devReq = { user: { userId: 'user-1' }, ip: '127.0.0.1', headers: {} };
  let devNext = 0;
  await dev(devReq, response(), () => { devNext += 1; });
  const devDenied = response();
  await dev(devReq, devDenied, () => { devNext += 1; });
  assert.equal(devNext, 1);
  assert.equal(devDenied.statusCode, 429);

  const production = createPlanReviewRateLimiter({ env: { NODE_ENV: 'production', DISABLE_RATE_LIMIT: 'true' }, getRedisState: () => ({ available: false }) });
  const prodResponse = response();
  let prodNext = 0;
  await production(devReq, prodResponse, () => { prodNext += 1; });
  assert.equal(prodNext, 0);
  assert.equal(prodResponse.statusCode, 503);
});
