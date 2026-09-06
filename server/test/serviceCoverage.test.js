import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import FinancialProfile from '../models/FinancialProfile.js';
import { generateAdvisory, getGoalAdvisory } from '../services/geminiService.js';
import { processChat } from '../services/geminiChatService.js';
import { buildSystemPrompt } from '../services/genieChatSystemPrompt.js';
import { INSTRUMENT_PARAMS, buildRateLookup, getNominalRate, getVolatility, toMonthlyRate, updateLiveParam } from '../services/instrumentConstants.js';
import { fetchIndexStatistics, fetchMutualFundNAVs, checkFDRateStaleness } from '../services/marketDataService.js';
import { checkMLHealth, getMLPrediction, getRuleBasedFallback } from '../services/mlClient.js';
import { queryRAG } from '../services/ragClient.js';
import { computeCAGR, generateProjections, lumpSumFV, realReturn, reverseSIPFromFV, sipFV, stepUpSipFV } from '../services/projectionEngine.js';
import { calculatePostTaxReturn, calculatePostTaxReturnSafe } from '../services/postTaxCalculator.js';
import { assessSuitabilityRisk, encodeRiskCategory, getRiskProfile } from '../services/riskProfiler.js';
import { buildLlmFinancialContext, buildMlProfileInput } from '../services/recommendationProfile.js';
import { canonicalProfile } from './helpers/canonicalProfile.js';

process.env.JWT_SECRET = 'service-coverage-test-secret';
process.env.NODE_ENV = 'test';

function mlInput(overrides = {}) {
  const profile = canonicalProfile(overrides);
  return buildMlProfileInput(profile, assessSuitabilityRisk(profile));
}

function llmProfile(overrides = {}) {
  const profile = canonicalProfile(overrides);
  return buildLlmFinancialContext(profile, assessSuitabilityRisk(profile));
}

