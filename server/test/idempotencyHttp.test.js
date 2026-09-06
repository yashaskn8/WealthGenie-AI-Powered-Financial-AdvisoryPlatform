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
});
