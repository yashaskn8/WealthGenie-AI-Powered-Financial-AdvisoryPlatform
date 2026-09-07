import 'dotenv/config';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import ConversationHistory from '../models/ConversationHistory.js';
import connectDB from '../config/db.js';

const BASE_URL = 'http://127.0.0.1:5000';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET environment variable is required to run live verification scripts.');
  process.exit(1);
}

async function runLiveSessionSafetyVerification() {
  console.log(`\n================================================================`);
  console.log(`[${new Date().toISOString()}] PHASE 4: SESSION-LEVEL COST & SAFETY CAP LIVE TEST`);
  console.log(`================================================================`);

  await connectDB();

  const userId = crypto.randomBytes(12).toString('hex');
  const token = jwt.sign({ userId, email: `test_safety_${Date.now()}@wealthgenie.io`, role: 'user' }, JWT_SECRET, { expiresIn: '1h' });
  const sessionId = `live-safety-session-${Date.now()}`;

  const client = axios.create({
    baseURL: BASE_URL,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  // Step 1: Initialize profile
  console.log(`[${new Date().toISOString()}] Step 1: Initializing test user profile...`);
  const profileRes = await client.post('/api/profile/build', {
    age: 32,
    monthly_take_home: 150000,
    monthly_savings: 50000,
    risk_tolerance: 'Moderate',
    sold_property_proceeds: 0,
    has_lump_sum: false,
    lump_sum_amount: 0,
    liquid_savings: 400000,
    emi_burden_pct: 10,
    financial_dependents: 1,
    emergency_fund_months: 6,
    investment_goals: ['Wealth Growth'],
    investment_horizon_years: 15,
  });
  const profileId = profileRes.data.profileId;
  assert.ok(profileId, 'Profile must be created');

  // Step 2: Seed an existing ConversationHistory record with 51,500 cumulative tokens (exceeding the 50,000 cap)
  console.log(`[${new Date().toISOString()}] Step 2: Seeding ConversationHistory with 51,500 cumulative tokens...`);
  await ConversationHistory.create({
    userId: new mongoose.Types.ObjectId(userId),
    profileId: new mongoose.Types.ObjectId(profileId),
    session_id: sessionId,
    cumulative_tokens: 51500,
    cumulative_hops: 18,
    messages: [
      { role: 'user', content: 'Prior question 1' },
      { role: 'model', content: 'Prior response 1', metadata: { tokens_used: 25000 } },
      { role: 'user', content: 'Prior question 2' },
      { role: 'model', content: 'Prior response 2', metadata: { tokens_used: 26500 } },
    ],
  });

  // Step 3: Send a real HTTP chat request in this token-exhausted session
  console.log(`[${new Date().toISOString()}] Step 3: Sending live HTTP request to exhausted session ${sessionId}...`);
  const prompt = 'Please compute a 10-year SIP projection and rebalance plan for me.';
  const startTime = Date.now();
  const res = await client.post('/api/chat/message', {
    message: prompt,
    session_id: sessionId,
  });
  const latency = Date.now() - startTime;

  console.log(`\n=================== LIVE SESSION SAFETY CAP REPORT ===================`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`HTTP Status: ${res.status}`);
  console.log(`Latency: ${latency}ms`);
  console.log(`Provider: ${res.data.provider}`);
  console.log(`State: ${res.data.state}`);
  console.log(`Safety Limit Triggered: ${res.data.audit?.safety_limit_triggered}`);
  console.log(`Safety Limit Reason: ${res.data.audit?.safety_limit_reason}`);
  console.log(`Cumulative Session Tokens: ${res.data.audit?.cumulative_session_tokens}`);
  console.log(`\nUser-Facing Final Response Text:\n${res.data.response}`);
  console.log(`======================================================================\n`);

  // Verifications
  assert.equal(res.status, 200);
  assert.equal(res.data.audit?.safety_limit_triggered, true);
  assert.equal(res.data.audit?.safety_limit_reason, 'SESSION_CUMULATIVE_TOKEN_CAP_EXCEEDED');
  assert.match(res.data.response, /⚠️ \*\*Session Safety Limit Reached\*\*/);
  assert.match(res.data.response, /cumulative reasoning token budget \(50,000 tokens\)/);
  console.log(`✅ Verified: Session safety limit successfully caught runaway session and delivered clear user-facing notice!`);

  await mongoose.disconnect();
}

runLiveSessionSafetyVerification().catch(err => {
  console.error('Session Safety Verification Failed:', err.response?.data || err);
  process.exit(1);
});
