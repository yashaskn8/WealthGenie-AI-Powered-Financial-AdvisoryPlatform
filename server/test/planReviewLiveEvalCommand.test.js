import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runLivePlanReviewEvaluations } from '../agents/evals/livePlanReviewEvals.js';
import { loadPlanReviewDataset } from '../agents/evals/planReviewEvals.js';
import { runIsolatedPlanReviewCase } from '../agents/evals/isolatedPlanReviewRunner.js';

function createLiveEvalCase(overrides = {}) {
  return {
    id: 'synthetic-plan-review',
    profile: 'fixtures/profile-current.json',
    expectedTools: [],
    forbiddenTools: [],
    expectedAction: 'NONE',
    requiredReasonCodes: [],
    maxSteps: 6,
    maxToolCalls: 8,
    groundingRequired: true,
    liveModelRequired: false,
    ...overrides,
  };
}

function createActualResult(overrides = {}) {
  return {
    result: {
      review: {
        recommendedAction: 'NONE',
        freshness: { reasonCodes: [] },
        evidence: { status: 'AVAILABLE' },
      },
      validation: { valid: true },
      evidenceVerification: { valid: true },
      explanation: { validation: { status: 'PASS' } },
      policy: { allowed: true },
      stepCount: 0,
      toolCallCount: 0,
      planner: { checks: [] },
    },
    trajectory: [],
    latencyMs: 2,
    providerUsage: {
      provider: 'fixture-provider',
      model: 'fixture-model',
      providerCalls: 0,
      tokensUsed: 0,
      tokenUsageAvailable: true,
      plannerFallback: false,
      explanationFallback: false,
    },
    ...overrides,
  };
}

function createFixtureProvider({ plannerTokens = 10, explanationTokens = 15 } = {}) {
  return {
    name: 'fixture-provider',
    configuredModel: () => 'fixture-model',
    isConfigured: () => true,
    async generate(args) {
      if (args.systemPrompt.includes('bounded routing planner')) {
        return {
          text: '{"checks":["get_current_profile_context"]}',
          tokensUsed: plannerTokens,
          provider: 'fixture-provider',
          model: 'fixture-model',
        };
      }
      return {
        text: JSON.stringify({
          text: 'The available evidence is limited to this synthetic test fixture. [E_RECOMMENDATION_FRESHNESS]',
          evidenceIdsUsed: ['E_RECOMMENDATION_FRESHNESS'],
          claims: [{
            text: 'The available evidence is limited to this synthetic test fixture. [E_RECOMMENDATION_FRESHNESS]',
            evidenceIds: ['E_RECOMMENDATION_FRESHNESS'],
          }],
          financialClaims: [],
          unavailableFacts: [],
        }),
        tokensUsed: explanationTokens,
        provider: 'fixture-provider',
        model: 'fixture-model',
      };
    },
  };
}

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('live PlanReview evaluation rejects a missing isolated graph runner before any provider call', async () => {
  await assert.rejects(
    runLivePlanReviewEvaluations({ dataset: [createLiveEvalCase()] }),
    error => error.code === 'LIVE_EVAL_RUNNER_REQUIRED',
  );
});

test('explicit live-eval CLI request fails closed before provider calls when no key is configured', () => {
  const scriptPath = path.join(serverRoot, 'scripts', 'run-live-plan-review-evals.js');
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: serverRoot,
    encoding: 'utf8',
    env: { ...process.env, RUN_AGENT_LIVE_EVALS: 'true', NVIDIA_API_KEY: '' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /LIVE_EVAL_PROVIDER_NOT_CONFIGURED/);
  assert.doesNotMatch(result.stderr, /NVIDIA_API_KEY|Bearer|token/i);
});

test('live evaluator executes one actual isolated PlanReview graph and scores its real trajectory', async () => {
  const dataset = await loadPlanReviewDataset();
  const freshCase = dataset.find(item => item.id === 'fresh-read-only-plan');
  const report = await runLivePlanReviewEvaluations({
    dataset: [{ ...freshCase, liveModelRequired: true }],
    runner: ({ caseDefinition }) => runIsolatedPlanReviewCase({
      caseDefinition,
      provider: createFixtureProvider(),
    }),
  });

  assert.equal(report.passed, true);
  assert.equal(report.cases[0].finalAction, 'NONE');
  assert.equal(report.cases[0].providerCalls, 2);
  assert.equal(report.cases[0].tokens, 25);
  assert.deepEqual(report.cases[0].executedTools, freshCase.expectedTools);
  assert.equal(report.cases[0].caseScorecard.passed, true);
});

