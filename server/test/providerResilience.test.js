import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import {
  classifyProviderError,
  GeminiProviderAdapter,
  GroqProviderAdapter,
  NvidiaNimProviderAdapter,
  ProviderManager,
} from '../services/providerAbstraction.js';
import { createModelGateway } from '../agents/modelGateway.js';
import { buildGroundedEvidencePacket, makeEvidenceEntry } from '../services/groundedEvidence.js';
import { generateGroundedExplanation } from '../services/groundedExplanationService.js';

const keys = ['NVIDIA_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY'];

function setup(t) {
  const originalPost = axios.post;
  const originalEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  axios.post = async () => { throw new Error('Unexpected provider call in test'); };
  for (const key of keys) process.env[key] = 'unit-test-only-not-a-secret';
  ProviderManager.nvidia.reset();
  ProviderManager.gemini.reset();
  ProviderManager.groq.reset();
  t.after(() => {
    axios.post = originalPost;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    ProviderManager.nvidia.reset();
    ProviderManager.gemini.reset();
    ProviderManager.groq.reset();
  });
}

function evidencePacket() {
  return buildGroundedEvidencePacket({
    question: 'Explain the authoritative result.',
    profile: {
      age: 35,
      monthlySavings: 20000,
      riskTolerance: 'Moderate',
      suitabilityRisk: 'Moderate',
      investmentHorizonYears: 10,
      investmentGoals: ['Wealth Growth'],
      suitabilityReasonCodes: ['PREFERENCE_CAP'],
    },
    additionalEntries: [makeEvidenceEntry('E_TEST_FACT', 'PRODUCT_FACT', { name: 'Verified test fact' }, {
      dataClass: 'OFFICIAL_SOURCE',
      displayValue: 'Verified test fact',
      source: { provider: 'TEST_OFFICIAL_SOURCE', url: 'https://official.example/fact' },
    })],
  });
}

function groundedResponse() {
  const text = 'The backend reports the verified test fact [E_TEST_FACT].';
  return JSON.stringify({
    text,
    evidenceIdsUsed: ['E_TEST_FACT'],
    claims: [{ text, evidenceIds: ['E_TEST_FACT'] }],
    unavailableFacts: [],
  });
}

function geminiResponse(text = groundedResponse()) {
  return {
    data: {
      modelVersion: 'gemini-3.6-flash',
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }],
      usageMetadata: { totalTokenCount: 42 },
    },
  };
}

function axiosStatus(status) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status } });
}

test('provider failure policy separates transient health errors from request/configuration failures', () => {
  const cases = [
    [Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }), 'PROVIDER_TIMEOUT', true, false, true],
    [Object.assign(new Error('dns'), { code: 'ENOTFOUND' }), 'PROVIDER_NETWORK_ERROR', true, false, true],
    [axiosStatus(503), 'PROVIDER_SERVER_ERROR', true, true, true],
    [axiosStatus(429), 'PROVIDER_RATE_LIMITED', false, true, true],
    [axiosStatus(401), 'PROVIDER_AUTHENTICATION_FAILED', false, true, true],
    [axiosStatus(403), 'PROVIDER_AUTHENTICATION_FAILED', false, true, true],
    [axiosStatus(422), 'PROVIDER_BAD_REQUEST', false, true, true],
    [new Error('bug'), 'PROVIDER_INTERNAL_ERROR', false, false, true],
  ];
  for (const [error, code, breakerRelevant, providerResponded, fallbackEligible] of cases) {
    assert.deepEqual(classifyProviderError(error), {
      code, retryable: false, breakerRelevant, providerResponded, fallbackEligible,
    });
  }
  const controller = new AbortController();
  controller.abort();
  assert.equal(classifyProviderError(new Error('cancelled'), { signal: controller.signal }).code, 'CALLER_ABORTED');
});

test('400/401/403/429 do not poison any shared provider-health breaker; 5xx does', async t => {
  setup(t);
  const adapters = [
    new NvidiaNimProviderAdapter({ failureThreshold: 1 }),
    new GeminiProviderAdapter({ failureThreshold: 1 }),
    new GroqProviderAdapter({ failureThreshold: 1 }),
  ];
  for (const adapter of adapters) {
    for (const status of [400, 401, 403, 429]) {
      adapter.reset();
      axios.post = async () => { throw axiosStatus(status); };
      assert.equal(await adapter.generate({ systemPrompt: 'test', recentHistory: [] }), null);
      assert.equal(adapter.circuitState, 'CLOSED', `${adapter.name} status ${status}`);
      assert.equal(adapter.failureCount, 0, `${adapter.name} status ${status}`);
    }
    adapter.reset();
    axios.post = async () => { throw axiosStatus(503); };
    assert.equal(await adapter.generate({ systemPrompt: 'test', recentHistory: [] }), null);
    assert.equal(adapter.circuitState, 'OPEN', `${adapter.name} HTTP 503`);
  }
});

