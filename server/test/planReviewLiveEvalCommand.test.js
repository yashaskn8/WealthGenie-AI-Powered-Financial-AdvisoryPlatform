import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runLivePlanReviewEvaluations } from '../agents/evals/livePlanReviewEvals.js';

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