test('offline evaluator runs every real graph fixture without a provider or persistence', () => {
  const scriptPath = path.join(serverRoot, 'scripts', 'run-eval.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wealthgenie-offline-eval-'));
  const tracePath = path.join(tempDir, 'traces.jsonl');
  try {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: serverRoot,
      encoding: 'utf8',
      env: { ...process.env, TRACE_LOG_PATH: tracePath },
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout.trim());
    assert.equal(report.mode, 'DETERMINISTIC_SYNTHETIC_PRODUCTION_GRAPH');
    assert.equal(report.persisted, false);
    assert.equal(report.externalProviderCalls, 0);
    assert.equal(report.summary.cases, 3);
    assert.ok(report.cases.every(item => item.passed));
    assert.doesNotMatch(result.stdout, /64b0000000000000000000/);
    assert.equal(fs.existsSync(tracePath), false, 'isolated runs must not emit to the filesystem-backed trace exporter');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('live evaluation rejects an expected-action mismatch from the actual graph result', async () => {
  await assert.rejects(
    runLivePlanReviewEvaluations({
      dataset: [createLiveEvalCase({ expectedAction: 'REVIEW_PROFILE' })],
      runner: async () => createActualResult(),
    }),
    error => error.code === 'LIVE_EVAL_GATE_FAILED'
      && error.caseFailures[0].scorecard.action === false,
  );
});

test('live evaluation rejects forbidden tool attempts present in the actual trajectory', async () => {
  await assert.rejects(
    runLivePlanReviewEvaluations({
      dataset: [createLiveEvalCase({ forbiddenTools: ['execute_trade'] })],
      runner: async () => createActualResult({
        trajectory: [{ type: 'TOOL_SELECTED', tool: 'execute_trade' }],
      }),
    }),
    error => error.code === 'LIVE_EVAL_GATE_FAILED'
      && error.aggregate.forbiddenToolRate === 1,
  );
});

test('live evaluation rejects ungrounded and invalid claim-validation results', async () => {
  await assert.rejects(
    runLivePlanReviewEvaluations({
      dataset: [createLiveEvalCase()],
      runner: async () => createActualResult({
        result: {
          ...createActualResult().result,
          review: { ...createActualResult().result.review, evidence: { status: 'UNAVAILABLE' } },
          validation: { valid: false },
        },
      }),
    }),
    error => error.code === 'LIVE_EVAL_GATE_FAILED'
      && error.aggregate.groundingFailureRate === 1
      && error.aggregate.unsupportedNumericalClaimRate === 1,
  );
});

test('live evaluation rejects an empty dataset instead of passing zero-valued rates', async () => {
  await assert.rejects(
    runLivePlanReviewEvaluations({ dataset: [], runner: async () => createActualResult() }),
    error => error.code === 'LIVE_EVAL_DATASET_EMPTY',
  );
});

test('live evaluation rejects datasets that would be silently truncated', async () => {
  await assert.rejects(
    runLivePlanReviewEvaluations({
      dataset: [createLiveEvalCase(), createLiveEvalCase({ id: 'case-2' }), createLiveEvalCase({ id: 'case-3' }), createLiveEvalCase({ id: 'case-4' })],
      runner: async () => createActualResult(),
    }),
    error => error.code === 'LIVE_EVAL_CASE_LIMIT_EXCEEDED'
      && error.datasetCaseCount === 4
      && error.caseLimit === 3,
  );
});

test('actual PlanReview graph enforces aggregate model token budget before an over-budget second call', async () => {
  const dataset = await loadPlanReviewDataset();
  const freshCase = dataset.find(item => item.id === 'fresh-read-only-plan');
  const provider = createFixtureProvider({ plannerTokens: 1400, explanationTokens: 1400 });
  let providerCalls = 0;
  const generate = provider.generate;
  provider.generate = async args => {
    providerCalls += 1;
    return generate(args);
  };
  await assert.rejects(
    runIsolatedPlanReviewCase({ caseDefinition: freshCase, provider }),
    error => error.code === 'AGENT_BUDGET_EXCEEDED' && error.reason === 'TOTAL_TOKENS',
  );
  assert.equal(providerCalls, 1, 'the graph must reject before the second provider request');
});

test('live evaluation rejects reported provider usage above the per-case token budget', async () => {
  await assert.rejects(
    runLivePlanReviewEvaluations({
      dataset: [createLiveEvalCase()],
      runner: async () => createActualResult({ providerUsage: { tokensUsed: 2501, tokenUsageAvailable: true } }),
    }),
    error => error.code === 'LIVE_EVAL_TOKEN_BUDGET_EXCEEDED'
      && error.tokensUsed === 2501
      && error.maxTokens === 2500,
  );
});

test('live-model-required cases fail when provider call accounting is missing', async () => {
  await assert.rejects(
    runLivePlanReviewEvaluations({
      dataset: [createLiveEvalCase({ liveModelRequired: true })],
      runner: async () => createActualResult({
        providerUsage: { ...createActualResult().providerUsage, providerCalls: undefined },
      }),
    }),
    error => error.code === 'LIVE_EVAL_GATE_FAILED'
      && error.aggregate.providerExecutionFailureRate === 1,
  );
});

test('live-model-required cases fail when actual graph execution falls back', async () => {
  const caseDefinition = createLiveEvalCase({ liveModelRequired: true });
  await assert.rejects(
    runLivePlanReviewEvaluations({
      dataset: [caseDefinition],
      runner: async () => createActualResult({
        providerUsage: {
          ...createActualResult().providerUsage,
          providerCalls: 1,
          tokensUsed: 10,
          plannerFallback: true,
        },
      }),
    }),
    error => error.code === 'LIVE_EVAL_GATE_FAILED'
      && error.aggregate.providerExecutionFailureRate === 1,
  );
});