test('repeated Gemini safety refusals remain request-scoped and do not disable another shared workload', async t => {
  setup(t);
  const adapter = ProviderManager.gemini;
  let calls = 0;
  axios.post = async () => {
    calls += 1;
    return { data: { candidates: [{ finishReason: 'SAFETY' }] } };
  };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal(await adapter.generate({ systemPrompt: 'test', recentHistory: [] }), null);
    assert.equal(adapter.lastFailureReason, 'PROVIDER_SAFETY_REJECTION');
  }
  assert.equal(adapter.circuitState, 'CLOSED');
  assert.equal(adapter.failureCount, 0);

  axios.post = async () => { calls += 1; return geminiResponse(); };
  const gateway = createModelGateway({ providers: [adapter] });
  const result = await gateway.generate({ role: 'PLANNER', systemPrompt: 'safe', recentHistory: [] });
  assert.equal(result.provider, 'gemini');
  assert.equal(calls, 11);
});

test('10/50/100 concurrent requests at recovery admit one live half-open provider probe', async t => {
  setup(t);
  for (const count of [10, 50, 100]) {
    let now = 0;
    const adapter = new GeminiProviderAdapter({ failureThreshold: 1, recoveryTimeoutMs: 10, now: () => now });
    let calls = 0;
    axios.post = async () => {
      calls += 1;
      throw Object.assign(new Error('network down'), { code: 'ECONNRESET' });
    };
    assert.equal(await adapter.generate({ systemPrompt: 'test', recentHistory: [] }), null);
    assert.equal(adapter.circuitState, 'OPEN');
    now = 10;
    let releaseProbe;
    axios.post = async () => {
      calls += 1;
      return new Promise(resolve => { releaseProbe = () => resolve(geminiResponse('healthy')); });
    };
    const requests = Array.from({ length: count }, () => adapter.generate({ systemPrompt: 'test', recentHistory: [] }));
    assert.equal(calls, 2, `only one of ${count} recovery callers may contact Gemini`);
    releaseProbe();
    const results = await Promise.all(requests);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(adapter.circuitState, 'CLOSED');
    assert.equal(adapter.failureCount, 0);
  }
});

test('a failed half-open probe reopens with a fresh recovery window; stale completion cannot close it', async t => {
  setup(t);
  let now = 0;
  const adapter = new GeminiProviderAdapter({ failureThreshold: 1, recoveryTimeoutMs: 20, now: () => now });
  const stalePermit = adapter.acquirePermit();
  adapter.recordFailure(stalePermit);
  assert.equal(adapter.circuitState, 'OPEN');
  now = 20;
  let providerCalls = 0;
  axios.post = async () => { providerCalls += 1; throw axiosStatus(503); };
  await adapter.generate({ systemPrompt: 'probe', recentHistory: [] });
  assert.equal(adapter.circuitState, 'OPEN');
  adapter.recordSuccess(stalePermit);
  assert.equal(adapter.circuitState, 'OPEN');
  assert.equal(providerCalls, 1);
  now = 39;
  assert.equal(await adapter.generate({ systemPrompt: 'still open', recentHistory: [] }), null);
  assert.equal(providerCalls, 1, 'the provider is not called before the new recovery window expires');
  now = 40;
  axios.post = async () => geminiResponse('recovered');
  assert.ok(await adapter.generate({ systemPrompt: 'probe', recentHistory: [] }));
  assert.equal(adapter.circuitState, 'CLOSED');
});

