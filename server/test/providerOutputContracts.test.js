import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import {
  GeminiProviderAdapter,
  GroqProviderAdapter,
} from '../services/providerAbstraction.js';
import {
  getProviderOutputContract,
  toGeminiResponseSchema,
  toGroqStrictSchema,
  validateGroqStrictSchema,
  validateProviderOutputContract,
} from '../services/providerOutputContracts.js';

const environmentKeys = ['GROQ_API_KEY', 'GROQ_MODEL', 'GEMINI_API_KEY'];

function restoreEnvironment(t) {
  const original = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('output contracts require the exact closed planner and grounded explanation shapes', () => {
  const planner = getProviderOutputContract('PLAN_REVIEW_PLANNER_V1');
  assert.ok(planner);
  assert.equal(validateProviderOutputContract('PLAN_REVIEW_PLANNER_V1', {
    checks: ['get_current_profile_context'],
  }).valid, true);
  assert.equal(validateProviderOutputContract('PLAN_REVIEW_PLANNER_V1', {
    checks: ['execute_trade'],
  }).valid, false);
  assert.equal(validateProviderOutputContract('PLAN_REVIEW_PLANNER_V1', {
    checks: ['get_current_profile_context'], extra: true,
  }).valid, false);
  assert.equal(validateProviderOutputContract('GROUNDED_EXPLANATION_V1', {
    text: 'A supported statement [E_FACT].',
    evidenceIdsUsed: ['E_FACT'],
    claims: [{ text: 'A supported statement [E_FACT].', evidenceIds: ['E_FACT'] }],
    financialClaims: [],
    unavailableFacts: [],
  }).valid, true);
  assert.equal(validateProviderOutputContract('GROUNDED_EXPLANATION_V1', {
    text: 'A supported statement [E_FACT].',
    evidenceIdsUsed: ['E_FACT'],
    claims: [{ text: 'A supported statement [E_FACT].', evidenceIds: ['E_FACT'], extra: true }],
    financialClaims: [],
    unavailableFacts: [],
  }).valid, false);
  assert.equal(validateProviderOutputContract('NO_SUCH_CONTRACT', {}).valid, false);
  assert.equal(Object.isFrozen(planner.schema.properties.checks.items), true);
  assert.throws(() => { planner.schema.properties.checks.items.enum[0] = 'execute_trade'; }, TypeError);
});

test('Groq strict schema projection closes every object and requires every property', () => {
  const contract = getProviderOutputContract('GROUNDED_EXPLANATION_V1');
  const projected = toGroqStrictSchema(contract.schema);
  assert.deepEqual(validateGroqStrictSchema(projected), { valid: true, errors: [] });
  assert.equal(JSON.stringify(projected).includes('minItems'), false);
  assert.equal(JSON.stringify(projected).includes('pattern'), false);

  const invalid = validateGroqStrictSchema({
    type: 'object', properties: { value: { type: 'string' } }, required: ['value'],
  });
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.errors, ['GROQ_SCHEMA_OBJECT_NOT_CLOSED']);
});

