import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'your-256-bit-secret-must-be-at-least-32-characters-long';

console.log('--- WEALTHGENIE LATENCY BENCHMARK: AFTER DECOUPLING ---');
console.log(`Connecting to: ${BASE_URL}`);

// Canonical profile payload (snake_case)
const canonicalProfile = {
  monthly_take_home: 120000,
  monthly_savings: 40000,
  age: 32,
  risk_tolerance: 'Moderate',
  sold_property_proceeds: 0,
  has_lump_sum: false,
  lump_sum_amount: 0,
  liquid_savings: 300000,
  emi_burden_pct: 10,
  financial_dependents: 1,
  emergency_fund_months: 6,
  investment_goals: ['Wealth Growth', 'Retirement'],
  investment_horizon_years: 15,
};

async function run() {
  const userId = new mongoose.Types.ObjectId().toString();
  const token = jwt.sign(
    { userId, email: `latency_test_${Date.now()}@wealthgenie.com`, role: 'user', jti: crypto.randomUUID() },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  // Step 1: Create profile
  console.log('\n1. Creating Financial Profile via POST /api/profile/build...');
  const profRes = await fetch(`${BASE_URL}/api/profile/build`, {
    method: 'POST',
    headers,
    body: JSON.stringify(canonicalProfile),
  });

  if (!profRes.ok) {
    const errText = await profRes.text();
    throw new Error(`Profile creation failed (${profRes.status}): ${errText}`);
  }

  const profData = await profRes.json();
  const profileId = profData.profileId;
  console.log(`Profile created successfully! profileId: ${profileId}`);

  // Step 2: Measure core POST /api/recommend latency (AFTER DECOUPLING)
  console.log('\n2. Benchmarking Core POST /api/recommend (Decoupled sync path)...');
  const runs = 3;
  const coreLatencies = [];
  let lastRecData = null;
  let lastServerTiming = null;

  for (let i = 1; i <= runs; i++) {
    const t0 = performance.now();
    const recRes = await fetch(`${BASE_URL}/api/recommend`, {
      method: 'POST',
      headers: {
        ...headers,
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({ profileId }),
    });
    const dur = performance.now() - t0;
    coreLatencies.push(dur);

    if (!recRes.ok) {
      const err = await recRes.text();
      throw new Error(`Recommend request failed (${recRes.status}): ${err}`);
    }

    lastServerTiming = recRes.headers.get('server-timing');
    lastRecData = await recRes.json();
    console.log(`  Run ${i}: ${dur.toFixed(2)}ms | Server-Timing: ${lastServerTiming}`);
  }

  const avgCoreLatency = coreLatencies.reduce((a, b) => a + b, 0) / coreLatencies.length;
  console.log(`\n=> CORE RECOMMENDATION AVERAGE LATENCY: ${avgCoreLatency.toFixed(2)}ms`);
  console.log(`   Advisory Status in Core Response: ${lastRecData.advisory_explanation?.status || lastRecData.advisoryStatus}`);
  console.log(`   Advisory Text in Core Response: ${lastRecData.advisory_text}`);
  console.log(`   Instruments Count: ${lastRecData.recommendations?.length || lastRecData.instruments?.length}`);

  // Step 3: Measure deferred POST /api/recommend/:id/advisory latency
  const recId = lastRecData.recommendationId || lastRecData._id;
  console.log(`\n3. Benchmarking Deferred POST /api/recommend/${recId}/advisory...`);
  const t0Adv = performance.now();
  const advRes = await fetch(`${BASE_URL}/api/recommend/${recId}/advisory`, {
    method: 'POST',
    headers,
  });
  const advDur = performance.now() - t0Adv;

  if (!advRes.ok) {
    const err = await advRes.text();
    console.warn(`  Advisory deferred fetch returned ${advRes.status}: ${err}`);
  } else {
    const advData = await advRes.json();
    console.log(`  Advisory generation took: ${advDur.toFixed(2)}ms`);
    console.log(`  Advisory Status: ${advData.advisory_explanation?.status || advData.status}`);
    console.log(`  Advisory Text length: ${advData.advisory_text?.length || 0} characters`);
  }

  // Summary Comparison
  console.log('\n======================================================');
  console.log('LATENCY COMPARISON SUMMARY');
  console.log('======================================================');
  console.log('BEFORE DECOUPLING (Sync LLM in POST /api/recommend):');
  console.log('  Core /api/recommend latency: ~31,000ms (~31s)');
  console.log('  Dashboard blocked time:      ~31,000ms');
  console.log('\nAFTER DECOUPLING (Immediate Core + Deferred Advisory):');
  console.log(`  Core /api/recommend latency: ${avgCoreLatency.toFixed(2)}ms`);
  console.log(`  Dashboard unblocked time:    ${avgCoreLatency.toFixed(2)}ms`);
  const improvementPct = ((31000 - avgCoreLatency) / 31000) * 100;
  const speedup = (31000 / avgCoreLatency).toFixed(1);
  console.log(`  LATENCY REDUCTION:           ${improvementPct.toFixed(1)}% faster (${speedup}x speedup!)`);
  console.log('======================================================');
}

run().catch((err) => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
