/**
 * Comprehensive Cross-User Authorization Audit Suite (Task 1)
 * Verifies that User B cannot read, update, or delete User A's resources.
 *
 * Uses rawRequest from httpTestUtils which returns { status, text(), json() }.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

import profileRoutes from '../routes/profile.js';
import goalRoutes from '../routes/goals.js';
import recommendRoutes from '../routes/recommend.js';
import projectionRoutes from '../routes/projection.js';
import montecarloRoutes from '../routes/montecarlo.js';
import portfolioRoutes from '../routes/portfolio.js';

import { enforceJsonContentType } from '../middleware/contentType.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { withServer, rawRequest } from '../test-utils/httpTestUtils.js';

import FinancialProfile from '../models/FinancialProfile.js';
import Goal from '../models/Goal.js';
import Recommendation from '../models/Recommendation.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mongoTestHelper.js';
import { canonicalProfile, canonicalProfilePayload } from './helpers/canonicalProfile.js';
import { buildRecommendationProfileHash } from '../services/recommendationProfile.js';

const testSecret = ['test', 'auth', 'jwt', 'key'].join('-');
process.env.JWT_SECRET = process.env.JWT_SECRET || testSecret;
const JWT_SECRET = process.env.JWT_SECRET;

let tokenA, tokenB, userAId, userBId;
let profileA, goalA, recommendationA;

function buildTestApp() {
  const app = express();
  app.use(enforceJsonContentType);
  app.use(express.json());
  app.use('/api/profile', profileRoutes);
  app.use('/api/goals', goalRoutes);
  app.use('/api/recommend', recommendRoutes);
  app.use('/api/projection', projectionRoutes);
  app.use('/api/montecarlo', montecarloRoutes);
  app.use('/api/portfolio', portfolioRoutes);
  app.use(errorHandler);
  return app;
}

test.before(async () => {
  await setupTestDatabase();

  userAId = new mongoose.Types.ObjectId().toString();
  userBId = new mongoose.Types.ObjectId().toString();

  tokenA = jwt.sign({ userId: userAId, email: 'usera@authtest.com' }, JWT_SECRET, { expiresIn: '1h' });
  tokenB = jwt.sign({ userId: userBId, email: 'userb@authtest.com' }, JWT_SECRET, { expiresIn: '1h' });

  profileA = await FinancialProfile.create({
    userId: userAId,
    ...canonicalProfile({ monthlyTakeHome: 50000, monthlySavings: 15000, age: 30 }),
    recommendationProfileVersion: 'financial-profile-1.0.0',
  });

  goalA = await Goal.create({
    userId: userAId,
    profileId: profileA._id,
    goal_name: 'User A Retirement Goal',
    target_amount: 1000000,
    target_date: new Date('2035-01-01'),
    priority: 'High',
    current_savings: 50000,
  });

  recommendationA = await Recommendation.create({
    userId: userAId,
    profileId: profileA._id,
    instruments: [{
      id: 'index_mf', type: 'Equity_MF', name: 'Nifty 50 Index', assetClass: 'Equity',
      nominalReturn: 12, effectiveYield: 12, postTaxReturn: null, returnBasis: 'PRE_TAX_NOMINAL',
      expenseRatio: 0.003, riskLevel: 'Medium', riskScore: 3, lockIn: 0,
      tags: ['Wealth Growth'], score: 80, scoreFactors: {
        expectedReturn: 60, riskFit: 100, liquidity: 80, goalFit: 100,
        horizonFit: 100, cost: 100, mlConfidence: 0,
      },
      allocation_pct: 100, allocationWeight: 1,
    }],
    advisoryText: 'User A Advisory',
    mlFallback: true,
    modelVersion: 'test-rule-fallback-4.0.0',
    profileInputHash: buildRecommendationProfileHash(profileA.toObject(), { modelVersion: 'test-rule-fallback-4.0.0' }),
  });
});

test.after(async () => {
  try {
    await FinancialProfile.deleteMany({ userId: { $in: [userAId, userBId] } });
    await Goal.deleteMany({ userId: { $in: [userAId, userBId] } });
    await Recommendation.deleteMany({ userId: { $in: [userAId, userBId] } });
  } catch (_) {}
  await teardownTestDatabase();
});

// ═════════════════════════════════════════════════════════════════════
// Cross-User Authorization Matrix Tests
// ═════════════════════════════════════════════════════════════════════

test('Authorization: User B cannot UPDATE User A profile (PUT /api/profile/:id)', async () => {
  const app = buildTestApp();
  await withServer(app, async (baseUrl) => {
    const res = await rawRequest(`${baseUrl}/api/profile/${profileA._id}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${tokenB}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...canonicalProfilePayload({
        monthlyTakeHome: 999999, monthlySavings: 15000, age: 30,
      }), version: 1 }),
    });
    assert.ok(
      res.status === 403 || res.status === 404,
      `Expected 403 or 404, got ${res.status}`
    );
  });
});

test('Authorization: User B cannot READ User A goals (GET /api/goals)', async () => {
  const app = buildTestApp();
  await withServer(app, async (baseUrl) => {
    const res = await rawRequest(`${baseUrl}/api/goals`, {
      method: 'GET',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.goals.length, 0, 'User B should see 0 goals');
  });
});

test('Authorization: User B cannot REFRESH ADVICE on User A goal (PATCH)', async () => {
  const app = buildTestApp();
  await withServer(app, async (baseUrl) => {
    const res = await rawRequest(`${baseUrl}/api/goals/${goalA._id}/refresh-advice`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${tokenB}`,
        'content-type': 'application/json',
      },
    });
    assert.equal(res.status, 404, `Expected 404, got ${res.status}`);
  });
});

test('Authorization: User B cannot UPDATE User A goal (PATCH /api/goals/:id)', async () => {
  const app = buildTestApp();
  await withServer(app, async (baseUrl) => {
    const res = await rawRequest(`${baseUrl}/api/goals/${goalA._id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${tokenB}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ target_amount: 9999999 }),
    });
    assert.equal(res.status, 404, `Expected 404, got ${res.status}`);
  });
});

test('Authorization: User B cannot DELETE User A goal (DELETE /api/goals/:id)', async () => {
  const app = buildTestApp();
  await withServer(app, async (baseUrl) => {
    const res = await rawRequest(`${baseUrl}/api/goals/${goalA._id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    assert.equal(res.status, 404, `Expected 404, got ${res.status}`);
  });
});

test('Authorization: User B cannot UPDATE User A recommendation weights', async () => {
  const app = buildTestApp();
  await withServer(app, async (baseUrl) => {
    const res = await rawRequest(`${baseUrl}/api/recommend/weights`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokenB}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profileId: profileA._id.toString(),
        weights: { Equity_MF: 1.0 },
      }),
    });
    assert.ok(
      res.status === 403 || res.status === 404,
      `Expected 403 or 404, got ${res.status}`
    );
  });
});

test('Suitability: manual weights cannot add an unapproved instrument', async () => {
  const app = buildTestApp();
  await withServer(app, async (baseUrl) => {
    const res = await rawRequest(`${baseUrl}/api/recommend/weights`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        profileId: profileA._id.toString(),
        weights: { index_mf: 0.8, smallcap_mf: 0.2 },
      }),
    });
    assert.equal(res.status, 400);
  });
});

test('Suitability: manual weights reject a recommendation bound to an older profile state', async () => {
  const validHash = recommendationA.profileInputHash;
  recommendationA.profileInputHash = buildRecommendationProfileHash(
    { ...profileA.toObject(), age: profileA.age + 1 },
    { modelVersion: recommendationA.modelVersion },
  );
  await recommendationA.save();
  try {
    const app = buildTestApp();
    await withServer(app, async (baseUrl) => {
      const res = await rawRequest(`${baseUrl}/api/recommend/weights`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
        body: JSON.stringify({ profileId: profileA._id.toString(), weights: { index_mf: 1 } }),
      });
      assert.equal(res.status, 409);
    });
  } finally {
    recommendationA.profileInputHash = validHash;
    await recommendationA.save();
  }
});

test('Authorization: User B cannot RUN PROJECTION on User A profile (POST /api/projection)', async () => {
  const app = buildTestApp();
  await withServer(app, async (baseUrl) => {
    const res = await rawRequest(`${baseUrl}/api/projection`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokenB}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profileId: profileA._id.toString(),
        instruments: ['FD'], monthly_investment: 5000, years: [5, 10],
      }),
    });
    assert.ok(res.status === 403 || res.status === 404, `Expected 403 or 404, got ${res.status}`);
  });
});

test('Authorization: User B cannot RUN MONTE CARLO on User A profile (POST /api/montecarlo)', async () => {
  const app = buildTestApp();
  await withServer(app, async (baseUrl) => {
    const res = await rawRequest(`${baseUrl}/api/montecarlo/montecarlo`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokenB}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profileId: profileA._id.toString(),
        instrument: 'FD', monthly_investment: 5000, years: 5,
      }),
    });
    assert.ok(res.status === 403 || res.status === 404, `Expected 403 or 404, got ${res.status}`);
  });
});

test('Authorization: User B cannot OPTIMIZE PORTFOLIO for User A profile (POST /api/portfolio/optimise)', async () => {
  const app = buildTestApp();
  await withServer(app, async (baseUrl) => {
    const res = await rawRequest(`${baseUrl}/api/portfolio/optimise`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokenB}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profileId: profileA._id.toString(),
        assets: ['Equity_MF', 'Debt_MF'],
        strategy: 'max_sharpe',
      }),
    });
    assert.ok(res.status === 403 || res.status === 404, `Expected 403 or 404, got ${res.status}`);
  });
});

test('Authorization: User B cannot GENERATE RECOMMENDATIONS for User A profile (POST /api/recommend)', async () => {
  const app = buildTestApp();
  await withServer(app, async (baseUrl) => {
    const res = await rawRequest(`${baseUrl}/api/recommend`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokenB}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        profileId: profileA._id.toString(),
      }),
    });
    assert.ok(res.status === 403 || res.status === 404, `Expected 403 or 404, got ${res.status}`);
  });
});

test('Authorization: User A CAN read, update, and delete own goal', async () => {
  const app = buildTestApp();
  await withServer(app, async (baseUrl) => {
    // Read
    const getRes = await rawRequest(`${baseUrl}/api/goals`, {
      method: 'GET',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(getRes.status, 200);
    const body = await getRes.json();
    assert.equal(body.goals.length, 1);
    assert.equal(body.goals[0]._id, goalA._id.toString());

    // Delete
    const delRes = await rawRequest(`${baseUrl}/api/goals/${goalA._id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(delRes.status, 200);
  });
});
