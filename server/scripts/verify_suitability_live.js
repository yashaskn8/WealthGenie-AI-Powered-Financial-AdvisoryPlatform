import 'dotenv/config';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import assert from 'node:assert/strict';

const BASE_URL = 'http://127.0.0.1:5000';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET environment variable is required to run live verification scripts.');
  process.exit(1);
}

async function runLiveSuitabilityVerification() {
  console.log(`\n================================================================`);
  console.log(`[${new Date().toISOString()}] PHASE 3: LIVE ADVERSARIAL SUITABILITY & CONCENTRATION TEST`);
  console.log(`================================================================`);

  const userId = crypto.randomBytes(12).toString('hex');
  const token = jwt.sign({ userId, email: `suitability_test_${Date.now()}@wealthgenie.io`, role: 'user' }, JWT_SECRET, { expiresIn: '1h' });

  const client = axios.create({
    baseURL: BASE_URL,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  // ----------------------------------------------------
  // Scenario 1: Conservative Senior Citizen (Manipulated Horizon)
  // ----------------------------------------------------
  console.log(`\n[Live Scenario 1] Conservative Senior Citizen (Age 65, Horizon Manipulated to 25 yrs)...`);
  const prof1Res = await client.post('/api/profile/build', {
    age: 65,
    monthly_take_home: 120000,
    monthly_savings: 30000,
    risk_tolerance: 'Conservative',
    sold_property_proceeds: 0,
    has_lump_sum: false,
    lump_sum_amount: 0,
    liquid_savings: 800000,
    emi_burden_pct: 0,
    financial_dependents: 1,
    emergency_fund_months: 12,
    investment_goals: ['Retirement'],
    investment_horizon_years: 25,
  });
  const prof1Id = prof1Res.data.profileId;

  const rec1Res = await client.post('/api/recommend', { profileId: prof1Id });
  console.log(`  Recommendation ID: ${rec1Res.data.recommendationId}`);
  console.log(`  Final Risk Tier: ${rec1Res.data.final_risk_tier}`);
  console.log(`  Capacity Score: ${rec1Res.data.capacity_score}, Preference Score: ${rec1Res.data.preference_score}`);
  console.log(`  Reconciliation Note: ${rec1Res.data.reconciliation_note}`);

  let lowAlloc1 = 0;
  let highAlloc1 = 0;
  rec1Res.data.instruments.forEach(inst => {
    console.log(`    - ${inst.name} [Type: ${inst.type}, Risk: ${inst.riskScore}]: ${inst.allocation_pct}% (Weight: ${inst.allocationWeight})`);
    if (inst.riskScore <= 2) lowAlloc1 += inst.allocation_pct;
    if (inst.riskScore >= 4) highAlloc1 += inst.allocation_pct;
  });
  console.log(`  Total Low Risk: ${lowAlloc1.toFixed(1)}%, Total High Risk: ${highAlloc1.toFixed(1)}%`);

  assert.equal(rec1Res.data.final_risk_tier, 'Conservative');
  assert.equal(highAlloc1, 0, 'High-risk instruments must be excluded for Conservative suitability');
  assert.ok(lowAlloc1 >= 99.9, 'Conservative recommendations must remain within the low-risk ceiling');

  // ----------------------------------------------------
  // Scenario 2: Aggressive Multi-Instrument Concentration Gaming
  // ----------------------------------------------------
  console.log(`\n[Live Scenario 2] Aggressive Profile (Attempting Multi-Instrument Concentration Bypass)...`);
  const prof2Res = await client.post('/api/profile/build', {
    age: 26,
    monthly_take_home: 250000,
    monthly_savings: 100000,
    risk_tolerance: 'Aggressive',
    sold_property_proceeds: 0,
    has_lump_sum: false,
    lump_sum_amount: 0,
    liquid_savings: 500000,
    emi_burden_pct: 5,
    financial_dependents: 0,
    emergency_fund_months: 6,
    investment_goals: ['Wealth Growth'],
    investment_horizon_years: 20,
  });
  const prof2Id = prof2Res.data.profileId;

  const rec2Res = await client.post('/api/recommend', { profileId: prof2Id });
  console.log(`  Recommendation ID: ${rec2Res.data.recommendationId}`);
  console.log(`  Final Risk Tier: ${rec2Res.data.final_risk_tier}`);

  let smallcapAlloc = 0;
  let midcapAlloc = 0;
  rec2Res.data.instruments.forEach(inst => {
    console.log(`    - ${inst.name} [Type: ${inst.type}]: ${inst.allocation_pct}% (Weight: ${inst.allocationWeight})`);
    const typeLower = (inst.type || '').toLowerCase();
    const nameLower = (inst.name || '').toLowerCase();
    if (typeLower.includes('smallcap') || nameLower.includes('small-cap') || nameLower.includes('small cap')) smallcapAlloc += inst.allocation_pct;
    if (typeLower.includes('midcap') || nameLower.includes('mid-cap') || nameLower.includes('mid cap')) midcapAlloc += inst.allocation_pct;
  });

  console.log(`  Aggregate Smallcap: ${smallcapAlloc.toFixed(1)}% (Cap: 15%)`);
  console.log(`  Aggregate Midcap: ${midcapAlloc.toFixed(1)}% (Cap: 20%)`);

  assert.ok(smallcapAlloc <= 15.05, `Smallcap aggregate must be <= 15%`);
  assert.ok(midcapAlloc <= 20.05, `Midcap aggregate must be <= 20%`);

  // ----------------------------------------------------
  // Scenario 3: Mismatch Safeguard (Capacity C=1 vs Preference T=5)
  // ----------------------------------------------------
  console.log(`\n[Live Scenario 3] Mismatched Profile Safeguard (Capacity C=1 vs Preference T=5)...`);
  const prof3Res = await client.post('/api/profile/build', {
    age: 58,
    monthly_take_home: 90000,
    monthly_savings: 10000,
    risk_tolerance: 'Aggressive',
    sold_property_proceeds: 0,
    has_lump_sum: false,
    lump_sum_amount: 0,
    liquid_savings: 50000,
    emi_burden_pct: 40,
    financial_dependents: 3,
    emergency_fund_months: 1,
    investment_goals: ['Retirement'],
    investment_horizon_years: 5,
  });
  const prof3Id = prof3Res.data.profileId;

  const rec3Res = await client.post('/api/recommend', { profileId: prof3Id });
  console.log(`  Recommendation ID: ${rec3Res.data.recommendationId}`);
  console.log(`  Capacity Score: ${rec3Res.data.capacity_score}, Stated Preference: ${rec3Res.data.preference_score}`);
  console.log(`  Final Risk Tier: ${rec3Res.data.final_risk_tier}`);
  console.log(`  Advisory Note: "${rec3Res.data.advisory_note}"`);

  assert.equal(rec3Res.data.preference_score, 5);
  assert.notEqual(rec3Res.data.final_risk_tier, 'Aggressive');
  assert.ok(rec3Res.data.suitability_reason_codes.includes('RISK_CAPACITY_REDUCED_PREFERENCE'));
  assert.match(rec3Res.data.advisory_note, /capped below the stated preference/i);

  console.log(`\n================================================================`);
  console.log(`✅ All Live Adversarial Suitability and Concentration Tests Passed!`);
  console.log(`================================================================\n`);
}

runLiveSuitabilityVerification().catch(err => {
  console.error('Suitability Verification Failed:', err.response?.data || err);
  process.exit(1);
});
