import 'dotenv/config';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import assert from 'node:assert/strict';
import { RECOMMENDATION_POLICY_VERSION } from '../services/recommendationProfile.js';
import { getCurrentRegulatoryRuleVersion } from '../services/taxEngine.js';

const BASE_URL = 'http://127.0.0.1:5000';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET environment variable is required to run live verification scripts.');
  process.exit(1);
}

async function runLiveRegulatoryAuditVerification() {
  const regulatoryRuleVersion = getCurrentRegulatoryRuleVersion();
  if (!regulatoryRuleVersion) {
    throw new Error('No verified regulatory policy is available for the current fiscal year.');
  }
  console.log(`\n================================================================`);
  console.log(`[${new Date().toISOString()}] PHASE 2: REGULATORY RULE VERSIONING LIVE AUDIT TEST`);
  console.log(`================================================================`);

  const userId = crypto.randomBytes(12).toString('hex');
  const token = jwt.sign({ userId, email: `test_audit_${Date.now()}@wealthgenie.io`, role: 'user' }, JWT_SECRET, { expiresIn: '1h' });

  const client = axios.create({
    baseURL: BASE_URL,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  // Step 1: Initialize profile
  console.log(`[${new Date().toISOString()}] Step 1: Building test profile...`);
  const profileRes = await client.post('/api/profile/build', {
    age: 34,
    monthly_take_home: 180000,
    monthly_savings: 60000,
    risk_tolerance: 'Moderate',
    sold_property_proceeds: 0,
    has_lump_sum: false,
    lump_sum_amount: 0,
    liquid_savings: 500000,
    emi_burden_pct: 15,
    financial_dependents: 2,
    emergency_fund_months: 6,
    investment_goals: ['Wealth Growth'],
    investment_horizon_years: 15,
  });
  const profileId = profileRes.data.profileId;
  assert.ok(profileId, 'Profile must be created');

  // Step 2: Request recommendation
  console.log(`[${new Date().toISOString()}] Step 2: Requesting recommendation via POST /api/recommend...`);
  const recommendRes = await client.post('/api/recommend', { profileId });
  assert.equal(recommendRes.status, 200);

  console.log(`\n================= LIVE RECOMMENDATION AUDIT REPORT =================`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Recommendation ID: ${recommendRes.data.recommendationId}`);
  console.log(`Audit ID: ${recommendRes.data.audit_id}`);
  console.log(`Audit Hash: ${recommendRes.data.audit_hash}`);
  console.log(`Model Version: ${recommendRes.data.model_version}`);
  console.log(`Recommendation Policy Version: ${recommendRes.data.recommendation_policy_version}`);
  console.log(`Instruments Count: ${recommendRes.data.instruments?.length}`);
  console.log(`Portfolio Yield: ${recommendRes.data.portfolio_yield}%`);

  assert.equal(recommendRes.data.recommendation_policy_version, RECOMMENDATION_POLICY_VERSION);
  assert.ok(recommendRes.data.audit_id, 'audit_id must be present');
  assert.ok(recommendRes.data.audit_hash, 'audit_hash must be present');

  // Step 3: Query GET /api/recommend/audit
  console.log(`\n[${new Date().toISOString()}] Step 3: Querying GET /api/recommend/audit...`);
  const auditRes = await client.get('/api/recommend/audit');
  assert.equal(auditRes.status, 200);
  assert.ok(auditRes.data.records?.length > 0, 'Must return at least 1 audit record');

  const latestRecord = auditRes.data.records[0];
  console.log(`\n=================== STORED AUDIT RECORD REPORT ===================`);
  console.log(`Record ID: ${latestRecord._id}`);
  console.log(`User ID: ${latestRecord.userId}`);
  console.log(`Profile ID: ${latestRecord.profileId}`);
  console.log(`Version ID: ${latestRecord.version_id}`);
  console.log(`Regulatory Rule Version: ${latestRecord.regulatory_rule_version}`);
  console.log(`Input Hash: ${latestRecord.input_hash}`);
  console.log(`Engine: ${latestRecord.engine}`);
  console.log(`Timestamp: ${latestRecord.timestamp}`);
  console.log(`Recommendations Count: ${latestRecord.recommendations?.instruments?.length}`);
  console.log(`==================================================================\n`);

  assert.equal(latestRecord.regulatory_rule_version, regulatoryRuleVersion);
  assert.notEqual(regulatoryRuleVersion, RECOMMENDATION_POLICY_VERSION);
  assert.ok(latestRecord.version_id, 'version_id must be present');
  assert.ok(latestRecord.input_hash, 'input_hash must be present');

  console.log(`✅ Verified: recommendation policy '${RECOMMENDATION_POLICY_VERSION}' and statutory tax policy '${regulatoryRuleVersion}' remain distinct in the tamper-evident advisory audit chain.`);
}

runLiveRegulatoryAuditVerification().catch(err => {
  console.error('Regulatory Audit Verification Failed:', err.response?.data || err);
  process.exit(1);
});
