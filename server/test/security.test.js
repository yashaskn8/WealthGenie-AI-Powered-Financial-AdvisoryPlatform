/**
 * Tier 6 — Security Regression Tests
 *
 * Tests:
 *   1. Mass Assignment Prevention (unexpected fields stripped)
 *   2. IDOR Protection (cannot update other user's profile)
 *   3. Token Revocation / Expired Token Rejection
 *   5. WG-005: POST /api/instruments/rank-wti requires auth + schema validation
 *   6. WG-018: GET /api/metrics requires auth
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import profileRoutes from '../routes/profile.js';
import instrumentRoutes from '../routes/instruments.js';
import metricsRoutes from '../routes/metricsRoutes.js';
import chatRoutes from '../routes/chatRoutes.js';
import { enforceJsonContentType } from '../middleware/contentType.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { blacklistToken } from '../config/redis.js';
import FinancialProfile from '../models/FinancialProfile.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mongoTestHelper.js';
import { withServer, jsonRequest as jsonFetch, rawRequest } from '../test-utils/httpTestUtils.js';
import { canonicalProfile, canonicalProfilePayload } from './helpers/canonicalProfile.js';
import { assertRuntimeResponseMatchesContract } from './helpers/openapiRuntimeContract.js';

process.env.JWT_SECRET = 'security-test-secret';
process.env.NODE_ENV = 'test';

const USER_A_ID = new mongoose.Types.ObjectId().toString();
const USER_B_ID = new mongoose.Types.ObjectId().toString();

function signToken(userId, jti = crypto.randomUUID(), expiresIn = '1h', role = 'user') {
  return jwt.sign(
    { userId, email: `${userId}@test.com`, jti, role },
    process.env.JWT_SECRET,
    { expiresIn }
  );
}

function buildApp() {
  const app = express();
  app.use(enforceJsonContentType);
  app.use(express.json());
  app.use('/api/profile', profileRoutes);
  app.use(errorHandler);
  return app;
}


const VALID_PROFILE_BODY = canonicalProfilePayload({
  monthlyTakeHome: 80000, monthlySavings: 20000, age: 30,
  liquidSavings: 100000, investmentHorizonYears: 15,
});

async function ensureDb() {
  await setupTestDatabase();
}

test.after(async () => {
  try {
    await FinancialProfile.deleteMany({ userId: { $in: [USER_A_ID, USER_B_ID] } });
  } catch (_) {}
  await teardownTestDatabase();
});

// ── 1. Mass Assignment Prevention ────────────────────────────────────
test('Security: mass assignment fields are rejected by strict schema validation', async () => {
  await ensureDb();
  const token = signToken(USER_A_ID);

  await withServer(buildApp(), async (baseUrl) => {
    // Send a payload with unexpected fields (e.g. role, admin, userDetails)
    const { response, body } = await jsonFetch(`${baseUrl}/api/profile/build`, {
      method: 'POST',
      body: JSON.stringify({
        ...VALID_PROFILE_BODY,
        role: 'admin',
        is_admin: true,
        isAdmin: true,
        someUnusedField: 'malicious-data',
      }),
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.status, 400);
    assert.equal(body.code, 'VALIDATION_ERROR');
    assert.equal(await FinancialProfile.countDocuments({ userId: USER_A_ID }), 0);
  });
});

// ── 2. IDOR Protection ───────────────────────────────────────────────
test('Security: user B cannot modify user A profile via IDOR', async () => {
  await ensureDb();
  
  // Create profile A directly in DB
  const profileA = await FinancialProfile.create({
    userId: USER_A_ID,
    ...canonicalProfile({ monthlyTakeHome: 80000, monthlySavings: 20000, age: 30 }),
    recommendationProfileVersion: 'financial-profile-1.0.0',
  });

  const tokenB = signToken(USER_B_ID);

  await withServer(buildApp(), async (baseUrl) => {
    // Attempt to update Profile A using User B's token
    const { response, body } = await jsonFetch(`${baseUrl}/api/profile/${profileA._id}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...VALID_PROFILE_BODY,
        monthly_take_home: 120000,
        version: profileA.version || 1,
      }),
      headers: { authorization: `Bearer ${tokenB}` },
    });

    // Should return 403 Forbidden or 404 Not Found (database-scoped queries)
    assert.ok(response.status === 403 || response.status === 404, `Expected 403 or 404, got ${response.status}`);

    // Verify DB remains unchanged
    const doc = await FinancialProfile.findById(profileA._id).lean();
    assert.equal(doc.monthlyTakeHome, 80000, 'Profile A monthly take-home must not be updated by User B');
  });
});

// ── 3. Token Revocation Rejection ────────────────────────────────────
test('Security: blocklisted / revoked token is rejected with 401 Unauthorized', async () => {
  await ensureDb();

  const jti = crypto.randomUUID();
  const token = signToken(USER_A_ID, jti);

  // Blacklist the token using standard blacklisting helper
  await blacklistToken(jti, 3600);

  await withServer(buildApp(), async (baseUrl) => {
    const { response, body } = await jsonFetch(`${baseUrl}/api/profile/build`, {
      method: 'POST',
      body: JSON.stringify(VALID_PROFILE_BODY),
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.status, 401);
    assert.match(body.error, /revoked/i);
  });
});

// ── 4. Expired Token Rejection ───────────────────────────────────────
test('Security: expired token is rejected with 401 Unauthorized', async () => {
  await ensureDb();

  // Create an already expired token (expiresIn: '0s')
  const expiredToken = signToken(USER_A_ID, crypto.randomUUID(), '0s');

  await withServer(buildApp(), async (baseUrl) => {
    const { response, body } = await jsonFetch(`${baseUrl}/api/profile/build`, {
      method: 'POST',
      body: JSON.stringify(VALID_PROFILE_BODY),
      headers: { authorization: `Bearer ${expiredToken}` },
    });

    assert.equal(response.status, 401);
    assert.match(body.error, /expired/i);
  });
});

// ── 5. WG-005: POST /api/instruments/rank-wti auth + validation ───────
function buildInstrumentApp() {
  const app = express();
  app.use(enforceJsonContentType);
  app.use(express.json());
  app.use('/api/instruments', instrumentRoutes);
  app.use(errorHandler);
  return app;
}

test('WG-005: POST /api/instruments/rank-wti returns 401 without auth', async () => {
  await withServer(buildInstrumentApp(), async (baseUrl) => {
    const { response } = await jsonFetch(`${baseUrl}/api/instruments/rank-wti`, {
      method: 'POST',
      body: JSON.stringify({ candidates: [], userProfile: {}, options: {} }),
    });
    assert.equal(response.status, 401, 'rank-wti must reject unauthenticated requests');
  });
});

test('WG-005: POST /api/instruments/rank-wti rejects a client-supplied product universe', async () => {
  const token = signToken(USER_A_ID);
  await withServer(buildInstrumentApp(), async (baseUrl) => {
    const { response, body } = await jsonFetch(`${baseUrl}/api/instruments/rank-wti`, {
      method: 'POST',
      body: JSON.stringify({
        profileId: new mongoose.Types.ObjectId().toString(),
        parentInstrumentId: 'index_mf',
        candidates: [{ name: 'Client-controlled product' }],
      }),
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 400, 'rank-wti must reject client-controlled candidates');
    assert.ok(body.details || body.error, 'Should return validation error details');
  });
});

test('WG-005: POST /api/instruments/rank-wti rejects legacy inline user profiles', async () => {
  const token = signToken(USER_A_ID);
  await withServer(buildInstrumentApp(), async (baseUrl) => {
    // age outside valid range (18-80)
    const { response, body } = await jsonFetch(`${baseUrl}/api/instruments/rank-wti`, {
      method: 'POST',
      body: JSON.stringify({
        profileId: new mongoose.Types.ObjectId().toString(),
        parentInstrumentId: 'ppf',
        userProfile: { age: 150, riskCategory: 'InvalidTier', investment_horizon: 999 },
      }),
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 400, 'rank-wti must reject inline userProfile fields');
    assert.ok(body.details || body.error, 'Should return validation error details');
  });
});

test('WG-005: POST /api/instruments/rank-wti returns 200 for valid authenticated request', async () => {
  await ensureDb();
  const token = signToken(USER_A_ID);
  let profile = await FinancialProfile.findOne({ userId: USER_A_ID });
  if (!profile) {
    profile = await FinancialProfile.create({
      userId: USER_A_ID,
      ...canonicalProfile({ monthlyTakeHome: 80000, monthlySavings: 20000, age: 30 }),
      recommendationProfileVersion: 'financial-profile-1.0.0',
    });
  }
  await withServer(buildInstrumentApp(), async (baseUrl) => {
    const { response, body } = await jsonFetch(`${baseUrl}/api/instruments/rank-wti`, {
      method: 'POST',
      body: JSON.stringify({
        profileId: profile._id.toString(),
        parentInstrumentId: 'index_mf',
      }),
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200, 'rank-wti must succeed with valid auth + valid payload');
    assertRuntimeResponseMatchesContract({
      method: 'POST', path: '/api/instruments/rank-wti', status: response.status,
      contentType: response.headers.get('content-type'), body,
    });
    assert.ok(body.success, 'Response should include success flag');
    assert.ok(Array.isArray(body.products), 'Response should include products array');
    assert.equal(body.total, 0, 'Unsupported product categories must not receive fallback products');
    assert.equal(body.ranking.status, 'UNAVAILABLE');
    assert.deepEqual(body.ranking.reasonCodes, ['PRODUCT_CLASS_NOT_SUPPORTED_PHASE_2']);
  });
});

// ── 6. WG-018: GET /api/metrics auth + old path dead ────────────────
function buildMetricsApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/metrics', metricsRoutes);
  app.use('/api/chat', chatRoutes);
  app.use(errorHandler);
  return app;
}

test('WG-018: GET /api/metrics returns 401 without auth', async () => {
  await withServer(buildMetricsApp(), async (baseUrl) => {
    const { response } = await jsonFetch(`${baseUrl}/api/metrics`, {
      method: 'GET',
    });
    assert.equal(response.status, 401, 'metrics endpoint must reject unauthenticated requests');
  });
});

test('WG-018: GET /api/metrics rejects a normal authenticated user', async () => {
  const token = signToken(USER_A_ID);
  await withServer(buildMetricsApp(), async (baseUrl) => {
    const { response } = await jsonFetch(`${baseUrl}/api/metrics`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    assert.equal(response.status, 403, 'metrics endpoint must reject non-admin users');
  });
});

test('WG-018: GET /api/metrics returns 200 for an administrator', async () => {
  const token = signToken(USER_A_ID, crypto.randomUUID(), '1h', 'admin');
  await withServer(buildMetricsApp(), async (baseUrl) => {
    const { response } = await jsonFetch(`${baseUrl}/api/metrics`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    assert.equal(response.status, 200, 'metrics endpoint must succeed with admin auth');
  });
});

test('WG-018: GET /api/chat/metrics (old path) returns 404 after relocation', async () => {
  await withServer(buildMetricsApp(), async (baseUrl) => {
    const response = await rawRequest(`${baseUrl}/api/chat/metrics`, {
      method: 'GET',
    });
    assert.equal(response.status, 404, 'old /api/chat/metrics path must be dead after relocation');
  });
});

// ── 7. WG-003, WG-007, WG-025: In-Place Mutation, Canonical Response, and OCC ──
test('WG-003: PUT /api/profile/:profileId updates existing profile in-place', async () => {
  await ensureDb();
  try {
    await FinancialProfile.deleteMany({ userId: USER_A_ID });
    const token = signToken(USER_A_ID);
    await withServer(buildApp(), async (baseUrl) => {
      const { response: postRes, body: postBody } = await jsonFetch(`${baseUrl}/api/profile/build`, {
        method: 'POST',
        body: JSON.stringify(VALID_PROFILE_BODY),
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() },
      });
      assert.equal(postRes.status, 201);
      const profileId = postBody.profileId;

      const { response: putRes, body: putBody } = await jsonFetch(`${baseUrl}/api/profile/${profileId}`, {
        method: 'PUT',
        body: JSON.stringify({ ...VALID_PROFILE_BODY, monthly_take_home: 95000, version: postBody.version || 1 }),
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(putRes.status, 200, 'PUT /api/profile/:profileId should succeed with valid version');
      assert.equal(putBody.profileId, profileId, 'profileId must remain unchanged');
      assert.equal(putBody.version, (postBody.version || 1) + 1, 'version must increment by 1');

      const count = await FinancialProfile.countDocuments({ userId: USER_A_ID });
      assert.equal(count, 1, 'Should update existing profile in-place without creating a new document');
    });
  } finally {
    await FinancialProfile.deleteMany({ userId: USER_A_ID });
  }
});

test('WG-007: POST /build and PUT /:profileId return identical key sets', async () => {
  await ensureDb();
  try {
    const token = signToken(USER_A_ID);
    await withServer(buildApp(), async (baseUrl) => {
      const { body: postBody } = await jsonFetch(`${baseUrl}/api/profile/build`, {
        method: 'POST',
        body: JSON.stringify(VALID_PROFILE_BODY),
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() },
      });

      const { body: putBody } = await jsonFetch(`${baseUrl}/api/profile/${postBody.profileId}`, {
        method: 'PUT',
        body: JSON.stringify({ ...VALID_PROFILE_BODY, version: postBody.version }),
        headers: { authorization: `Bearer ${token}` },
      });

      const postKeys = Object.keys(postBody).sort();
      const putKeys = Object.keys(putBody).sort();
      assert.deepEqual(postKeys, putKeys, 'POST and PUT response shapes must match key-for-key');
      assert.equal(postBody.final_suitability_risk, 'Moderate');
      assert.ok(postBody.final_suitability_level <= 3, 'final suitability must not exceed Moderate preference');
    });
  } finally {
    await FinancialProfile.deleteMany({ userId: USER_A_ID });
  }
});

test('WG-025: PUT /api/profile/:profileId requires version and returns 409 Conflict on version mismatch', async () => {
  await ensureDb();
  try {
    const token = signToken(USER_A_ID);
    await withServer(buildApp(), async (baseUrl) => {
      const { body: postBody } = await jsonFetch(`${baseUrl}/api/profile/build`, {
        method: 'POST',
        body: JSON.stringify(VALID_PROFILE_BODY),
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() },
      });

      // Omitting version should fail validation (400)
      const { response: noVersionRes } = await jsonFetch(`${baseUrl}/api/profile/${postBody.profileId}`, {
        method: 'PUT',
        body: JSON.stringify(VALID_PROFILE_BODY),
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(noVersionRes.status, 400, 'Omitting version on PUT must be rejected with 400');

      // Stale version should return 409 Conflict
      const { response: mismatchRes } = await jsonFetch(`${baseUrl}/api/profile/${postBody.profileId}`, {
        method: 'PUT',
        body: JSON.stringify({ ...VALID_PROFILE_BODY, version: 999 }),
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(mismatchRes.status, 409, 'Version mismatch must return 409 Conflict');
    });
  } finally {
    await FinancialProfile.deleteMany({ userId: USER_A_ID });
  }
});