test('geminiService uses Gemini before Groq and falls back deterministically', async (t) => {
  const originalPost = axios.post;
  const originalGemini = process.env.GEMINI_API_KEY;
  const originalGroq = process.env.GROQ_API_KEY;
  const calls = [];

  process.env.GEMINI_API_KEY = 'gemini-test-key';
  process.env.GROQ_API_KEY = 'groq-test-key';
  axios.post = async (url) => {
    calls.push(url);
    return { data: { candidates: [{ content: { parts: [{ text: 'Gemini response' }] }, finishReason: 'STOP' }] } };
  };
  t.after(() => {
    axios.post = originalPost;
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalGemini;
    if (originalGroq === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = originalGroq;
  });

  const advisory = await generateAdvisory({ profile: llmProfile({ age: 32, monthlySavings: 20000 }), instruments: [] });
  const goalAdvice = await getGoalAdvisory('Suggest one adjustment.', llmProfile({ age: 32, monthlySavings: 20000 }));

  assert.equal(advisory.text, 'Gemini response');
  assert.equal(goalAdvice, 'Gemini response');
  assert.ok(calls[0].includes('generativelanguage.googleapis.com'));
  assert.ok(calls[1].includes('generativelanguage.googleapis.com'));
});

test('geminiChatService returns profile setup guidance when no profile exists', async (t) => {
  const originalFindOne = FinancialProfile.findOne;
  FinancialProfile.findOne = () => ({ sort: () => ({ lean: async () => null }) });
  t.after(() => { FinancialProfile.findOne = originalFindOne; });

  const result = await processChat({
    userId: 'chat-service-user-no-profile',
    user: { email: 'user@example.com' },
    message: 'What should I invest in?',
    sessionId: 'session-1',
  });

  assert.equal(result.grounded, false);
  assert.match(result.response, /financial profile/i);
});

test('genieChatSystemPrompt grounds prompt only in canonical profile, recommendations, and separate goals', () => {
  const prompt = buildSystemPrompt(
    { name: 'Priya', email: 'p@example.com' },
    canonicalProfile({ age: 35, monthlySavings: 25000, investmentHorizonYears: 15 }),
    { instruments: [{ name: 'Nifty 50 ETF', type: 'ETF', nominalReturn: 10.8, allocationWeight: 0.5 }] },
    null,
    [{ goal_name: 'Retirement', target_amount: 5000000, target_date: '2045-01-01' }]
  );

  assert.match(prompt, /Priya/);
  assert.match(prompt, /Nifty 50 ETF/);
  assert.match(prompt, /Retirement/);
  assert.match(prompt, /ACTION_CARD/);
  assert.match(prompt, /SEBI/);
  const authoritativeSections = prompt.split('# Hard boundaries')[0];
  assert.doesNotMatch(authoritativeSections, /annual income|tax slab/i);
});

test('instrumentConstants exposes immutable rates and live override path', (t) => {
  t.after(() => updateLiveParam('FD', 7.5, 0.005));
  assert.equal(getNominalRate('FD'), 7.5);
  assert.equal(getVolatility('FD'), 0.005);
  assert.equal(getNominalRate('UNKNOWN'), null);
  assert.equal(getVolatility('UNKNOWN'), null);
  assert.equal(toMonthlyRate(0.12), 0.01);
  assert.ok(toMonthlyRate(0.12, true) > 0.009);
  assert.throws(() => { INSTRUMENT_PARAMS.FD = {}; }, /immutable/i);

  updateLiveParam('FD', 6.8, 0.006);
  assert.equal(INSTRUMENT_PARAMS.FD.nominalRate, 6.8);
  assert.equal(buildRateLookup().FD, 6.8);
});

test('marketDataService parses mocked AMFI and Yahoo responses without network', async (t) => {
  const originalGet = axios.get;
  axios.get = async (url) => {
    if (url.includes('NAVAll.txt')) {
      return { data: 'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date\n123;INF;INF;Example Fund;12.34;01-Jan-2026\n' };
    }
    return {
      data: {
        chart: { result: [{ indicators: { quote: [{ close: [100, 102, 104, 103, 106, 108, 110, 111, 115, 117, 119, 121, 123, 126] }] } }] }
      }
    };
  };
  t.after(() => { axios.get = originalGet; });

  const navs = await fetchMutualFundNAVs();
  const stats = await fetchIndexStatistics('^NSEI');

  assert.equal(navs.count, 1);
  assert.equal(navs.navMap['123'].nav, 12.34);
  assert.equal(stats.symbol, '^NSEI');
  assert.ok(Number.isFinite(stats.annualised_return));
  assert.ok(Number.isFinite(stats.annualised_volatility));
});

test('marketDataService FD staleness handles stale counts and model failures', async () => {
  const stale = await checkFDRateStaleness({ countDocuments: async () => 2 });
  const safe = await checkFDRateStaleness({ countDocuments: async () => { throw new Error('db down'); } });

  assert.equal(stale.needs_refresh, true);
  assert.equal(stale.stale_count, 2);
  assert.equal(safe.needs_refresh, false);
});

test('mlClient posts to enriched endpoint and falls back on service failure', async (t) => {
  const originalPost = axios.post;
  const originalGet = axios.get;
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  let postedUrl = '';
  let postedHeaders = null;
  let getHeaders = null;

  axios.post = async (url, payload, config) => {
    postedUrl = url;
    postedHeaders = config?.headers;
    assert.equal(payload.age, 40);
    assert.equal(payload.liquid_savings, 50000);
    return { data: {
      primary: 'ETF', secondary: 'Debt_MF', tertiary: 'ELSS',
      confidence_scores: { ETF: 0.7 }, decision_path: ['risk = Moderate'],
      model_version: '4.0.0', feature_schema_version: 'recommendation-features-4.0.0', explanation: null,
    } };
  };
  axios.get = async (url, config) => {
    getHeaders = config?.headers;
    return { data: { status: 'ok' } };
  };
  t.after(() => { axios.post = originalPost; axios.get = originalGet; console.warn = originalWarn; });

  const prediction = await getMLPrediction(mlInput({
    age: 40, monthlySavings: 25000, liquidSavings: 50000, emergencyFundMonths: 3,
  }));
  const health = await checkMLHealth();

  await assert.rejects(
    getMLPrediction({ age: 40, monthly_savings: 25000 }),
    /recommendation-features-4\.0\.0/,
  );

  axios.post = async () => { throw new Error('offline'); };
  const fallback = await getMLPrediction(mlInput({
    age: 60, monthlyTakeHome: 200000, monthlySavings: 50000,
    liquidSavings: 100000, riskTolerance: 'Conservative', investmentGoals: ['Retirement'],
  }));

  assert.match(postedUrl, /\/predict\/enriched$/);
  // When ML_SERVICE_API_KEY is set, the header must carry its value.
  // When unset, mlClient intentionally omits the header (security: no empty key).
  const expectedKey = process.env.ML_SERVICE_API_KEY || undefined;
  assert.equal(postedHeaders?.['X-API-Key'], expectedKey);
  assert.equal(getHeaders?.['X-API-Key'], expectedKey);
  assert.equal(prediction.primary, 'ETF');
  assert.equal(health.status, 'ok');
  assert.equal(fallback.fallback, true);
  assert.ok(warnings.some(w => w.includes('fallback')));
});

test('mlClient rule fallback produces suitable picks from the v4 feature contract', () => {
  const fallback = getRuleBasedFallback(mlInput({
    age: 35, monthlyTakeHome: 200000, monthlySavings: 50000,
    riskTolerance: 'Aggressive', investmentHorizonYears: 20,
  }));

  assert.equal(fallback.primary, 'Index_MF');
  assert.equal(fallback.secondary, 'Hybrid_MF');
  assert.equal(fallback.fallback, true);
  assert.ok(Object.values(fallback.confidence_scores).every(Number.isFinite));
});

test('mlClient reads the ML URL and API key at request time', async (t) => {
  const originalPost = axios.post;
  const originalUrl = process.env.ML_SERVICE_URL;
  const originalKey = process.env.ML_SERVICE_API_KEY;
  const calls = [];
  axios.post = async (url, _payload, config) => {
    calls.push({ url, headers: config.headers });
    return { data: {
      primary: 'ETF', secondary: 'Debt_MF', tertiary: 'ELSS',
      confidence_scores: { ETF: 0.7 }, decision_path: ['risk = Moderate'],
      model_version: '4.0.0', feature_schema_version: 'recommendation-features-4.0.0', explanation: null,
    } };
  };
  t.after(() => {
    axios.post = originalPost;
    if (originalUrl === undefined) delete process.env.ML_SERVICE_URL; else process.env.ML_SERVICE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.ML_SERVICE_API_KEY; else process.env.ML_SERVICE_API_KEY = originalKey;
  });

  const profile = mlInput({ age: 40, monthlySavings: 25000, emergencyFundMonths: 3 });

  process.env.ML_SERVICE_URL = 'http://ml-one:8000/';
  process.env.ML_SERVICE_API_KEY = 'first-key';
  await getMLPrediction(profile);
  process.env.ML_SERVICE_URL = 'http://ml-two:9000';
  process.env.ML_SERVICE_API_KEY = 'second-key';
  await getMLPrediction(profile);

  assert.deepEqual(calls.map(call => call.url), [
    'http://ml-one:8000/predict/enriched',
    'http://ml-two:9000/predict/enriched',
  ]);
  assert.deepEqual(calls.map(call => call.headers['X-API-Key']), ['first-key', 'second-key']);
});

test('projectionEngine formulas are numerically stable and internally consistent', () => {
  const target = 1000000;
  const sip = reverseSIPFromFV(target, 0.10, 10);
  const fv = sipFV(sip, 0.10, 10);
  const lump = lumpSumFV(100000, 0.10, 5);
  const stepUp = stepUpSipFV(10000, 0.10, 5, 0.10);
  const projections = generateProjections(
    10000, [{ name: 'ETF', type: 'ETF' }], { ETF: 10 }, [5, 10], 0.05, 0.10, 0,
  );

  assert.ok(Math.abs(fv - target) / target < 0.001);
  assert.ok(lump > 100000);
  assert.ok(stepUp > sipFV(10000, 0.10, 5));
  assert.ok(computeCAGR(100000, lump, 5) > 0.09);
  assert.ok(realReturn(0.12, 0.06) > 0.05);
  assert.equal(projections.chartData.length, 2);
});

test('riskProfiler classifies profiles and encodes categories', () => {
  const aggressive = getRiskProfile(canonicalProfile({
    age: 25, monthlyTakeHome: 400000, monthlySavings: 120000,
    liquidSavings: 1000000, emergencyFundMonths: 12,
    riskTolerance: 'Aggressive', investmentHorizonYears: 30,
  }));
  const conservative = getRiskProfile(canonicalProfile({
    age: 70, monthlyTakeHome: 50000, monthlySavings: 5000,
    liquidSavings: 10000, emergencyFundMonths: 1, emiBurdenPct: 70,
    financialDependents: 4, riskTolerance: 'Conservative', investmentHorizonYears: 1,
  }));

  assert.equal(aggressive.category, 'Aggressive');
  assert.equal(conservative.category, 'Conservative');
  assert.equal(encodeRiskCategory('Moderate-Aggressive'), 3);
  assert.throws(() => encodeRiskCategory('Unknown'), /Unknown risk category/);
});

test('postTaxCalculator respects EEE exemptions and taxable instruments', () => {
  const ppf = calculatePostTaxReturn('PPF', 0.071, 1200000, 15, 'new', 10000, 35, 'salary');
  const fd = calculatePostTaxReturnSafe('FD', 0.07, 3000000, 3, 'new', 10000, 35, 'salary');

  assert.equal(ppf.taxRate, 0);
  assert.equal(ppf.postTaxReturn, 0.071);
  assert.ok(fd.postTaxReturn < 0.07);
  assert.throws(
    () => calculatePostTaxReturn('FD', Number.NaN, -1, -1, 'new', 0, 35, 'salary'),
    /nominalRate/,
  );
});

test('ragClient and mlClient propagate verified X-Verified-User-Id header downstream', async (t) => {
  const originalPost = axios.post;
  const originalMlUrl = process.env.ML_SERVICE_URL;
  let ragCapturedHeaders = null;
  let ragCapturedBody = null;
  let ragCapturedUrl = null;
  let mlCapturedHeaders = null;

  axios.post = async (url, payload, config) => {
    if (url.includes('/rag/query')) {
      ragCapturedUrl = url;
      ragCapturedHeaders = config?.headers;
      ragCapturedBody = payload;
      return { status: 200, data: {
        answer: 'Grounded tax advice', grounded: true,
        citations: [{ chunk_id: 'tax#1' }], retrieved_chunks: [], metrics: {},
      } };
    }
    if (url.includes('/predict')) {
      mlCapturedHeaders = config?.headers;
      return { data: {
        primary: 'ETF', secondary: 'Debt_MF', tertiary: 'ELSS',
        confidence_scores: { ETF: 0.7 }, decision_path: ['risk = Moderate'],
        model_version: '4.0.0', feature_schema_version: 'recommendation-features-4.0.0', explanation: null,
      } };
    }
    return { data: {} };
  };

  t.after(() => {
    axios.post = originalPost;
    if (originalMlUrl === undefined) delete process.env.ML_SERVICE_URL; else process.env.ML_SERVICE_URL = originalMlUrl;
  });

  const testUserId = '654321098765432109876543';
  process.env.ML_SERVICE_URL = 'http://rag-service:8000/';

  // 1. Test ragClient queryRAG forwards verified user header and drops unverified body fields
  const ragRes = await queryRAG({
    query: 'What are Section 80C deductions?',
    userId: testUserId,
  }, 'test-corr-id-123');

  assert.ok(ragRes);
  assert.equal(ragCapturedUrl, 'http://rag-service:8000/rag/query');
  assert.equal(ragCapturedHeaders?.['X-Verified-User-Id'], testUserId);
  assert.equal(ragCapturedBody?.tenant_id, undefined, 'tenant_id must not be sent in RAG request body');

  // 2. Test mlClient getMLPrediction forwards verified user header
  const mlRes = await getMLPrediction(
    mlInput({ age: 35, monthlySavings: 30000, liquidSavings: 100000 }),
    'test-corr-id-456',
    testUserId,
  );

  assert.ok(mlRes);
  assert.equal(mlCapturedHeaders?.['X-Verified-User-Id'], testUserId);
});