test('Groq sends a named strict schema only for the explicit supported-model contract', async t => {
  restoreEnvironment(t);
  const originalPost = axios.post;
  t.after(() => { axios.post = originalPost; });
  process.env.GROQ_API_KEY = 'test-key-not-a-real-secret';
  process.env.GROQ_MODEL = 'openai/gpt-oss-120b';
  let request;
  axios.post = async (...args) => {
    request = args;
    return {
      status: 200,
      data: {
        model: 'openai/gpt-oss-120b',
        choices: [{ message: { content: '{"checks":["get_current_profile_context"]}' }, finish_reason: 'stop' }],
        usage: { total_tokens: 17 },
      },
    };
  };
  const adapter = new GroqProviderAdapter();
  const result = await adapter.generate({
    systemPrompt: 'planner',
    recentHistory: [],
    jsonMode: true,
    outputContract: 'PLAN_REVIEW_PLANNER_V1',
    maxTokens: 240,
  });
  const body = request[1];
  assert.equal(body.max_completion_tokens, 240);
  assert.equal(Object.hasOwn(body, 'max_tokens'), false);
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.name, 'plan_review_planner_v1');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.response_format.json_schema.schema.required, ['checks']);
  assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
  assert.equal(Object.hasOwn(body.response_format.json_schema.schema.properties.checks, 'maxItems'), false);
  assert.equal(result.wasCompleted, true);
  assert.equal(result.diagnostics.providerReportedTokens, 17);
  assert.equal(result.diagnostics.responseFormatMode, 'json_schema');
  assert.equal(result.diagnostics.strictSchema, true);
  assert.equal(result.diagnostics.schemaStructuralValidation, true);
  assert.equal(result.diagnostics.reasoningEffort, null);
  assert.equal(Object.hasOwn(body, 'tools'), false);

  process.env.GROQ_MODEL = 'unqualified/model';
  let unsupportedModelCalls = 0;
  axios.post = async () => { unsupportedModelCalls += 1; throw new Error('must not call'); };
  const unsupported = new GroqProviderAdapter();
  assert.equal(await unsupported.generate({
    systemPrompt: 'planner', recentHistory: [], jsonMode: true, outputContract: 'PLAN_REVIEW_PLANNER_V1',
  }), null);
  assert.equal(unsupported.lastFailureReason, 'PROVIDER_OUTPUT_CONTRACT_UNSUPPORTED');
  assert.equal(unsupportedModelCalls, 0);
});

test('Groq marks length-limited JSON as incomplete and retains sanitized diagnostics', async t => {
  restoreEnvironment(t);
  const originalPost = axios.post;
  t.after(() => { axios.post = originalPost; });
  process.env.GROQ_API_KEY = 'test-key-not-a-real-secret';
  process.env.GROQ_MODEL = 'openai/gpt-oss-120b';
  axios.post = async () => ({
    status: 200,
    data: {
      model: 'openai/gpt-oss-120b',
      choices: [{ message: { content: '{"checks":[' }, finish_reason: 'length' }],
      usage: { total_tokens: 240 },
    },
  });
  const adapter = new GroqProviderAdapter();
  const result = await adapter.generate({
    systemPrompt: 'planner', recentHistory: [], jsonMode: true,
    outputContract: 'PLAN_REVIEW_PLANNER_V1', maxTokens: 240,
  });
  assert.equal(result.wasCompleted, false);
  assert.equal(adapter.lastFailureReason, 'PROVIDER_INCOMPLETE_OUTPUT');
  assert.equal(result.diagnostics.completionReason, 'length');
  assert.equal(result.diagnostics.providerReportedTokens, 240);
  assert.equal(result.diagnostics.effectiveOutputTokenCeiling, 240);
  assert.equal(result.diagnostics.errorClassification, 'PROVIDER_INCOMPLETE_OUTPUT');
});

test('provider diagnostics retain a safe response error code but never the provider error message', async t => {
  restoreEnvironment(t);
  const originalPost = axios.post;
  t.after(() => { axios.post = originalPost; });
  process.env.GROQ_API_KEY = 'test-key-not-a-real-secret';
  process.env.GROQ_MODEL = 'openai/gpt-oss-120b';
  axios.post = async () => {
    throw Object.assign(new Error('provider error message must not be exposed'), {
      response: {
        status: 400,
        data: { error: { code: 'json_validate_failed', message: 'provider error message must not be exposed' } },
      },
    });
  };
  const adapter = new GroqProviderAdapter();
  assert.equal(await adapter.generate({
    systemPrompt: 'planner', recentHistory: [], jsonMode: true,
    outputContract: 'GROUNDED_EXPLANATION_V1', maxTokens: 512,
  }), null);
  assert.equal(adapter.lastResponseDiagnostics.httpStatus, 400);
  assert.equal(adapter.lastResponseDiagnostics.errorClassification, 'PROVIDER_BAD_REQUEST');
  assert.equal(adapter.lastResponseDiagnostics.providerErrorCode, 'JSON_VALIDATE_FAILED');
  assert.equal(adapter.lastResponseDiagnostics.providerReportedTokens, null);
  assert.equal(adapter.lastResponseDiagnostics.responseFormatMode, 'json_schema');
  assert.equal(adapter.lastResponseDiagnostics.strictSchema, true);
  assert.equal(adapter.lastResponseDiagnostics.schemaName, 'grounded_explanation_v1');
  assert.equal(adapter.lastResponseDiagnostics.schemaStructuralValidation, true);
  assert.equal(adapter.lastResponseDiagnostics.reasoningEffort, 'low');
  assert.equal(adapter.lastResponseDiagnostics.effectiveOutputTokenCeiling, 512);
  assert.equal(JSON.stringify(adapter.lastResponseDiagnostics).includes('provider error message must not be exposed'), false);
});

