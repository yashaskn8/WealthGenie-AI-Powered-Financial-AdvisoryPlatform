/**
 * server/test/goalUpdateRecompute.test.js — Numeric Correctness Audit Suite (WG-037)
 * Verifies mathematical recomputation logic for PATCH /api/goals/:goalId
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mongoTestHelper.js';

import goalRoutes from '../routes/goals.js';
import { enforceJsonContentType } from '../middleware/contentType.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { withServer, jsonRequest } from '../test-utils/httpTestUtils.js';
import Goal from '../models/Goal.js';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';
import RecommendationAllocationRevision from '../models/RecommendationAllocationRevision.js';
import RecommendationState from '../models/RecommendationState.js';
import { canonicalProfile } from './helpers/canonicalProfile.js';
import { buildRecommendationProfileHash, RECOMMENDATION_POLICY_VERSION } from '../services/recommendationProfile.js';
import { getCurrentRegulatoryRuleVersion } from '../services/taxEngine.js';
import { buildPortfolioFingerprint, buildRecommendationFingerprint } from '../services/recommendationFingerprint.js';
import {
  PROJECTION_ASSUMPTION_POLICY_HASH,
  PROJECTION_ASSUMPTION_SOURCE,
  PROJECTION_ASSUMPTION_VERSION,
} from '../services/instrumentConstants.js';

const testSecret = ['wg037', 'test', 'jwt', 'secret', 'key'].join('-');
process.env.JWT_SECRET = process.env.JWT_SECRET || testSecret;
const JWT_SECRET = process.env.JWT_SECRET;
process.env.NODE_ENV = 'test';

const TEST_USER_ID = new mongoose.Types.ObjectId().toString();

function signToken(userId = TEST_USER_ID) {
  return jwt.sign(
    { userId, email: 'wg037-test@example.com', jti: crypto.randomUUID() },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function buildTestApp() {
  const app = express();
  app.use(enforceJsonContentType);
  app.use(express.json());
  app.use('/api/goals', goalRoutes);
  app.use(errorHandler);
  return app;
}

async function ensureDb() {
  await setupTestDatabase();
  let profile = await FinancialProfile.findOne({ userId: TEST_USER_ID });
  if (!profile) {
    profile = await FinancialProfile.create({
      userId: TEST_USER_ID,
      ...canonicalProfile({ monthlyTakeHome: 100000, monthlySavings: 30000 }),
      recommendationProfileVersion: 'financial-profile-1.0.0',
    });
  }
  let recommendation = await Recommendation.findOne({ userId: TEST_USER_ID, profileId: profile._id });
  if (!recommendation) {
    recommendation = await Recommendation.create({
      userId: TEST_USER_ID, profileId: profile._id,
      instruments: [{
        id: 'fd', type: 'FD', name: 'Bank Fixed Deposit', assetClass: 'Fixed Income',
        allocationWeight: 1, allocation_pct: 100, nominalReturn: 7.5, effectiveYield: 7.5,
        postTaxReturn: null, returnBasis: 'PRE_TAX_NOMINAL', expenseRatio: 0,
        returnAssumptionVersion: PROJECTION_ASSUMPTION_VERSION,
        returnAssumptionHash: PROJECTION_ASSUMPTION_POLICY_HASH,
        returnSource: PROJECTION_ASSUMPTION_SOURCE,
        riskLevel: 'Low', riskScore: 1, lockIn: 0, tags: ['Wealth Growth'],
        score: 80, scoreFactors: {
          expectedReturn: 60, riskFit: 100, liquidity: 80, goalFit: 100,
          horizonFit: 100, cost: 100, mlConfidence: 0,
        },
      }],
      advisoryText: 'Fixture recommendation', mlFallback: true,
      modelVersion: 'test-rule-fallback-4.0.0', generatedAt: new Date(),
      recommendationPolicyVersion: RECOMMENDATION_POLICY_VERSION,
      regulatoryRuleVersion: getCurrentRegulatoryRuleVersion(),
      profileInputHash: buildRecommendationProfileHash(profile.toObject(), { modelVersion: 'test-rule-fallback-4.0.0' }),
      recommendationGeneration: 1,
      returnAssumptionHash: PROJECTION_ASSUMPTION_POLICY_HASH,
    });
  }
  const instruments = recommendation.instruments.map(instrument => instrument.toObject());
  const portfolioFingerprint = buildPortfolioFingerprint(instruments);
  const recommendationFingerprint = buildRecommendationFingerprint({
    recommendationId: recommendation._id,
    profileInputHash: recommendation.profileInputHash,
    modelVersion: recommendation.modelVersion,
    recommendationPolicyVersion: recommendation.recommendationPolicyVersion,
    regulatoryRuleVersion: recommendation.regulatoryRuleVersion,
    returnAssumptionVersion: PROJECTION_ASSUMPTION_VERSION,
    returnAssumptionHash: PROJECTION_ASSUMPTION_POLICY_HASH,
    allocationRevision: 1,
    instruments,
  });
  let revision = await RecommendationAllocationRevision.findOne({ recommendationId: recommendation._id, revision: 1 });
  if (!revision) revision = await RecommendationAllocationRevision.create({
      recommendationId: recommendation._id,
      profileId: profile._id,
      userId: TEST_USER_ID,
      revision: 1,
      previousRevision: null,
      source: 'ORIGINAL_RECOMMENDATION',
      instruments,
      profileInputHash: recommendation.profileInputHash,
      modelVersion: recommendation.modelVersion,
      recommendationPolicyVersion: recommendation.recommendationPolicyVersion,
      regulatoryRuleVersion: recommendation.regulatoryRuleVersion,
      returnAssumptionVersion: PROJECTION_ASSUMPTION_VERSION,
      returnAssumptionHash: PROJECTION_ASSUMPTION_POLICY_HASH,
      returnAssumptionSource: PROJECTION_ASSUMPTION_SOURCE,
      portfolioFingerprint,
      recommendationFingerprint,
    });
  await RecommendationState.findOneAndUpdate(
    { userId: TEST_USER_ID, profileId: profile._id },
    { $set: {
      currentRecommendationId: recommendation._id,
      currentAllocationRevision: 1,
      currentAllocationRevisionId: revision._id,
      generationRevision: recommendation.recommendationGeneration,
      profileInputHash: recommendation.profileInputHash,
      portfolioFingerprint,
      returnAssumptionVersion: PROJECTION_ASSUMPTION_VERSION,
      returnAssumptionHash: PROJECTION_ASSUMPTION_POLICY_HASH,
      returnAssumptionSource: PROJECTION_ASSUMPTION_SOURCE,
    } },
    { upsert: true, new: true },
  );
  return profile;
}

test.after(async () => {
  try {
    await Goal.deleteMany({ userId: TEST_USER_ID });
    await RecommendationState.deleteMany({ userId: TEST_USER_ID });
    await Recommendation.deleteMany({ userId: TEST_USER_ID });
    await FinancialProfile.deleteMany({ userId: TEST_USER_ID });
  } catch (_) {}
  await teardownTestDatabase();
});

test('WG-037 Scenario (a): POST /create goal with known target_amount and target_date', async () => {
  const profile = await ensureDb();
  const token = signToken();
  const app = buildTestApp();

  // Create a target_date exactly 10 years in the future
  const targetDateObj = new Date();
  targetDateObj.setFullYear(targetDateObj.getFullYear() + 10);
  const targetDateStr = targetDateObj.toISOString().split('T')[0];

  const createPayload = {
    goal_name: 'Retirement Corpus 2036',
    target_amount: 1000000, // ₹10 Lakhs
    target_date: targetDateStr,
    current_savings: 100000, // ₹1 Lakh
    profileId: profile._id.toString(),
    priority: 'High',
  };

  await withServer(app, async (baseUrl) => {
    const { response, body } = await jsonRequest(`${baseUrl}/api/goals/create`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(createPayload),
    });

    assert.equal(response.status, 201, `POST /create failed with status ${response.status}`);
    assert.ok(body.goal, 'Response must include created goal object');
    assert.equal(body.goal.goal_name, 'Retirement Corpus 2036');
    assert.equal(body.goal.target_amount, 1000000);
    assert.ok(body.goal.inflation_adjusted_target > 1000000, 'Inflation target must be greater than initial target_amount');
    assert.ok(body.goal.recommended_sip > 0, 'Recommended SIP must be positive');
    assert.ok(body.goal.simulated_monthly_contribution <= 30000, 'Goal simulation must not exceed profile savings capacity');
  });
});

test('WG-037 Scenario (b): PATCH target_amount recomputes inflation_adjusted_target using exact route formula', async () => {
  const profile = await ensureDb();
  const token = signToken();
  const app = buildTestApp();

  const targetDateObj = new Date();
  targetDateObj.setFullYear(targetDateObj.getFullYear() + 10);
  const targetDateStr = targetDateObj.toISOString().split('T')[0];

  await withServer(app, async (baseUrl) => {
    // 1. Create initial goal
    const { response: createRes, body: createBody } = await jsonRequest(`${baseUrl}/api/goals/create`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        goal_name: 'Home Downpayment 2036',
        target_amount: 1000000,
        target_date: targetDateStr,
        current_savings: 100000,
        profileId: profile._id.toString(),
        priority: 'High',
      }),
    });
    assert.equal(createRes.status, 201);
    const createdGoal = createBody.goal;

    // 2. PATCH target_amount to 2,000,000
    const newTargetAmount = 2000000;
    const { response: patchRes, body: patchBody } = await jsonRequest(`${baseUrl}/api/goals/${createdGoal._id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ target_amount: newTargetAmount }),
    });

    assert.equal(patchRes.status, 200, `PATCH failed with status ${patchRes.status}`);
    assert.ok(patchBody.success, 'PATCH response must indicate success');

    const updatedGoal = patchBody.goal;
    assert.equal(updatedGoal.target_amount, newTargetAmount);

    // Compute expected inflation_adjusted_target using exact PATCH handler formula:
    // const now = new Date();
    // const msRemaining = new Date(goal.target_date) - now;
    // const yearsRemaining = Math.max(0.5, Math.floor((msRemaining / (365.25 * 24 * 60 * 60 * 1000)) * 4) / 4);
    // const inflationAdjustedTarget = Math.round(goal.target_amount * Math.pow(1.05, yearsRemaining));
    const now = new Date();
    const msRemaining = new Date(createdGoal.target_date) - now;
    const expectedYearsRemaining = Math.max(0.5, Math.floor((msRemaining / (365.25 * 24 * 60 * 60 * 1000)) * 4) / 4);
    const expectedInflationTarget = Math.round(newTargetAmount * Math.pow(1.05, expectedYearsRemaining));

    assert.equal(
      updatedGoal.inflation_adjusted_target,
      expectedInflationTarget,
      `PATCH inflation_adjusted_target (${updatedGoal.inflation_adjusted_target}) must match exact formula calculation (${expectedInflationTarget})`
    );
  });
});

test('WG-037 Scenario (c): PATCH current_savings reduces/maintains SIP and leaves inflation_adjusted_target unchanged', async () => {
  const profile = await ensureDb();
  const token = signToken();
  const app = buildTestApp();

  const targetDateObj = new Date();
  targetDateObj.setFullYear(targetDateObj.getFullYear() + 10);
  const targetDateStr = targetDateObj.toISOString().split('T')[0];

  await withServer(app, async (baseUrl) => {
    // 1. Create goal
    const { response: createRes, body: createBody } = await jsonRequest(`${baseUrl}/api/goals/create`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        goal_name: 'Child Education 2036',
        target_amount: 1500000,
        target_date: targetDateStr,
        current_savings: 50000,
        profileId: profile._id.toString(),
        priority: 'High',
      }),
    });
    assert.equal(createRes.status, 201);
    const initialGoal = createBody.goal;

    const initialInflationTarget = initialGoal.inflation_adjusted_target;
    const initialSip = initialGoal.recommended_sip;

    // 2. PATCH current_savings from 50,000 to 400,000 (higher savings)
    const { response: patchRes, body: patchBody } = await jsonRequest(`${baseUrl}/api/goals/${initialGoal._id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ current_savings: 400000 }),
    });

    assert.equal(patchRes.status, 200);
    const updatedGoal = patchBody.goal;

    assert.equal(updatedGoal.current_savings, 400000);
    assert.equal(
      updatedGoal.inflation_adjusted_target,
      initialInflationTarget,
      'PATCHing only current_savings must leave inflation_adjusted_target unchanged'
    );
    assert.ok(
      updatedGoal.recommended_sip <= initialSip,
      `Higher current savings (${updatedGoal.current_savings}) must yield a lower or equal recommended SIP (${updatedGoal.recommended_sip} vs ${initialSip})`
    );
  });
});

test('WG-037 Scenario (d): PATCH priority-only leaves inflation_adjusted_target, recommended_sip, and monte_carlo_summary unchanged', async () => {
  const profile = await ensureDb();
  const token = signToken();
  const app = buildTestApp();

  const targetDateObj = new Date();
  targetDateObj.setFullYear(targetDateObj.getFullYear() + 10);
  const targetDateStr = targetDateObj.toISOString().split('T')[0];

  await withServer(app, async (baseUrl) => {
    // 1. Create goal
    const { response: createRes, body: createBody } = await jsonRequest(`${baseUrl}/api/goals/create`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        goal_name: 'Emergency Fund 2036',
        target_amount: 500000,
        target_date: targetDateStr,
        current_savings: 100000,
        profileId: profile._id.toString(),
        priority: 'Medium',
      }),
    });
    assert.equal(createRes.status, 201);
    const initialGoal = createBody.goal;

    // 2. PATCH priority only (priority: 'Low')
    const { response: patchRes, body: patchBody } = await jsonRequest(`${baseUrl}/api/goals/${initialGoal._id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ priority: 'Low' }),
    });

    assert.equal(patchRes.status, 200);
    const updatedGoal = patchBody.goal;

    assert.equal(updatedGoal.priority, 'Low');
    assert.equal(
      updatedGoal.inflation_adjusted_target,
      initialGoal.inflation_adjusted_target,
      'Priority-only PATCH must not alter inflation_adjusted_target'
    );
    assert.equal(
      updatedGoal.recommended_sip,
      initialGoal.recommended_sip,
      'Priority-only PATCH must not alter recommended_sip'
    );
    assert.equal(
      updatedGoal.monte_carlo_summary.p50,
      initialGoal.monte_carlo_summary.p50,
      'Priority-only PATCH must not recompute monte_carlo_summary'
    );
  });
});
