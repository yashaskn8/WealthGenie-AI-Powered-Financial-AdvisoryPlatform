import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import recommendRoutes from '../routes/recommend.js';
import { errorHandler } from '../middleware/errorHandler.js';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';
import AuditRecord from '../models/AuditRecord.js';
import {
  buildRecommendationProfile,
  buildRecommendationProfileHash,
  toProfilePersistence,
} from '../services/recommendationProfile.js';
import { assessSuitabilityRisk } from '../services/riskProfiler.js';
import { runPipeline } from '../services/RecommendationPipeline.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mongoTestHelper.js';
import { canonicalProfilePayload } from './helpers/canonicalProfile.js';

const JWT_SECRET = 'recommendation-restore-test-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

let app;
let server;
let baseUrl;
const userA = new mongoose.Types.ObjectId();
const userB = new mongoose.Types.ObjectId();

function signToken(userId) {
  return jwt.sign({ userId: String(userId), jti: crypto.randomUUID() }, JWT_SECRET, { expiresIn: '1h' });
}

async function createFixture({ userId = userA, stale = false } = {}) {
  const profile = buildRecommendationProfile(canonicalProfilePayload());
  const suitability = assessSuitabilityRisk(profile);
  const storedProfile = await FinancialProfile.create({
    userId,
    ...toProfilePersistence(profile, suitability),
    version: 1,
  });
  const modelVersion = 'restore-test-model-1';
  const pipeline = runPipeline(profile, { model_version: modelVersion, confidence_scores: {} });
  const recommendationId = new mongoose.Types.ObjectId();
  const auditId = new mongoose.Types.ObjectId();
  const profileInputHash = buildRecommendationProfileHash(storedProfile.toObject(), { modelVersion });
  const responseSnapshot = {
    profileId: String(storedProfile._id),
    recommendationId: String(recommendationId),
    audit_id: String(auditId),
    audit_hash: 'a'.repeat(64),
    instruments: pipeline.instruments,
    model_version: modelVersion,
    recommendation_policy_version: 'suitability-freeze-1.0.0',
    financial_profile_schema_version: 'financial-profile-1.0.0',
    return_basis: 'PRE_TAX_NOMINAL',
    final_risk_tier: suitability.finalRisk,
    advisory_text: null,
    advisory_explanation: { status: 'PENDING' },
  };
  await Recommendation.create({
    _id: recommendationId,
    userId,
    profileId: storedProfile._id,
    instruments: pipeline.instruments,
    advisoryText: null,
    advisoryMetadata: { status: 'PENDING' },
    confidenceScores: {},
    mlFallback: true,
    modelVersion,
    profileInputHash: stale ? 'b'.repeat(64) : profileInputHash,
    responseSnapshot,
  });
  return storedProfile;
}

async function request(profileId, userId = userA) {
  return fetch(`${baseUrl}/api/recommend/current?profileId=${profileId}`, {
    headers: { Authorization: `Bearer ${signToken(userId)}` },
  });
}

test.before(async () => {
  await setupTestDatabase();
  app = express();
  app.use(express.json());
  app.use('/api/recommend', recommendRoutes);
  app.use(errorHandler);
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.beforeEach(async () => {
  await Promise.all([
    FinancialProfile.deleteMany({ userId: { $in: [userA, userB] } }),
    Recommendation.deleteMany({ userId: { $in: [userA, userB] } }),
    AuditRecord.deleteMany({ userId: { $in: [userA, userB] } }),
  ]);
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await teardownTestDatabase();
});

test('returns the latest matching recommendation without creating records', async () => {
  const profile = await createFixture();
  const countsBefore = await Promise.all([
    Recommendation.countDocuments({ userId: userA }),
    AuditRecord.countDocuments({ userId: userA }),
  ]);

  const response = await request(profile._id);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.profileId, String(profile._id));
  assert.equal(body.instruments.length > 0, true);
  assert.equal(body.recommendationId.length, 24);
  assert.deepEqual(await Promise.all([
    Recommendation.countDocuments({ userId: userA }),
    AuditRecord.countDocuments({ userId: userA }),
  ]), countsBefore);
});

test('returns 404 when no recommendation exists and does not leak ownership', async () => {
  const profile = await createFixture();
  await Recommendation.deleteMany({ profileId: profile._id });

  const missing = await request(profile._id);
  assert.equal(missing.status, 404);

  const crossUser = await request(profile._id, userB);
  assert.equal(crossUser.status, 404);
});

test('rejects a recommendation whose profile hash is stale', async () => {
  const profile = await createFixture({ stale: true });
  const response = await request(profile._id);
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.code, 'STALE_RECOMMENDATION');
});