test('Groq grounded explanation uses strict schema with low reasoning inside the unchanged output cap', async t => {
  restoreEnvironment(t);
  const originalPost = axios.post;
  t.after(() => { axios.post = originalPost; });
  process.env.GROQ_API_KEY = 'test-key-not-a-real-secret';
  process.env.GROQ_MODEL = 'openai/gpt-oss-120b';
  let requestBody;
  axios.post = async (_url, body) => {
    requestBody = body;
    return {
      status: 200,
      data: {
        model: 'openai/gpt-oss-120b',
        choices: [{ message: { content: JSON.stringify({
          text: 'Supported statement [E_FACT].',
          evidenceIdsUsed: ['E_FACT'],
          claims: [{ text: 'Supported statement [E_FACT].', evidenceIds: ['E_FACT'] }],
          financialClaims: [],
          unavailableFacts: [],
        }) }, finish_reason: 'stop' }],
        usage: { total_tokens: 100 },
      },
    };
  };
  const adapter = new GroqProviderAdapter();
  const result = await adapter.generate({
    systemPrompt: 'Concise grounded JSON.', recentHistory: [], jsonMode: true,
    outputContract: 'GROUNDED_EXPLANATION_V1', maxTokens: 512,
  });
  assert.equal(requestBody.max_completion_tokens, 512);
  assert.equal(requestBody.response_format.type, 'json_schema');
  assert.equal(requestBody.response_format.json_schema.strict, true);
  assert.equal(requestBody.response_format.json_schema.name, 'grounded_explanation_v1');
  assert.equal(requestBody.reasoning_effort, 'low');
  assert.equal(Object.hasOwn(requestBody, 'tools'), false);
  assert.equal(result.wasCompleted, true);
  assert.equal(result.diagnostics.schemaStructuralValidation, true);
  assert.equal(result.diagnostics.providerReportedTokens, 100);
});

