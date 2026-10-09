import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPlanReviewDataset } from '../agents/evals/planReviewEvals.js';
import { runIsolatedPlanReviewCase } from '../agents/evals/isolatedPlanReviewRunner.js';

test('isolated live PlanReview reserves a bounded explanation call within its total token cap', async () => {
  const dataset = await loadPlanReviewDataset();
  const caseDefinition = dataset.find(item => item.profile === 'fixtures/profile-current.json');
  assert.ok(caseDefinition, 'the synthetic current-profile evaluation case exists');

  const requests = [];
  const provider = {
    name: 'offline-budget-regression',
    configuredModel: () => 'synthetic-budget-regression',
    isConfigured: () => true,
    async generate(args) {
      requests.push({ maxTokens: args.maxTokens });
      if (requests.length === 1) {
        return {
          text: JSON.stringify({ checks: ['check_recommendation_freshness'] }),
          tokensUsed: 360,
          provider: 'offline-budget-regression',
          model: 'synthetic-budget-regression',
        };
      }
      return null;
    },
  };

  const actual = await runIsolatedPlanReviewCase({ caseDefinition, provider });

  assert.deepEqual(requests, [{ maxTokens: 240 }, { maxTokens: 512 }]);
  assert.equal(actual.providerUsage.providerCalls, 2);
  assert.equal(actual.providerUsage.tokensUsed, 360);
  assert.equal(actual.result.explanation.fallback, true,
    'the offline null response remains a fallback and is not presented as a live evaluation pass');
});
