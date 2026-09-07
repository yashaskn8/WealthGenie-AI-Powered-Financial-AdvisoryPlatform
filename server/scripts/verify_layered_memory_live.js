import axios from 'axios';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import assert from 'node:assert/strict';
import { LayeredMemoryManager } from '../services/layeredMemoryManager.js';

const BASE_URL = 'http://127.0.0.1:5000';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET environment variable is required to run live verification scripts.');
  process.exit(1);
}

async function runLiveLayeredMemoryVerification() {
  console.log(`\n================================================================`);
  console.log(`[${new Date().toISOString()}] PHASE 3: LAYERED MEMORY LIVE RE-VERIFICATION`);
  console.log(`================================================================`);

  const userId = crypto.randomBytes(12).toString('hex');
  const token = jwt.sign({ userId, email: `test_memory_${Date.now()}@wealthgenie.io`, role: 'user' }, JWT_SECRET, { expiresIn: '1h' });
  const sessionId = `live-mem-session-${Date.now()}`;

  const client = axios.create({
    baseURL: BASE_URL,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 45000,
  });

  // Step 0: Create financial profile for this fresh test user
  console.log(`\n[${new Date().toISOString()}] Step 0: Creating Profile for userId ${userId}...`);
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

  // Step 1: Seed financial goal via live API (persisted in MongoDB and loaded by LayeredMemoryManager)
  console.log(`\n[${new Date().toISOString()}] Step 1: Seeding Goal into Layered Memory via live API...`);
  try {
    await client.post('/api/goals/create', {
      goal_name: 'Electric SUV Luxury Vehicle',
      target_amount: 3200000,
      target_date: '2028-11-01T00:00:00.000Z',
      current_savings: 500000,
      profileId,
      priority: 'High',
    });
    console.log(`- Goal 'Electric SUV Luxury Vehicle' (₹32L, 2028) created in DB.`);
  } catch (err) {
    if (err.response?.status === 409) {
      console.log(`- Goal 'Electric SUV Luxury Vehicle' already exists in DB (reusing existing record).`);
    } else {
      throw err;
    }
  }

  // Also seed memory audit chain in process
  LayeredMemoryManager.saveMidTermMemory({
    userId,
    sessionId,
    key: 'special_vehicle_goal',
    value: 'Electric SUV costing ₹32 Lakhs planned for November 2028',
    ttlMs: 3600000,
  });

  LayeredMemoryManager.saveLongTermFact({
    userId,
    key: 'preferred_tax_strategy',
    value: 'Aggressive Section 80CCD(1B) NPS contribution',
  });

  const initialAudit = LayeredMemoryManager.verifyMemoryAuditChain(userId);
  console.log(`- Untampered Audit Chain Status: valid=${initialAudit.valid}, chainLength=${initialAudit.chainLength}, headHash=${initialAudit.headHash?.slice(0, 16)}...`);
  assert.equal(initialAudit.valid, true);

  // Step 2: Run an 8-turn conversation with pacing to push Turn 1 out of the 5-message working memory window
  console.log(`\n[${new Date().toISOString()}] Step 2: Executing 8-Turn Multi-Turn Session over live HTTP...`);

  const fillerQuestions = [
    'Turn 1: What is the compounding formula for equity mutual funds?',
    'Turn 2: How does PPF 15-year lock-in work?',
    'Turn 3: Explain the difference between Nifty 50 and Sensex.',
    'Turn 4: What are the tax benefits of Sovereign Gold Bonds?',
    'Turn 5: What is the current standard deduction under the new tax regime?',
    'Turn 6: How do liquid funds differ from bank fixed deposits?',
    'Turn 7: What is the annual contribution limit for EPF?',
  ];

  for (let i = 0; i < fillerQuestions.length; i++) {
    const q = fillerQuestions[i];
    console.log(`  -> Sending Turn ${i + 1}: "${q}"`);
    const r = await client.post('/api/chat/message', { message: q, session_id: sessionId });
    console.log(`     Response provider: ${r.data.provider}, chars: ${r.data.response?.length}`);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Turn 8: Recall question that requires retrieval from layered memory
  console.log(`\n[${new Date().toISOString()}] Step 3: Sending Turn 8 (Memory Recall Request)...`);
  const recallPrompt = 'What specific vehicle goal and target amount/year do I have saved in my active profile?';
  const recallRes = await client.post('/api/chat/message', { message: recallPrompt, session_id: sessionId });

  console.log(`\n- Live Turn 8 Response (${recallRes.data.provider}):`);
  console.log(recallRes.data.response);
  console.log(`- Grounded: ${recallRes.data.grounded}`);

  // Assert memory retention in live response
  const hasVehicleFact = /32\s*(?:Lakh|Lakhs|,00,000)|Electric\s*SUV|2028/i.test(recallRes.data.response);
  console.log(`\n- Verified: Earlier context retained across >5 turns via Layered Memory: ${hasVehicleFact}`);
  assert.equal(hasVehicleFact, true, 'Turn 8 response must correctly recall the vehicle goal from layered memory');

  // Step 4: Deliberate Tamper Test on Cryptographic Audit Chain
  console.log(`\n[${new Date().toISOString()}] Step 4: Executing Deliberate Cryptographic Tamper Test...`);
  
  // Directly corrupt one entry in the audit ledger
  const rawLedger = LayeredMemoryManager._getGovernanceLedger(userId);
  assert.ok(rawLedger.length >= 2, 'Audit ledger should have at least 2 entries');
  
  const originalChainHash = rawLedger[0].chainHash;
  console.log(`- Original Entry 0 Chain Hash: ${originalChainHash.slice(0, 16)}...`);
  
  // Tamper with Entry 0's hash
  rawLedger[0].chainHash = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
  console.log(`- Injected malicious hash into Entry 0: ${rawLedger[0].chainHash.slice(0, 16)}...`);

  // Verify that verifyMemoryAuditChain catches the tampering
  const tamperedAudit = LayeredMemoryManager.verifyMemoryAuditChain(userId);
  console.log(`- Tampered Audit Verification Result:`, tamperedAudit);
  
  assert.equal(tamperedAudit.valid, false, 'Audit chain verification MUST fail after tampering');
  assert.equal(tamperedAudit.reason, 'CHAIN_HASH_MISMATCH', 'Audit chain must specifically identify CHAIN_HASH_MISMATCH');
  assert.equal(tamperedAudit.brokenIndex, 0, 'Broken index must identify corrupted entry 0');
  console.log(`✅ Cryptographic Audit Chain successfully detected and rejected deliberate tampering at index ${tamperedAudit.brokenIndex}!`);

  // Restore and verify recovery
  rawLedger[0].chainHash = originalChainHash;
  const restoredAudit = LayeredMemoryManager.verifyMemoryAuditChain(userId);
  assert.equal(restoredAudit.valid, true);
  console.log(`✅ Audit chain re-verified valid upon restoring authentic hash.`);
  console.log(`\n================================================================`);
  console.log(`PHASE 3 LIVE VERIFICATION COMPLETED SUCCESSFULLY`);
  console.log(`================================================================\n`);
}

runLiveLayeredMemoryVerification().catch(err => {
  console.error('Phase 3 Verification Failed:', err);
  process.exit(1);
});