test('Groq PlanReview JSON Object Mode uses documented reasoning visibility and preserves token accounting', async t => {
  restoreEnvironment(t);
  const originalPost = axios.post;
  t.after(() => { axios.post = originalPost; });
  process.env.GROQ_API_KEY = 'test-key-not-a-real-secret';
  process.env.GROQ_MODEL = 'openai/gpt-oss-120b';
  const candidate = {
    text: 'Supported statement [E_FACT].',
    evidenceIdsUsed: ['E_FACT'],
    claims: [{ text: 'Supported statement [E_FACT].', evidenceIds: ['E_FACT'] }],
    financialClaims: [],
    unavailableFacts: [],
  };
  let requestBody;
  axios.post = async (_url, body) => {
    requestBody = body;
    return {
      status: 200,
      data: {
        model: 'openai/gpt-oss-120b',
        choices: [{ message: { content: JSON.stringify(candidate) }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 70,
          completion_tokens: 30,
          total_tokens: 100,
          completion_tokens_details: { reasoning_tokens: 18 },
        },
      },
    };
  };
  const adapter = new GroqProviderAdapter();
  const result = await adapter.generate({
    systemPrompt: 'Return a grounded JSON object.', recentHistory: [], jsonMode: true,
    outputContract: 'GROUNDED_EXPLANATION_V1', providerOutputMode: 'GROQ_JSON_OBJECT', maxTokens: 512,
  });
  assert.equal(requestBody.max_completion_tokens, 512);
  assert.deepEqual(requestBody.response_format, { type: 'json_object' });
  assert.equal(requestBody.reasoning_effort, 'low');
  assert.equal(requestBody.include_reasoning, false);
  assert.equal(Object.hasOwn(requestBody, 'reasoning_format'), false);
  assert.equal(Object.hasOwn(requestBody, 'tools'), false);
  assert.equal(result.wasCompleted, true);
  assert.equal(result.diagnostics.responseFormatMode, 'json_object');
  assert.equal(result.diagnostics.strictSchema, false);
  assert.equal(result.diagnostics.schemaName, null);
  assert.equal(result.diagnostics.schemaStructuralValidation, null);
  assert.equal(result.diagnostics.reasoningEffort, 'low');
  assert.equal(result.diagnostics.reasoningFormat, null);
  assert.equal(result.diagnostics.reasoningIncluded, false);
  assert.equal(result.tokensUsed, 100);
  assert.equal(result.diagnostics.providerReasoningTokens, 18);
  assert.equal(validateProviderOutputContract('GROUNDED_EXPLANATION_V1', JSON.parse(result.text)).valid, true);
});

test('Groq JSON Object Mode is rejected for planner contracts before an HTTP request', async t => {
  restoreEnvironment(t);
  const originalPost = axios.post;
  t.after(() => { axios.post = originalPost; });
  process.env.GROQ_API_KEY = 'test-key-not-a-real-secret';
  let calls = 0;
  axios.post = async () => { calls += 1; throw new Error('must not request'); };
  const adapter = new GroqProviderAdapter();
  assert.equal(await adapter.generate({
    systemPrompt: 'planner', recentHistory: [], jsonMode: true,
    outputContract: 'PLAN_REVIEW_PLANNER_V1', providerOutputMode: 'GROQ_JSON_OBJECT',
  }), null);
  assert.equal(adapter.lastFailureReason, 'PROVIDER_OUTPUT_MODE_UNSUPPORTED');
  assert.equal(calls, 0);
});

test('Google diagnostics expose only a safe structured validation field path', async t => {
  restoreEnvironment(t);
  const originalPost = axios.post;
  t.after(() => { axios.post = originalPost; });
  process.env.GEMINI_API_KEY = 'test-key-not-a-real-secret';
  axios.post = async () => {
    throw Object.assign(new Error('private provider validation response'), {
      response: {
        status: 400,
        data: {
          error: {
            code: 400,
            status: 'INVALID_ARGUMENT',
            message: 'private provider validation response',
            details: [{ fieldViolations: [{ field: 'generationConfig.responseFormat.text.schema' }] }],
          },
        },
      },
    });
  };
  const adapter = new GeminiProviderAdapter();
  assert.equal(await adapter.generate({
    systemPrompt: 'x', recentHistory: [], jsonMode: true,
    outputContract: 'GROUNDED_EXPLANATION_V1', maxTokens: 512,
  }), null);
  assert.equal(adapter.lastResponseDiagnostics.providerErrorCode, 'INVALID_ARGUMENT');
  assert.equal(adapter.lastResponseDiagnostics.providerErrorField, 'generationConfig.responseFormat.text.schema');
  assert.equal(JSON.stringify(adapter.lastResponseDiagnostics).includes('private provider validation response'), false);
});

test('Gemini 3.6 uses its structured response schema without deprecated sampling controls and rejects truncation', async t => {
  restoreEnvironment(t);
  const originalPost = axios.post;
  t.after(() => { axios.post = originalPost; });
  process.env.GEMINI_API_KEY = 'test-key-not-a-real-secret';
  let request;
  axios.post = async (...args) => {
    request = args;
    return {
      status: 200,
      data: {
        modelVersion: 'gemini-3.6-flash',
        candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"checks":[' }] } }],
        usageMetadata: { totalTokenCount: 240 },
      },
    };
  };
  const adapter = new GeminiProviderAdapter();
  const result = await adapter.generate({
    systemPrompt: 'planner', recentHistory: [], jsonMode: true,
    outputContract: 'PLAN_REVIEW_PLANNER_V1', maxTokens: 240,
  });
  const generationConfig = request[1].generationConfig;
  assert.equal(request[0], 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent');
  assert.equal(generationConfig.maxOutputTokens, 240);
  assert.deepEqual(generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
  assert.equal(Object.hasOwn(generationConfig, 'temperature'), false);
  assert.equal(Object.hasOwn(generationConfig, 'topP'), false);
  assert.equal(Object.hasOwn(generationConfig, 'topK'), false);
  assert.equal(generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON');
  assert.equal(generationConfig.responseFormat.text.schema.type, 'object');
  assert.equal(generationConfig.responseFormat.text.schema.properties.checks.type, 'array');
  assert.equal(result.wasCompleted, false);
  assert.equal(adapter.lastFailureReason, 'PROVIDER_INCOMPLETE_OUTPUT');
  assert.equal(result.diagnostics.completionReason, 'MAX_TOKENS');
  assert.equal(result.diagnostics.providerReportedTokens, 240);
});

test('known output contracts fail closed when a caller omits JSON mode', async t => {
  restoreEnvironment(t);
  const originalPost = axios.post;
  t.after(() => { axios.post = originalPost; });
  process.env.GROQ_API_KEY = 'test-key-not-a-real-secret';
  process.env.GROQ_MODEL = 'openai/gpt-oss-120b';
  process.env.GEMINI_API_KEY = 'test-key-not-a-real-secret';
  let calls = 0;
  axios.post = async () => { calls += 1; throw new Error('must not request'); };
  const groq = new GroqProviderAdapter();
  const gemini = new GeminiProviderAdapter();
  for (const adapter of [groq, gemini]) {
    assert.equal(await adapter.generate({
      systemPrompt: 'planner', recentHistory: [], outputContract: 'PLAN_REVIEW_PLANNER_V1',
    }), null);
    assert.equal(adapter.lastFailureReason, 'PROVIDER_OUTPUT_CONTRACT_REQUIRES_JSON_MODE');
  }
  assert.equal(calls, 0);
});

test('provider schema conversions preserve nullable semantics and do not mutate source contracts', () => {
  const contract = getProviderOutputContract('GROUNDED_EXPLANATION_V1');
  const groqSchema = toGroqStrictSchema(contract.schema);
  const geminiSchema = toGeminiResponseSchema(contract.schema);
  assert.deepEqual(contract.schema.properties.financialClaims.items.properties.jurisdiction.type, ['string', 'null']);
  assert.equal(groqSchema.properties.financialClaims.items.properties.jurisdiction.type[1], 'null');
  assert.deepEqual(geminiSchema.properties.financialClaims.items.properties.jurisdiction.type, ['string', 'null']);
  assert.deepEqual(geminiSchema.properties.financialClaims.items.properties.effectivePeriod.type, ['object', 'null']);
  assert.equal(Object.hasOwn(geminiSchema.properties.evidenceIdsUsed.items, 'pattern'), false);
  assert.equal(Object.hasOwn(geminiSchema.properties.text, 'maxLength'), false);
  assert.equal(contract.schema.properties.evidenceIdsUsed.items.pattern, '^E_[A-Z0-9_:-]+$');

  const groqEffectivePeriod = groqSchema.properties.financialClaims.items.properties.effectivePeriod;
  assert.equal(groqEffectivePeriod.anyOf.length, 2);
  assert.equal(groqEffectivePeriod.anyOf.some(branch => branch.type === 'null'), true);
  assert.equal(groqEffectivePeriod.anyOf.some(branch => branch.type === 'object'), true);
  assert.deepEqual(validateGroqStrictSchema(groqSchema), { valid: true, errors: [] });

  const base = {
    text: 'Supported statement [E_FACT].',
    evidenceIdsUsed: ['E_FACT'],
    claims: [{ text: 'Supported statement [E_FACT].', evidenceIds: ['E_FACT'] }],
    unavailableFacts: [],
  };
  const financialClaim = {
    type: contract.schema.properties.financialClaims.items.properties.type.enum[0],
    value: 1,
    unit: contract.schema.properties.financialClaims.items.properties.unit.enum[0],
    timePeriod: 'current',
    source: 'synthetic test source',
    evidenceId: 'E_FACT',
    jurisdiction: null,
    effectivePeriod: null,
    statement: 'Supported statement [E_FACT].',
  };
  assert.equal(validateProviderOutputContract('GROUNDED_EXPLANATION_V1', {
    ...base, financialClaims: [financialClaim],
  }).valid, true);
  assert.equal(validateProviderOutputContract('GROUNDED_EXPLANATION_V1', {
    ...base, financialClaims: [{ ...financialClaim, effectivePeriod: { from: 'FY2026-27', to: null } }],
  }).valid, true);
});
