import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'your-256-bit-secret-must-be-at-least-32-characters-long';
const profile = {
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

function serverTiming(response) {
  return response.headers.get('server-timing') || '(not returned)';
}

async function post(path, body, headers) {
  const started = performance.now();
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const elapsedMs = performance.now() - started;
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* preserve the raw failure below */ }
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${text}`);
  return { json, elapsedMs, serverTiming: serverTiming(response) };
}

async function run() {
  const userId = new mongoose.Types.ObjectId().toString();
  const token = jwt.sign(
    { userId, email: `profile_latency_${Date.now()}@wealthgenie.com`, role: 'user', jti: crypto.randomUUID() },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
  const headers = { Authorization: `Bearer ${token}` };

  const precompute = await post('/api/profile/precompute', profile, headers);
  console.log(JSON.stringify({
    phase: 'precompute',
    elapsedMs: Number(precompute.elapsedMs.toFixed(2)),
    serverTiming: precompute.serverTiming,
    candidateId: precompute.json?.candidateId,
  }));

  const candidateHit = await post('/api/profile/complete', {
    ...profile,
    candidateId: precompute.json.candidateId,
  }, { ...headers, 'Idempotency-Key': crypto.randomUUID() });
  console.log(JSON.stringify({
    phase: 'candidate-hit-complete',
    elapsedMs: Number(candidateHit.elapsedMs.toFixed(2)),
    serverTiming: candidateHit.serverTiming,
    candidateHit: candidateHit.json?.completion?.candidateHit,
    recomputed: candidateHit.json?.completion?.recomputed,
  }));

  const candidateMiss = await post('/api/profile/complete', profile, {
    ...headers,
    'Idempotency-Key': crypto.randomUUID(),
  });
  console.log(JSON.stringify({
    phase: 'candidate-miss-complete',
    elapsedMs: Number(candidateMiss.elapsedMs.toFixed(2)),
    serverTiming: candidateMiss.serverTiming,
    candidateHit: candidateMiss.json?.completion?.candidateHit,
    recomputed: candidateMiss.json?.completion?.recomputed,
  }));
  console.log('Interpret timings from the three measured requests; this script intentionally does not claim a baseline or sub-100ms result.');
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
