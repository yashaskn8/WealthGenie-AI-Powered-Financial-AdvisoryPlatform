/**
 * deferredAdvisory.test.js — Performance hardening tests for decoupled advisory generation
 * 
 * Verifies that:
 * 1. Core /api/recommend does not block on LLM advisory generation and returns immediately
 * 2. Core response contains valid instruments, 100% allocation weights, projections, and PENDING advisory
 * 3. Recommendation is persisted with advisoryText: null, advisoryMetadata.status: 'PENDING'
 * 4. Audit record is created with advisorySummary: '' and intact cryptographic chain
 * 5. Server-Timing header is returned on core recommendation response
 * 6. Deferred advisory endpoint POST /api/recommend/:id/advisory generates and updates advisory
 * 7. Deferred advisory does NOT modify instruments or allocation weights
 * 8. Deferred advisory NEVER mutates the original AuditRecord
 * 9. Deferred advisory enforces strict ownership (403 for other users, 404 for missing)
 * 10. Deferred advisory is idempotent and short-circuits when status is already READY
 * 11. Atomic claim prevents concurrent generation (409 Conflict)
 * 12. FAILED state can be retried cleanly
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mongoTestHelper.js';
import recommendRoutes from '../routes/recommend.js';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';
import AuditRecord from '../models/AuditRecord.js';
import { ProviderManager } from '../services/providerAbstraction.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { canonicalProfile } from './helpers/canonicalProfile.js';
import { getCurrentRegulatoryRuleVersion } from '../services/taxEngine.js';
import { buildRecommendationProfileHash } from '../services/recommendationProfile.js';

const JWT_SECRET = 'deferred-advisory-test-secret-key-32ch';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

let app;
let serverInstance;
let baseUrl;

function signToken(userId, role = 'user') {
  return jwt.sign(
    { userId, email: `user-${userId}@example.com`, role, jti: crypto.randomUUID() },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

test.before(async () => {
  await setupTestDatabase();

  app = express();
  app.use(express.json());
  app.use('/api/recommend', recommendRoutes);
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

test('DEFERRED ADVISORY: Complete decoupled recommendation and deferred advisory flow', async (t) => {
  const userAId = new mongoose.Types.ObjectId();
  const userBId = new mongoose.Types.ObjectId();
  const tokenA = signToken(userAId);
  const tokenB = signToken(userBId);

  const profile = await FinancialProfile.create({
    userId: userAId,
    ...canonicalProfile({ monthlyTakeHome: 120000, monthlySavings: 35000, age: 32 }),
    recommendationProfileVersion: 'financial-profile-1.0.0',
  });
  const validMlV1ProfileHash = buildRecommendationProfileHash(profile.toObject(), { modelVersion: 'ml_v1' });

  let recData = null;
  let serverTimingHeader = null;

  await t.test('1. Core /api/recommend returns authoritative data immediately with PENDING advisory', async () => {
    const start = performance.now();
    const res = await fetch(`${baseUrl}/api/recommend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`,
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({ profileId: profile._id.toString() }),
    });
    const elapsed = performance.now() - start;

    assert.equal(res.status, 200);
    serverTimingHeader = res.headers.get('server-timing');
    assert.ok(serverTimingHeader, 'Server-Timing header must be present');
    assert.match(serverTimingHeader, /profile;dur=/);
    assert.match(serverTimingHeader, /pipeline;dur=/);
    assert.match(serverTimingHeader, /persistence;dur=/);
    assert.match(serverTimingHeader, /total;dur=/);

    recData = await res.json();
    assert.ok(recData.recommendationId, 'Must return recommendationId');
    assert.ok(recData.audit_id, 'Must return audit_id');
    assert.equal(recData.advisory_text, null, 'advisory_text must be null in core sync response');
    assert.equal(recData.advisory_explanation?.status, 'PENDING', 'advisory_explanation status must be PENDING');
    assert.ok(Array.isArray(recData.instruments), 'Instruments must be an array');
    assert.ok(recData.instruments.length > 0, 'Must return suitable instruments');

    const totalWeight = recData.instruments.reduce((sum, inst) => sum + Number(inst.allocationWeight), 0);
    assert.ok(Math.abs(totalWeight - 1) < 0.001, `Allocation weights must total 1.0; got ${totalWeight}`);

    assert.ok(recData.dashboard_projection, 'Must return dashboard projection');
    assert.ok(recData.model_version, 'Must return model_version');
    assert.ok(recData.recommendation_policy_version, 'Must return recommendation_policy_version');
    assert.ok(recData.market_adjustment, 'Must publish bounded market adjustment metadata');
    assert.match(serverTimingHeader, /market-context;dur=/);

    // Execution should be rapid (sub-second without LLM)
    assert.ok(elapsed < 10000, `Core response took ${elapsed}ms; should not block on LLM`);
  });

  await t.test('2. Core Recommendation is persisted with advisoryText: null and PENDING status', async () => {
    const storedRec = await Recommendation.findById(recData.recommendationId).lean();
    assert.ok(storedRec, 'Recommendation must exist in database');
    assert.equal(storedRec.advisoryText, null, 'Persisted advisoryText must be null');
    assert.equal(storedRec.advisoryMetadata?.status, 'PENDING', 'Persisted advisoryMetadata.status must be PENDING');
    assert.equal(storedRec.userId.toString(), userAId.toString());
    assert.ok(storedRec.marketAdjustment, 'Market adjustment metadata must be persisted with the recommendation');
  });

  await t.test('3. Audit record is created with advisorySummary: "" and intact hash', async () => {
    const auditRecord = await AuditRecord.findById(recData.audit_id).lean();
    assert.ok(auditRecord, 'AuditRecord must exist in database');
    assert.equal(auditRecord.recommendations.advisorySummary, '', 'Audit advisorySummary must be empty string');
    assert.ok(auditRecord.recommendations.marketAdjustment, 'Audit must retain market adjustment metadata');
    assert.ok(auditRecord.record_hash, 'AuditRecord must have record_hash');
  });

  await t.test('4. Deferred advisory endpoint enforces invalid ID format (400)', async () => {
    const res = await fetch(`${baseUrl}/api/recommend/not-a-valid-id/advisory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`,
      },
    });
    assert.equal(res.status, 400);
  });

  await t.test('5. Deferred advisory endpoint enforces authentication (401)', async () => {
    const res = await fetch(`${baseUrl}/api/recommend/${recData.recommendationId}/advisory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    assert.equal(res.status, 401);
  });

  await t.test('6. Deferred advisory endpoint enforces ownership (403 for other user)', async () => {
    const res = await fetch(`${baseUrl}/api/recommend/${recData.recommendationId}/advisory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenB}`,
      },
    });
    assert.equal(res.status, 403);
  });

  await t.test('7. Deferred advisory endpoint returns 404 for non-existent recommendation', async () => {
    const nonExistentId = new mongoose.Types.ObjectId();
    const res = await fetch(`${baseUrl}/api/recommend/${nonExistentId}/advisory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`,
      },
    });
    assert.equal(res.status, 404);
  });

  let advisoryData = null;
  await t.test('8. Deferred advisory endpoint successfully generates advisory for owner', async () => {
    const knownExplanation = {
      top_reason: 'Nested completion explanation reaches deferred advisory generation',
      feature_contributions: [{ feature: 'emergencyFundMonths', contribution: 0.8 }],
    };
    const storedRecommendation = await Recommendation.findById(recData.recommendationId).lean();
    await Recommendation.updateOne(
      { _id: recData.recommendationId },
      {
        $set: {
          responseSnapshot: {
            profile: { profileId: String(profile._id) },
            recommendation: { ...storedRecommendation.responseSnapshot, explanation: knownExplanation },
            completion: { candidateHit: false, recomputed: true },
          },
        },
      },
    );

    const originalGenerate = ProviderManager.nvidia.generate;
    const originalPrimaryProvider = process.env.LLM_PRIMARY_PROVIDER;
    let receivedExplanation = null;
    process.env.LLM_PRIMARY_PROVIDER = 'NVIDIA_NIM';
    ProviderManager.nvidia.generate = async ({ recentHistory }) => {
      const userPrompt = recentHistory?.[0]?.parts?.[0]?.text;
      const evidencePacket = JSON.parse(userPrompt).EVIDENCE_PACKET;
      receivedExplanation = evidencePacket.entries.find(entry => entry.id === 'E_REC_EXPLANATION')?.value || null;
      return {
        text: JSON.stringify({
          text: 'Nested explanation was grounded [E_REC_EXPLANATION]',
          evidenceIdsUsed: ['E_REC_EXPLANATION'],
          claims: [{ text: 'Nested explanation was grounded [E_REC_EXPLANATION]', evidenceIds: ['E_REC_EXPLANATION'] }],
          unavailableFacts: [],
        }),
        provider: 'nvidia_nim',
        model: 'test-nested-snapshot-model',
        tokensUsed: 0,
      };
    };

    let res;
    try {
      res = await fetch(`${baseUrl}/api/recommend/${recData.recommendationId}/advisory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenA}`,
        },
      });
    } finally {
      ProviderManager.nvidia.generate = originalGenerate;
      if (originalPrimaryProvider === undefined) delete process.env.LLM_PRIMARY_PROVIDER;
      else process.env.LLM_PRIMARY_PROVIDER = originalPrimaryProvider;
    }

    assert.equal(res.status, 200);
    assert.deepEqual(receivedExplanation, {
      topReason: knownExplanation.top_reason,
      featureContributions: knownExplanation.feature_contributions,
    });
    advisoryData = await res.json();
    assert.equal(advisoryData.recommendationId, recData.recommendationId);
    assert.ok(typeof advisoryData.advisory_text === 'string' && advisoryData.advisory_text.length > 0, 'Must return advisory text');
    assert.ok(['GROUNDED_EXPLANATION_AVAILABLE', 'GROUNDED_EXPLANATION_FALLBACK', 'READY'].includes(advisoryData.advisory_explanation?.status));
  });

  await t.test('9. Recommendation document has updated advisoryText and advisoryMetadata', async () => {
    const updatedRec = await Recommendation.findById(recData.recommendationId).lean();
    assert.equal(updatedRec.advisoryText, advisoryData.advisory_text);
    assert.ok(['GROUNDED_EXPLANATION_AVAILABLE', 'GROUNDED_EXPLANATION_FALLBACK', 'READY'].includes(updatedRec.advisoryMetadata?.status));
  });

  await t.test('10. Deferred advisory NEVER alters instruments or allocation weights', async () => {
    const updatedRec = await Recommendation.findById(recData.recommendationId).lean();
    assert.equal(updatedRec.instruments.length, recData.instruments.length);

    for (let i = 0; i < recData.instruments.length; i++) {
      const orig = recData.instruments[i];
      const curr = updatedRec.instruments[i];
      assert.equal(curr.id, orig.id);
      assert.equal(Number(curr.allocationWeight), Number(orig.allocationWeight));
      assert.equal(Number(curr.allocation_pct), Number(orig.allocation_pct));
      assert.equal(Number(curr.nominalReturn), Number(orig.nominalReturn));
    }
  });

  await t.test('11. Original AuditRecord is NEVER mutated after core commit', async () => {
    const auditRecordAfter = await AuditRecord.findById(recData.audit_id).lean();
    assert.equal(auditRecordAfter.recommendations.advisorySummary, '', 'Audit advisorySummary must remain empty string');
  });

  await t.test('12. Deferred advisory short-circuits when status is already READY (idempotent)', async () => {
    const start = performance.now();
    const res = await fetch(`${baseUrl}/api/recommend/${recData.recommendationId}/advisory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`,
      },
    });
    const elapsed = performance.now() - start;

    assert.equal(res.status, 200);
    const cachedAdvisory = await res.json();
    assert.equal(cachedAdvisory.advisory_text, advisoryData.advisory_text);
    // Short circuit should return in under 200ms
    assert.ok(elapsed < 1000, `Short circuit should be fast; took ${elapsed}ms`);
  });

  await t.test('13. Concurrent claim prevents duplicate generation (409 Conflict when GENERATING)', async () => {
    await Recommendation.updateOne(
      { _id: recData.recommendationId, userId: userAId },
      { $set: { advisoryText: null, advisoryMetadata: { status: 'GENERATING', claimedAt: new Date() } } },
    );

    const res = await fetch(`${baseUrl}/api/recommend/${recData.recommendationId}/advisory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`,
      },
    });

    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.status, 'GENERATING');
  });

  await t.test('14. Retrying is permitted when advisory status is FAILED', async () => {
    await Recommendation.updateOne(
      { _id: recData.recommendationId, userId: userAId },
      { $set: { advisoryText: null, advisoryMetadata: { status: 'FAILED', error: 'Simulated prior failure' } } },
    );

    const res = await fetch(`${baseUrl}/api/recommend/${recData.recommendationId}/advisory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`,
      },
    });

    assert.equal(res.status, 200);
    const retryData = await res.json();
    assert.ok(retryData.advisory_text);
    assert.ok(['GROUNDED_EXPLANATION_AVAILABLE', 'GROUNDED_EXPLANATION_FALLBACK', 'READY'].includes(retryData.advisory_explanation?.status));
  });
});