test('caller cancellation releases a half-open probe without counting a provider failure', async t => {
  setup(t);
  let now = 0;
  const adapter = new GeminiProviderAdapter({ failureThreshold: 1, recoveryTimeoutMs: 1, now: () => now });
  adapter.recordFailure(adapter.acquirePermit());
  now = 1;
  const controller = new AbortController();
  let signalSeen;
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  axios.post = async (_url, _payload, options) => new Promise((_resolve, reject) => {
    signalSeen = options.signal;
    signalStarted();
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  const pending = adapter.generate({ systemPrompt: 'test', recentHistory: [], signal: controller.signal });
  await started;
  controller.abort(Object.assign(new Error('caller stopped'), { name: 'AbortError' }));
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(signalSeen.aborted, true);
  assert.equal(adapter.failureCount, 1);
  assert.equal(adapter.circuitState, 'HALF_OPEN');
  const retryPermit = adapter.acquirePermit();
  assert.ok(retryPermit, 'cancellation releases the single probe slot');
  adapter.recordCancellation(retryPermit);
});

test('safety refusal stops external provider chaining and uses deterministic grounded fallback', async t => {
  setup(t);
  let secondaryCalls = 0;
  const primary = new GeminiProviderAdapter({ failureThreshold: 1 });
  axios.post = async () => ({ data: { candidates: [{ finishReason: 'SAFETY' }] } });
  const result = await generateGroundedExplanation({ question: 'Explain this fact.', evidencePacket: evidencePacket() }, {
    providers: [primary, {
      name: 'secondary',
      async generate() { secondaryCalls += 1; return null; },
    }],
    getCache: async () => null,
    setCache: async () => false,
  });
  assert.equal(result.fallback, true);
  assert.ok(result.validation.reasonCodes.includes('PROVIDER_SAFETY_REJECTION'));
  assert.equal(secondaryCalls, 0);
  assert.equal(primary.circuitState, 'CLOSED');
});

test('one hard provider-chain deadline aborts a hung provider and falls back without contacting another', async t => {
  setup(t);
  let expireDeadline;
  let receivedSignal;
  let firstStarted;
  const started = new Promise(resolve => { firstStarted = resolve; });
  let secondCalls = 0;
  const providers = [
    {
      name: 'primary',
      async generate({ signal }) {
        receivedSignal = signal;
        firstStarted();
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      },
    },
    { name: 'secondary', async generate() { secondCalls += 1; return null; } },
  ];
  const resultPromise = generateGroundedExplanation({ question: 'Explain this fact.', evidencePacket: evidencePacket() }, {
    providers,
    providerDeadlineMs: 1000,
    setTimeoutImpl(callback) { expireDeadline = callback; return 1; },
    clearTimeoutImpl() {},
    getCache: async () => null,
    setCache: async () => false,
  });
  await started;
  expireDeadline();
  const result = await resultPromise;
  assert.equal(receivedSignal.aborted, true);
  assert.equal(result.fallback, true);
  assert.ok(result.validation.reasonCodes.includes('PROVIDER_CHAIN_DEADLINE_EXCEEDED'));
  assert.equal(result.providerAttemptCount, 1);
  assert.equal(secondCalls, 0);
});

test('provider budget denial prevents the next model call after a failed primary', async t => {
  setup(t);
  let attempts = 0;
  let secondaryCalls = 0;
  const result = await generateGroundedExplanation({ question: 'Explain this fact.', evidencePacket: evidencePacket() }, {
    providers: [
      { name: 'primary', lastFailureReason: 'PROVIDER_SERVER_ERROR', async generate() { attempts += 1; return null; } },
      { name: 'secondary', async generate() { secondaryCalls += 1; return null; } },
    ],
    async beforeProviderAttempt() { return attempts === 0; },
    getCache: async () => null,
    setCache: async () => false,
  });
  assert.equal(attempts, 1);
  assert.equal(secondaryCalls, 0);
  assert.ok(result.validation.reasonCodes.includes('PROVIDER_BUDGET_EXHAUSTED'));
  assert.equal(result.providerAttemptFailureCount, 1);
});

test('a successful secondary provider follows a quick transient primary failure', async t => {
  setup(t);
  const providers = [
    { name: 'primary', lastFailureReason: null, async generate() { this.lastFailureReason = 'PROVIDER_SERVER_ERROR'; return null; } },
    { name: 'secondary', configuredModel: () => 'test-model', async generate() {
      return { provider: 'secondary', model: 'test-model', text: groundedResponse(), tokensUsed: 5 };
    } },
  ];
  const result = await generateGroundedExplanation({ question: 'Explain this fact.', evidencePacket: evidencePacket() }, {
    providers,
    getCache: async () => null,
    setCache: async () => false,
  });
  assert.equal(result.provider, 'SECONDARY');
  assert.equal(result.providerAttemptCount, 2);
  assert.equal(result.providerAttemptFailureCount, 1);
  assert.equal(result.fallback, false);
});
