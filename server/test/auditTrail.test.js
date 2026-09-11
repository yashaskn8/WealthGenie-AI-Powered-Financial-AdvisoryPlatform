import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import express from 'express';
import jwt from 'jsonwebtoken';
import { setupTestDatabase, teardownTestDatabase } from './helpers/mongoTestHelper.js';
import { canonicalProfile } from './helpers/canonicalProfile.js';

import AuditRecord from '../models/AuditRecord.js';
import FinancialProfile from '../models/FinancialProfile.js';
import Recommendation from '../models/Recommendation.js';
import recommendRoutes from '../routes/recommend.js';
import { RECOMMENDATION_POLICY_VERSION } from '../services/recommendationProfile.js';
import { REGULATORY_RULE_VERSION } from '../services/taxEngine.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { correlationIdMiddleware } from '../middleware/correlation.js';
import { withServer, jsonRequest } from '../test-utils/httpTestUtils.js';

process.env.JWT_SECRET = 'audit-trail-test-secret';
process.env.NODE_ENV = 'test';
process.env.DISABLE_RATE_LIMIT = 'true';

const testUserId = new mongoose.Types.ObjectId();
const otherUserId = new mongoose.Types.ObjectId();
const testToken = jwt.sign({ userId: testUserId.toString(), role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const otherToken = jwt.sign({ userId: otherUserId.toString(), role: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h' });

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(correlationIdMiddleware);
  app.use('/api/recommend', recommendRoutes);
  app.use(errorHandler);
  return app;
}

describe('AuditRecord - Complete Advisory Audit Trail Verification', () => {
  let profile;

  before(async () => {
    await setupTestDatabase();

    // Create a real test financial profile in DB
    profile = await FinancialProfile.create({
      userId: testUserId,
      ...canonicalProfile({
        monthlyTakeHome: 150000, monthlySavings: 50000, age: 32,
        liquidSavings: 500000, investmentHorizonYears: 15,
      }),
      recommendationProfileVersion: 'financial-profile-1.0.0',
    });
  });

  after(async () => {
    await FinancialProfile.deleteMany({ userId: { $in: [testUserId, otherUserId] } });
    await Recommendation.deleteMany({ userId: { $in: [testUserId, otherUserId] } });
    await AuditRecord.deleteMany({ userId: { $in: [testUserId, otherUserId] } });
    await teardownTestDatabase();
  });

  it('1. Generates recommendation and synchronously creates tamper-evident AuditRecord', async () => {
    await withServer(buildApp(), async (baseUrl) => {
      const { response, body } = await jsonRequest(`${baseUrl}/api/recommend`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${testToken}`,
          'X-Correlation-ID': 'audit-test-corr-001',
          'Idempotency-Key': 'audit-success-001',
        },
        body: JSON.stringify({ profileId: profile._id.toString() }),
      });

      assert.equal(response.status, 200, `Expected 200, got ${response.status}: ${JSON.stringify(body)}`);
      assert.ok(body.recommendationId, 'Expected recommendationId');
      assert.ok(body.audit_id, 'Expected audit_id in response');
      assert.ok(body.audit_hash, 'Expected audit_hash in response');
      assert.equal(body.recommendation_policy_version, RECOMMENDATION_POLICY_VERSION);
      assert.notEqual(RECOMMENDATION_POLICY_VERSION, REGULATORY_RULE_VERSION);

      // Verify AuditRecord in MongoDB
      const auditDoc = await AuditRecord.findById(body.audit_id);
      assert.ok(auditDoc, 'AuditRecord document must exist in MongoDB');
      assert.equal(auditDoc.userId.toString(), testUserId.toString());
      assert.equal(auditDoc.profileId.toString(), profile._id.toString());
      assert.equal(auditDoc.recommendationId.toString(), body.recommendationId.toString());
      assert.equal(auditDoc.correlationId, 'audit-test-corr-001');
      assert.equal(auditDoc.record_hash, body.audit_hash);
      assert.equal(auditDoc.previous_hash, 'GENESIS');
      assert.equal(auditDoc.hash_algorithm, 'sha256');
      assert.equal(auditDoc.schema_version, '1.0');
      assert.ok(auditDoc.version_id, 'Must have model/engine version_id');
      assert.equal(auditDoc.regulatory_rule_version, REGULATORY_RULE_VERSION);
      assert.equal(auditDoc.inputs.regulatory_rule_version, REGULATORY_RULE_VERSION);
      assert.equal(auditDoc.inputs.recommendation_policy_version, RECOMMENDATION_POLICY_VERSION);
      assert.ok(auditDoc.inputs, 'Must store sanitized inputs');
      assert.equal(auditDoc.inputs.age, 32);
      assert.equal(auditDoc.inputs.monthly_take_home, 150000);
      assert.equal(auditDoc.inputs.monthly_savings, 50000);
      assert.equal(auditDoc.inputs.final_suitability_risk, 'Moderate');
      assert.equal(auditDoc.inputs.annual_income, undefined);
      assert.equal(auditDoc.inputs.tax_regime, undefined);
      assert.ok(auditDoc.recommendations, 'Must store recommendations output');
      assert.ok(Array.isArray(auditDoc.recommendations.instruments), 'Must store instruments');
      assert.ok(['ml_service', 'rule_fallback', 'rule_based'].includes(auditDoc.engine), `Valid engine: ${auditDoc.engine}`);
    });
  });

  it('2. GET /api/recommend/audit retrieves user audit history with pagination', async () => {
    await withServer(buildApp(), async (baseUrl) => {
      const { response, body } = await jsonRequest(`${baseUrl}/api/recommend/audit?limit=10&skip=0`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${testToken}`,
        },
      });

      assert.equal(response.status, 200);
      assert.equal(body.status, 'success');
      assert.ok(body.total >= 1, 'Total records should be >= 1');
      assert.ok(body.records.length >= 1, 'Records array should not be empty');
      assert.equal(body.records[0].userId.toString(), testUserId.toString());
      assert.ok(body.records[0].input_hash, 'Record should have input_hash');
    });
  });

  it('GET /api/recommend/audit/verify validates the authenticated user chain', async () => {
    await withServer(buildApp(), async (baseUrl) => {
      const { response, body } = await jsonRequest(`${baseUrl}/api/recommend/audit/verify`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${testToken}` },
      });
      assert.equal(response.status, 200);
      assert.equal(body.valid, true, JSON.stringify(body.errors));
      assert.ok(body.checkedRecords >= 1);
    });
  });

  it('3. GET /api/recommend/audit/:id retrieves specific audit record and enforces ownership', async () => {
    // Find an existing audit record for testUserId
    const auditDoc = await AuditRecord.findOne({ userId: testUserId });
    assert.ok(auditDoc, 'Pre-existing auditDoc required');

    await withServer(buildApp(), async (baseUrl) => {
      // Authorized owner request
      const { response: okRes, body: okBody } = await jsonRequest(`${baseUrl}/api/recommend/audit/${auditDoc._id}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${testToken}` },
      });
      assert.equal(okRes.status, 200);
      assert.equal(okBody.record._id.toString(), auditDoc._id.toString());

      // Unauthorized other user request
      const { response: denyRes } = await jsonRequest(`${baseUrl}/api/recommend/audit/${auditDoc._id}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${otherToken}` },
      });
      assert.equal(denyRes.status, 403, 'Should deny access to non-owner non-admin');
    });
  });

  it('4. Strict Fail-Loudly: If AuditRecord.create fails, recommendation request FAILS with HTTP 500', async () => {
    const originalCreate = AuditRecord.create;
    // Mock AuditRecord.create to simulate a database write error
    AuditRecord.create = async () => {
      throw new Error('Database disk I/O failure during audit write');
    };

    try {
      await withServer(buildApp(), async (baseUrl) => {
        const { response, body } = await jsonRequest(`${baseUrl}/api/recommend`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${testToken}`,
            'X-Correlation-ID': 'fail-loudly-corr-test',
            'Idempotency-Key': 'audit-failure-001',
          },
          body: JSON.stringify({ profileId: profile._id.toString() }),
        });

        assert.equal(response.status, 500, 'Must return HTTP 500 when audit write fails');
        assert.ok(
          (body.message && body.message.toLowerCase().includes('audit')) || (body.error && body.error.toLowerCase().includes('audit')),
          `Expected audit error message, got: ${JSON.stringify(body)}`
        );
      });
    } finally {
      // Restore original AuditRecord.create
      AuditRecord.create = originalCreate;
    }
  });
});
