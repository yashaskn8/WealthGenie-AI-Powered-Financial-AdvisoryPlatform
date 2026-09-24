/**
 * idempotencyHttp.test.js — Integration test proving Idempotency-Key duplicate prevention
 * Verifies that mutating requests sent with the same Idempotency-Key return cached responses
 * with X-Cache-Lookup: HIT - Idempotent and do NOT duplicate database records.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mongoTestHelper.js';

import profileRoutes from '../routes/profile.js';
import goalsRoutes from '../routes/goals.js';
import { errorHandler } from '../middleware/errorHandler.js';
import FinancialProfile from '../models/FinancialProfile.js';
import { canonicalProfilePayload } from './helpers/canonicalProfile.js';
import { installFinancialStateTestHook } from '../services/financialStateTestHooks.js';

const JWT_SECRET = 'idempotency-test-secret-key';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

let app;
let serverInstance;
let baseUrl;

function signToken(userId) {
  return jwt.sign(
    { userId, email: `user-${userId}@example.com`, jti: crypto.randomUUID() },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function createBarrier() {
  let markEntered;
  let open;
  const entered = new Promise(resolve => { markEntered = resolve; });
  const released = new Promise(resolve => { open = resolve; });
  return {
    entered,
    async pause() { markEntered(); await released; },
    release() { open(); },
  };
}

test.before(async () => {
  await setupTestDatabase();

  app = express();
  app.use(express.json());
  app.use('/api/profile', profileRoutes);
  app.use('/api/goals', goalsRoutes);
  app.use(errorHandler);

  await new Promise((resolve) => {
    serverInstance = app.listen(0, '127.0.0.1', () => {
      const port = serverInstance.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (serverInstance) serverInstance.close();
  await teardownTestDatabase();
});

test('IDEMPOTENCY HTTP VERIFICATION: duplicate mutating request returns cached response without duplicate DB insert', async () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const token = signToken(userId);
  const idempotencyKey = crypto.randomUUID();

  const payload = canonicalProfilePayload({
    monthlyTakeHome: 150000,
    age: 30,
    monthlySavings: 50000,
    liquidSavings: 300000,
    financialDependents: 1,
  });

  // 1. Check DB record count before any requests
  const countBefore = await FinancialProfile.countDocuments({ userId });
  assert.equal(countBefore, 0, 'Database must have 0 records before first request');
  console.log(`[VERIFY] Database record count BEFORE request: ${countBefore}`);

  // 2. Send FIRST request with Idempotency-Key
  const res1 = await fetch(`${baseUrl}/api/profile/build`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  });

  const body1Text = await res1.text();
  assert.ok(res1.status === 200 || res1.status === 201, `Expected 200/201, got ${res1.status}: ${body1Text}`);
  const data1 = JSON.parse(body1Text);
  const countAfterFirst = await FinancialProfile.countDocuments({ userId });
  console.log(`[VERIFY] First request status: ${res1.status}`);
  console.log(`[VERIFY] Database record count AFTER first request: ${countAfterFirst}`);
  assert.equal(countAfterFirst, 1, 'Database must have exactly 1 record after first request');

  // 3. Send DUPLICATE request with the EXACT SAME Idempotency-Key
  const res2 = await fetch(`${baseUrl}/api/profile/build`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  });

  const cacheHeader = res2.headers.get('x-cache-lookup');
  console.log(`[VERIFY] Duplicate request status: ${res2.status}, X-Cache-Lookup header: '${cacheHeader}'`);
  assert.ok(res2.status === 200 || res2.status === 201, `Expected 200/201 on cached response, got ${res2.status}`);
  assert.equal(cacheHeader, 'HIT - Idempotent', 'Second request must have X-Cache-Lookup: HIT - Idempotent header');

  const data2 = await res2.json();
  assert.deepEqual(data2, data1, 'Cached duplicate response body must match original response');

  // 4. Confirm DB count AFTER duplicate request is STILL 1
  const countAfterDuplicate = await FinancialProfile.countDocuments({ userId });
  console.log(`[VERIFY] Database record count AFTER duplicate request: ${countAfterDuplicate}`);
  assert.equal(countAfterDuplicate, 1, 'Database record count must remain exactly 1 (increased by 1 total, NOT 2)');

  const changedPayload = { ...payload, age: payload.age + 1 };
  const conflict = await fetch(`${baseUrl}/api/profile/build`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(changedPayload),
  });
  const conflictBody = await conflict.json();
  assert.equal(conflict.status, 409);
  assert.equal(conflictBody.code, 'IDEMPOTENCY_PAYLOAD_CONFLICT');
  assert.equal(await FinancialProfile.countDocuments({ userId }), 1);

  const otherOperation = await fetch(`${baseUrl}/api/goals/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      goal_name: 'Operation-scope check', target_amount: 100000, target_date: '2035-01-01',
      current_savings: 10000, profileId: data1.profileId, priority: 'High',
    }),
  });
  const otherBody = await otherOperation.json();
  assert.notEqual(otherOperation.headers.get('x-cache-lookup'), 'HIT - Idempotent');
  assert.notEqual(otherBody.profileId, data1.profileId, 'another operation must not replay the profile response');
});

test('crash-equivalent response loss after profile commit replays the committed resource', async () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const token = signToken(userId);
  const key = crypto.randomUUID();
  const payload = canonicalProfilePayload({ age: 38, monthlyTakeHome: 190000, monthlySavings: 60000 });
  const uninstall = installFinancialStateTestHook(async boundary => {
    if (boundary === 'profile.build.afterCommitBeforeResponse') throw new Error('SIMULATED_PROCESS_CRASH_AFTER_COMMIT');
  });
  let first;
  try {
    first = await fetch(`${baseUrl}/api/profile/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': key },
      body: JSON.stringify(payload),
    });
  } finally {
    uninstall();
  }
  assert.equal(first.status, 500, 'the simulated lost response is not misreported as a pre-commit success');
  assert.equal(await FinancialProfile.countDocuments({ userId }), 1, 'business mutation committed exactly once');

  const replay = await fetch(`${baseUrl}/api/profile/build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': key },
    body: JSON.stringify(payload),
  });
  const replayBody = await replay.json();
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get('x-cache-lookup'), 'HIT - Idempotent');
  assert.equal(await FinancialProfile.countDocuments({ userId }), 1);
  assert.equal(String(replayBody.profileId), String((await FinancialProfile.findOne({ userId }).lean())._id));
});

test('same idempotency key is isolated by authenticated user identity', async () => {
  const userA = new mongoose.Types.ObjectId().toString();
  const userB = new mongoose.Types.ObjectId().toString();
  const key = 'same-key-across-users-2026';
  const payload = canonicalProfilePayload({ age: 41, monthlyTakeHome: 210000, monthlySavings: 70000 });
  const build = (userId) => fetch(`${baseUrl}/api/profile/build`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${signToken(userId)}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(payload),
  });

  const [responseA, responseB] = await Promise.all([build(userA), build(userB)]);
  const [bodyA, bodyB] = await Promise.all([responseA.json(), responseB.json()]);
  assert.equal(responseA.status, 201, JSON.stringify(bodyA));
  assert.equal(responseB.status, 201, JSON.stringify(bodyB));
  assert.notEqual(String(bodyA.profileId), String(bodyB.profileId));
  assert.equal(await FinancialProfile.countDocuments({ userId: userA }), 1);
  assert.equal(await FinancialProfile.countDocuments({ userId: userB }), 1);
});

test('missing, malformed, short, and oversized idempotency keys fail before profile mutation', async () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const token = signToken(userId);
  const payload = canonicalProfilePayload({ age: 36, monthlyTakeHome: 180000, monthlySavings: 55000 });
  const invalidKeys = [undefined, 'short', 'invalid/key-123', 'x'.repeat(129)];
  for (const key of invalidKeys) {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    if (key !== undefined) headers['Idempotency-Key'] = key;
    const response = await fetch(`${baseUrl}/api/profile/build`, {
      method: 'POST', headers, body: JSON.stringify(payload),
    });
    const body = await response.json();
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(body.code, 'INVALID_IDEMPOTENCY_KEY');
    assert.equal(typeof body.request_id, 'string');
  }
  assert.equal(await FinancialProfile.countDocuments({ userId }), 0);
});

test('same-key concurrent profile requests wait for the transactional durable completion', async () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const token = signToken(userId);
  const key = 'concurrent-profile-operation-2026';
  const payload = canonicalProfilePayload({ age: 44, monthlyTakeHome: 240000, monthlySavings: 80000 });
  const insertBarrier = createBarrier();
  let markLockObserved;
  const lockObserved = new Promise(resolve => { markLockObserved = resolve; });
  let inserted = false;
  let observed = false;
  const uninstall = installFinancialStateTestHook(async (boundary, context) => {
    if (boundary === 'profile.build.afterInsertBeforeCommit' && !inserted) {
      inserted = true;
      assert.equal(context.transactionActive, true);
      await insertBarrier.pause();
    }
    if (boundary === 'idempotency.mutation.lockObserved'
        && context.operation === 'profile.build'
        && !observed) {
      observed = true;
      markLockObserved();
    }
  });
  const send = () => fetch(`${baseUrl}/api/profile/build`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify(payload),
  });
  const firstPending = send();
  try {
    await insertBarrier.entered;
    const secondPending = send();
    await lockObserved;
    insertBarrier.release();
    const [first, second] = await Promise.all([firstPending, secondPending]);
    const [firstBody, secondBody] = await Promise.all([first.json(), second.json()]);
    assert.equal(first.status, 201, JSON.stringify(firstBody));
    assert.equal(second.status, 201, JSON.stringify(secondBody));
    assert.equal(await FinancialProfile.countDocuments({ userId }), 1);
    assert.equal(String(firstBody.profileId), String(secondBody.profileId));
    assert.equal(second.headers.get('x-cache-lookup'), 'HIT - Idempotent');
  } finally {
    insertBarrier.release();
    uninstall();
  }
});
