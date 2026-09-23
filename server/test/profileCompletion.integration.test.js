import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import profileRoutes from '../routes/profile.js';
import { errorHandler } from '../middleware/errorHandler.js';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';
import RecommendationAllocationRevision from '../models/RecommendationAllocationRevision.js';
import RecommendationState from '../models/RecommendationState.js';
import AuditRecord from '../models/AuditRecord.js';
import { connectRedis, redisClient } from '../config/redis.js';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mongoTestHelper.js';
import { canonicalProfilePayload } from './helpers/canonicalProfile.js';
import { getCurrentRegulatoryRuleVersion } from '../services/taxEngine.js';

const JWT_SECRET = 'profile-completion-integration-secret';
const enabled = process.env.RUN_PROFILE_COMPLETION_INTEGRATION === 'true';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

function signToken(userId) {
  return jwt.sign({ userId: String(userId), jti: crypto.randomUUID() }, JWT_SECRET, { expiresIn: '1h' });
}

test('precompute -> complete persists one profile, recommendation, and audit and replays safely', {
  skip: !enabled,
}, async () => {
  let server;
  let baseUrl;
  const userId = new mongoose.Types.ObjectId();
  const token = signToken(userId);
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const payload = canonicalProfilePayload();
  const idempotencyKey = crypto.randomUUID();

  try {
    await setupTestDatabase({ requireReplicaSet: true });
    assert.equal(
      await connectRedis({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' }),
      true,
      'Redis-compatible test infrastructure is required when RUN_PROFILE_COMPLETION_INTEGRATION=true.',
    );

    const app = express();
    app.use(express.json());
    app.use('/api/profile', profileRoutes);
    app.use(errorHandler);
    await new Promise(resolve => {
      server = app.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    const before = await Promise.all([
      FinancialProfile.countDocuments({ userId }),
      Recommendation.countDocuments({ userId }),
      AuditRecord.countDocuments({ userId }),
    ]);
    assert.deepEqual(before, [0, 0, 0]);

    const precomputeResponse = await fetch(`${baseUrl}/api/profile/precompute`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    assert.equal(precomputeResponse.status, 200);
    const candidate = await precomputeResponse.json();
    assert.match(candidate.candidateId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    const completeHeaders = { ...headers, 'Idempotency-Key': idempotencyKey };
    const completeResponse = await fetch(`${baseUrl}/api/profile/complete`, {
      method: 'POST',
      headers: completeHeaders,
      body: JSON.stringify({ ...payload, candidateId: candidate.candidateId }),
    });
    assert.equal(completeResponse.status, 200);
    const completed = await completeResponse.json();
    assert.equal(completed.completion.candidateHit, true);
    assert.equal(completed.completion.recomputed, false);
    assert.equal(completed.recommendation.response_state, 'CURRENT');
    assert.equal(completed.recommendation.profileId, completed.profile.profileId);
    assert.equal(completed.recommendation.profile_version, completed.profile.version);
    assert.match(completed.recommendation.profile_input_hash, /^[a-f0-9]{64}$/i);
    assert.match(completed.recommendation.recommendation_fingerprint, /^[a-f0-9]{64}$/i);
    assert.equal(completed.recommendation.calculation_freshness.fresh, true);
    assert.deepEqual(completed.recommendation.calculation_freshness.reasonCodes, []);
    assert.equal(completed.recommendation.state_provenance.status, 'PERSISTED_REVISION');
    assert.equal(completed.recommendation.state_provenance.profileVersion, completed.profile.version);
    assert.equal(completed.recommendation.state_provenance.recommendationId, completed.recommendation.recommendationId);
    assert.equal(completed.recommendation.state_provenance.allocationRevisionId, completed.recommendation.allocation_revision_id);
    assert.match(completed.recommendation.allocation_revision_id, /^[a-f\d]{24}$/i);
    const revisionOne = await RecommendationAllocationRevision.findById(completed.recommendation.allocation_revision_id).lean();
    const currentState = await RecommendationState.findOne({
      userId,
      profileId: completed.profile.profileId,
    }).lean();
    assert.equal(String(revisionOne.recommendationId), completed.recommendation.recommendationId);
    assert.equal(revisionOne.revision, 1);
    assert.equal(revisionOne.portfolioFingerprint, completed.recommendation.portfolio_fingerprint);
    assert.equal(String(currentState.currentRecommendationId), completed.recommendation.recommendationId);
    assert.equal(String(currentState.currentAllocationRevisionId), completed.recommendation.allocation_revision_id);
    const candidateHitTiming = completeResponse.headers.get('server-timing');
    assert.match(candidateHitTiming || '', /ml;dur=0\.00/);
    assert.match(candidateHitTiming || '', /pipeline;dur=0\.00/);
    assert.match(candidateHitTiming || '', /projection;dur=0\.00/);

    assert.deepEqual(await Promise.all([
      FinancialProfile.countDocuments({ userId }),
      Recommendation.countDocuments({ userId }),
      AuditRecord.countDocuments({ userId }),
    ]), [1, 1, 1]);
    const persistedRecommendation = await Recommendation.findOne({ userId }).lean();
    assert.equal(persistedRecommendation.regulatoryRuleVersion, getCurrentRegulatoryRuleVersion());
    assert.equal(persistedRecommendation.profileCompletionCandidateId, candidate.candidateId);

    const replayResponse = await fetch(`${baseUrl}/api/profile/complete`, {
      method: 'POST',
      headers: completeHeaders,
      body: JSON.stringify({ ...payload, candidateId: candidate.candidateId }),
    });
    assert.equal(replayResponse.status, 200);
    const replay = await replayResponse.json();
    assert.equal(replay.profile.profileId, completed.profile.profileId);
    assert.equal(replay.recommendation.recommendationId, completed.recommendation.recommendationId);
    assert.equal(replay.recommendation.response_state, 'CURRENT');
    assert.equal(replay.recommendation.profile_version, completed.profile.version);
    assert.equal(replay.recommendation.allocation_revision, completed.recommendation.allocation_revision);
    assert.equal(replay.recommendation.recommendation_fingerprint, completed.recommendation.recommendation_fingerprint);
    assert.deepEqual(await Promise.all([
      FinancialProfile.countDocuments({ userId }),
      Recommendation.countDocuments({ userId }),
      AuditRecord.countDocuments({ userId }),
    ]), [1, 1, 1]);

    const conflictResponse = await fetch(`${baseUrl}/api/profile/complete`, {
      method: 'POST',
      headers: completeHeaders,
      body: JSON.stringify({ ...payload, monthly_savings: payload.monthly_savings + 1 }),
    });
    assert.equal(conflictResponse.status, 409);
    const conflict = await conflictResponse.json();
    assert.equal(conflict.code, 'IDEMPOTENCY_PAYLOAD_CONFLICT');

    const missResponse = await fetch(`${baseUrl}/api/profile/complete`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ ...payload, monthly_savings: payload.monthly_savings + 2 }),
    });
    assert.equal(missResponse.status, 200);
    const miss = await missResponse.json();
    assert.equal(miss.completion.candidateHit, false);
    assert.equal(miss.completion.recomputed, true);
    assert.deepEqual(await Promise.all([
      FinancialProfile.countDocuments({ userId }),
      Recommendation.countDocuments({ userId }),
      AuditRecord.countDocuments({ userId }),
    ]), [2, 2, 2]);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (redisClient?.isOpen) await redisClient.quit().catch(() => {});
    await FinancialProfile.deleteMany({ userId }).catch(() => {});
    await Recommendation.deleteMany({ userId }).catch(() => {});
    await AuditRecord.deleteMany({ userId }).catch(() => {});
    await teardownTestDatabase();
  }
});
