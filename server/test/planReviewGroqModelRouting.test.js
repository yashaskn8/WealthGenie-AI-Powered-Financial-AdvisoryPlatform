import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { GROQ_PLAN_REVIEW_MODELS, GroqProviderAdapter } from '../services/providerAbstraction.js';

test('isolated PlanReview pins planner and explainer models without changing global Groq model routing', async t => {
  const originalPost = axios.post;
  const originalKey = process.env.GROQ_API_KEY;
  const originalModel = process.env.GROQ_MODEL;
  t.after(() => {
    axios.post = originalPost;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = originalModel;
  });

  process.env.GROQ_API_KEY = 'unit-test-placeholder';
  process.env.GROQ_MODEL = 'groq/global-chat-model';
  const requests = [];
  axios.post = async (_url, body) => {
    requests.push(body);
    const content = body.response_format?.json_schema?.name === 'plan_review_planner_v1'
      ? '{"checks":["get_current_profile_context"]}'
      : '{"text":"A supported fact [E_FACT].","evidenceIdsUsed":["E_FACT"],"claims":[{"text":"A supported fact [E_FACT].","evidenceIds":["E_FACT"]}],"financialClaims":[],"unavailableFacts":[]}';
    return {
      status: 200,
      headers: {},
      data: {
        model: body.model,
        choices: [{ message: { content }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 30,
          completion_tokens: 15,
          total_tokens: 45,
          completion_tokens_details: { reasoning_tokens: body.reasoning_effort === 'none' ? 0 : undefined },
        },
      },
    };
  };

  const adapter = new GroqProviderAdapter();
  const planner = await adapter.generate({
    systemPrompt: 'planner', recentHistory: [], maxTokens: 240, jsonMode: true,
    outputContract: 'PLAN_REVIEW_PLANNER_V1', planReviewRole: 'PLANNER',
  });
  const explainer = await adapter.generate({
    systemPrompt: 'explain', recentHistory: [], maxTokens: 512, jsonMode: true,
    outputContract: 'GROUNDED_EXPLANATION_V1', providerOutputMode: 'GROQ_JSON_OBJECT',
    planReviewRole: 'EXPLAINER',
  });
  const ordinary = await adapter.generate({ systemPrompt: 'ordinary', recentHistory: [], maxTokens: 64 });

  assert.deepEqual(GROQ_PLAN_REVIEW_MODELS, {
    PLANNER: 'openai/gpt-oss-120b',
    EXPLAINER: 'qwen/qwen3.8-27b',
  });
  assert.equal(adapter.configuredModel(), 'groq/global-chat-model');
  assert.equal(requests[0].model, GROQ_PLAN_REVIEW_MODELS.PLANNER);
  assert.equal(requests[0].response_format.type, 'json_schema');
  assert.equal(requests[0].response_format.json_schema.strict, true);
  assert.equal(Object.hasOwn(requests[0], 'reasoning_effort'), false);
  assert.equal(requests[1].model, GROQ_PLAN_REVIEW_MODELS.EXPLAINER);
  assert.deepEqual(requests[1].response_format, { type: 'json_object' });
  assert.equal(requests[1].max_completion_tokens, 512);
  assert.equal(requests[1].reasoning_effort, 'none');
  assert.equal(Object.hasOwn(requests[1], 'reasoning_format'), false);
  assert.equal(Object.hasOwn(requests[1], 'include_reasoning'), false);
  assert.equal(requests[2].model, 'groq/global-chat-model');
  assert.equal(Object.hasOwn(requests[2], 'reasoning_effort'), false);
  assert.equal(planner.model, GROQ_PLAN_REVIEW_MODELS.PLANNER);
  assert.equal(explainer.model, GROQ_PLAN_REVIEW_MODELS.EXPLAINER);
  assert.equal(explainer.diagnostics.reasoningEffort, 'none');
  assert.equal(explainer.diagnostics.reasoningIncluded, null);
  assert.equal(ordinary.model, 'groq/global-chat-model');
});

test('Groq PlanReview role/model mismatch fails before making an inference request', async t => {
  const originalPost = axios.post;
  const originalKey = process.env.GROQ_API_KEY;
  t.after(() => {
    axios.post = originalPost;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  });
  process.env.GROQ_API_KEY = 'unit-test-placeholder';
  let calls = 0;
  axios.post = async () => { calls += 1; throw new Error('unexpected request'); };
  const adapter = new GroqProviderAdapter();
  assert.equal(await adapter.generate({
    systemPrompt: 'x', recentHistory: [], jsonMode: true,
    outputContract: 'PLAN_REVIEW_PLANNER_V1', planReviewRole: 'EXPLAINER',
  }), null);
  assert.equal(adapter.lastFailureReason, 'PLAN_REVIEW_MODEL_ROLE_CONTRACT_MISMATCH');
  assert.equal(calls, 0);
});
