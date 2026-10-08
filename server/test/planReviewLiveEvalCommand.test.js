import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runLivePlanReviewEvaluations } from '../agents/evals/livePlanReviewEvals.js';

function createLiveEvalProvider({ plannerTokensUsed = 1, explanationTokensUsed = 1 } = {}) {
  let calls = 0;
  return {
    name: 'fixture-provider',
    async generate() {
      calls += 1;
      if (calls === 1) return { text: '{"checks":["get_current_profile_context"]}', tokensUsed: plannerTokensUsed };
      return {
        tokensUsed: explanationTokensUsed,
        text: JSON.stringify({
          text: 'Synthetic fixture plan evidence is available. [E_PLAN_STATE]',
          evidenceIdsUsed: ['E_PLAN_STATE'],
          claims: [{ text: 'Synthetic fixture plan evidence is available. [E_PLAN_STATE]', evidenceIds: ['E_PLAN_STATE'] }],
          financialClaims: [],
          unavailableFacts: [],
        }),
      };
    },
  };
}

function createLiveEvalCase(overrides = {}) {
  return {
    id: 'synthetic-plan-review',
    expectedTools: [],
    forbiddenTools: [],
    expectedAction: 'NONE',
    requiredReasonCodes: [],
    maxSteps: 6,
    maxToolCalls: 8,
    groundingRequired: true,
    ...overrides,
  };
}

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('live PlanReview evaluation rejects missing real runner before provider calls', async () => {
  let providerCalls = 0;
  await assert.rejects(
    runLivePlanReviewEvaluations({
      dataset: [{ id: 'synthetic-only', forbiddenTools: [] }],
      provider: { name: 'fixture-provider', async generate() { providerCalls += 1; return { text: '{}' }; } },
    }),
    error => error.code === 'LIVE_EVAL_RUNNER_REQUIRED',
  );
  assert.equal(providerCalls, 0);
});

test('explicit live-eval CLI request fails closed before provider initialization', () => {
  const scriptPath = path.join(serverRoot, 'scripts', 'run-live-plan-review-evals.js');
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: serverRoot,
    encoding: 'utf8',
    env: { ...process.env, RUN_AGENT_LIVE_EVALS: 'true' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /LIVE_EVAL_RUNNER_REQUIRED/);
  assert.match(result.stderr, /no provider call was made/i);
});

test('live PlanReview evaluation compares the actual action and enforces passing case gates', async () => {
  const result = await runLivePlanReviewEvaluations({
    dataset: [createLiveEvalCase()],
    provider: createLiveEvalProvider(),
    runner: async () => ({
      result: {
        recommendedAction: 'NONE',
        freshness: { reasonCodes: [] },
        evidence: { status: 'AVAILABLE' },
        validation: { valid: true },
        policy: { allowed: true },
        stepCount: 0,
        toolCallCount: 0,
      },
      trajectory: [],
    }),
  });

  assert.equal(result.passed, true);
  assert.equal(result.cases[0].caseScorecard.action, true);
  assert.equal(result.aggregate.groundingFailureRate, 0);
});

test('live PlanReview evaluation rejects an expected-action mismatch', async () => {
  await assert.rejects(
    runLivePlanReviewEvaluations({
      dataset: [createLiveEvalCase({ expectedAction: 'REVIEW_PROFILE' })],
      provider: createLiveEvalProvider(),
      runner: async () => ({
        result: {
          recommendedAction: 'NONE',
          freshness: { reasonCodes: [] },
          evidence: { status: 'AVAILABLE' },
          validation: { valid: true },
          policy: { allowed: true },
          stepCount: 0,
          toolCallCount: 0,
        },
        trajectory: [],
      }),
    }),
    error => error.code === 'LIVE_EVAL_GATE_FAILED'
      && error.caseFailures[0].scorecard.action === false,
  );
});

test('live PlanReview evaluation rejects forbidden tool attempts even when aggregate metrics are returned', async () => {
  await assert.rejects(
    runLivePlanReviewEvaluations({
      dataset: [createLiveEvalCase({ forbiddenTools: ['execute_trade'] })],
      provider: createLiveEvalProvider(),
      runner: async () => ({
        result: {
          recommendedAction: 'NONE',
          freshness: { reasonCodes: [] },
          evidence: { status: 'AVAILABLE' },
          validation: { valid: true },
          policy: { allowed: true },
          stepCount: 0,
          toolCallCount: 0,
        },
        trajectory: [{ type: 'TOOL_SELECTED', tool: 'execute_trade' }],
      }),
    }),
    error => error.code === 'LIVE_EVAL_GATE_FAILED'
      && error.thresholdFailures.some(failure => failure.metric === 'forbiddenToolRate'),
  );
});

test('live PlanReview evaluation rejects ungrounded and unsupported-numeric results', async () => {
  await assert.rejects(
    runLivePlanReviewEvaluations({
      dataset: [createLiveEvalCase()],
      provider: createLiveEvalProvider(),
      runner: async () => ({
        result: {
          recommendedAction: 'NONE',
          freshness: { reasonCodes: [] },
          evidence: { status: 'UNAVAILABLE' },
          validation: { valid: false },
          policy: { allowed: true },
          stepCount: 0,
          toolCallCount: 0,
        },
        trajectory: [],
      }),
    }),
    error => error.code === 'LIVE_EVAL_GATE_FAILED'
      && error.thresholdFailures.some(failure => failure.metric === 'groundingFailureRate')
      && error.thresholdFailures.some(failure => failure.metric === 'unsupportedNumericalClaimRate'),
  );
});

test('live PlanReview evaluation rejects an empty dataset instead of passing zero-valued rates', async () => {
  await assert.rejects(
    runLivePlanReviewEvaluations({ dataset: [], provider: createLiveEvalProvider(), runner: async () => ({}) }),
    error => error.code === 'LIVE_EVAL_DATASET_EMPTY',
  );
});

test('live PlanReview evaluation rejects datasets that would be silently truncated', async () => {
  await assert.rejects(
    runLivePlanReviewEvaluations({
      dataset: [createLiveEvalCase(), createLiveEvalCase({ id: 'case-2' }), createLiveEvalCase({ id: 'case-3' }), createLiveEvalCase({ id: 'case-4' })],
      provider: createLiveEvalProvider(),
      runner: async () => ({ result: {}, trajectory: [] }),
    }),
    error => error.code === 'LIVE_EVAL_CASE_LIMIT_EXCEEDED'
      && error.datasetCaseCount === 4
      && error.caseLimit === 3,
  );
});

test('live PlanReview evaluation includes planner and explanation usage in its token budget', async () => {
  await assert.rejects(
    runLivePlanReviewEvaluations({
      dataset: [createLiveEvalCase()],
      provider: createLiveEvalProvider({ plannerTokensUsed: 2000, explanationTokensUsed: 600 }),
      runner: async () => ({ result: {}, trajectory: [] }),
    }),
    error => error.code === 'LIVE_EVAL_TOKEN_BUDGET_EXCEEDED'
      && error.tokensUsed === 2600
      && error.maxTokens === 2500,
  );
});
