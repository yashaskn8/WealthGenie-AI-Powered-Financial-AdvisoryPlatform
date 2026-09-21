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
import { getCurrentRegulatoryRuleVersion } from '../services/taxEngine.js';
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

async function createFixture({ userId = userA, stale = false, regulatoryRuleVersion = getCurrentRegulatoryRuleVersion() } = {}) {
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
    regulatoryRuleVersion,
    profileInputHash: stale ? 'b'.repeat(64) : profileInputHash,
    responseSnapshot,
  });
  return storedProfile;
}

async function createAdvisoryLifecycleFixture() {
  const profile = buildRecommendationProfile(canonicalProfilePayload());
  const suitability = assessSuitabilityRisk(profile);
  const storedProfile = await FinancialProfile.create({
    userId: userA,
    ...toProfilePersistence(profile, suitability),
    version: 1,
  });
  const modelVersion = 'restore-advisory-test-model-1';
  const pipeline = runPipeline(profile, { model_version: modelVersion, confidence_scores: {} });
  const recommendationId = new mongoose.Types.ObjectId();
  const auditId = new mongoose.Types.ObjectId();
  const profileInputHash = buildRecommendationProfileHash(storedProfile.toObject(), { modelVersion });
  const responseSnapshot = {
    profileId: String(storedProfile._id),
    recommendationId: String(recommendationId),
    audit_id: String(auditId),
    audit_hash: 'b'.repeat(64),
    instruments: pipeline.instruments,
    model_version: modelVersion,
    advisory_text: 'snapshot explanation',
    advisory_explanation: {
      status: 'PENDING',
      provider: 'snapshot-provider',
    },
  };
  await Recommendation.create({
    _id: recommendationId,
    userId: userA,
    profileId: storedProfile._id,
    instruments: pipeline.instruments,
    advisoryText: 'generated explanation',
    advisoryMetadata: {
      status: 'READY',
      provider: 'current-provider',
      model: 'current-model',
      prompt_version: 'prompt-2',
      grounding_version: 'grounding-2',
      evidence_ids_used: ['E_CURRENT'],
      unavailable_facts: ['CURRENT_FACT_UNAVAILABLE'],
      citations: [{ id: 'E_CURRENT', title: 'Current evidence' }],
      validation_status: 'VALID',
      generated_at: '2026-09-21T00:00:00.000Z',
    },
    confidenceScores: {},
    mlFallback: true,
    modelVersion,
    regulatoryRuleVersion: getCurrentRegulatoryRuleVersion(),
    profileInputHash,
    responseSnapshot,
  });
  return { storedProfile, recommendationId, responseSnapshot };
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

test('restores current advisory metadata and text over the original snapshot', async () => {
  const { storedProfile, responseSnapshot } = await createAdvisoryLifecycleFixture();
  const countsBefore = await Promise.all([
    Recommendation.countDocuments({ userId: userA }),
    AuditRecord.countDocuments({ userId: userA }),
  ]);

  const response = await request(storedProfile._id);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.instruments, responseSnapshot.instruments);
  assert.equal(body.advisory_text, 'generated explanation');
  assert.equal(body.advisory_explanation.status, 'READY');
  assert.equal(body.advisory_explanation.provider, 'current-provider');
  assert.equal(body.advisory_explanation.model, 'current-model');
  assert.equal(body.advisory_explanation.prompt_version, 'prompt-2');
  assert.equal(body.advisory_explanation.grounding_version, 'grounding-2');
  assert.deepEqual(body.advisory_explanation.evidence_ids_used, ['E_CURRENT']);
  assert.deepEqual(body.advisory_explanation.unavailable_facts, ['CURRENT_FACT_UNAVAILABLE']);
  assert.deepEqual(body.advisory_explanation.citations, [{ id: 'E_CURRENT', title: 'Current evidence' }]);
  assert.equal(body.advisory_explanation.validation_status, 'VALID');
  assert.equal(body.advisory_explanation.generated_at, '2026-09-21T00:00:00.000Z');
  assert.deepEqual(await Promise.all([
    Recommendation.countDocuments({ userId: userA }),
    AuditRecord.countDocuments({ userId: userA }),
  ]), countsBefore);
});

test('rejects a recommendation generated under an older regulatory policy without mutation', async () => {
  const profile = await createFixture({ regulatoryRuleVersion: 'tax-policy-FY2025-26-v1' });
  const countsBefore = await Promise.all([
    Recommendation.countDocuments({ userId: userA }),
    AuditRecord.countDocuments({ userId: userA }),
  ]);

  const response = await request(profile._id);
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.code, 'STALE_RECOMMENDATION');
  assert.deepEqual(await Promise.all([
    Recommendation.countDocuments({ userId: userA }),
    AuditRecord.countDocuments({ userId: userA }),
  ]), countsBefore);
});

test('falls back to snapshot advisory state when current metadata is absent', async () => {
  const profile = await createFixture();
  await Recommendation.updateOne(
    { profileId: profile._id, userId: userA },
    { $set: { advisoryText: null, advisoryMetadata: null } },
  );

  const response = await request(profile._id);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.advisory_text, null);
  assert.deepEqual(body.advisory_explanation, { status: 'PENDING' });
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
