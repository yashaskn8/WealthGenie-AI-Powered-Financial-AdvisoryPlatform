import assert from 'node:assert/strict';
import test from 'node:test';
import { createModelGateway } from '../agents/modelGateway.js';
import { createBudgetedPlanReviewProvider, createPlanReviewTokenBudget } from '../agents/planReview/planReviewTokenBudget.js';

test('PlanReview reserves input and output before provider execution and rejects oversized input', async () => {
  const budget = createPlanReviewTokenBudget({ maxInputTokens: 16, maxOutputTokens: 8, maxTotalTokens: 24 });
  let called = 0;
  const provider = createBudgetedPlanReviewProvider({
    async generate(args) { called += 1; assert.equal(args.maxTokens, 8); return { text: 'ok', tokensUsed: 12 }; },
  }, budget);
  await provider.generate({ systemPrompt: 'a'.repeat(32), recentHistory: [], maxTokens: 8 });
  assert.equal(budget.accountedTokens, 12);
  await assert.rejects(
    provider.generate({ systemPrompt: 'b'.repeat(100), maxTokens: 8 }),
    error => error.code === 'AGENT_BUDGET_EXCEEDED' && error.reason === 'INPUT_TOKENS',
  );
  assert.equal(called, 1, 'oversized input is rejected before provider execution');
});

test('provider fallback attempts share one hard total-token budget', async () => {
  let secondProviderCalls = 0;
  const first = {
    name: 'first',
    async generate() { throw Object.assign(new Error('temporary provider outage'), { code: 'PROVIDER_TEMPORARY', retryable: true }); },
  };
  const second = {
    name: 'second',
    async generate() { secondProviderCalls += 1; return { text: 'must not run', tokensUsed: 1 }; },
  };
  const budget = createPlanReviewTokenBudget({ maxInputTokens: 20, maxOutputTokens: 20, maxTotalTokens: 50, maxModelCalls: 5 });
  const gateway = createModelGateway({ providers: [first, second], maxOutputTokens: 20 });
  await assert.rejects(
    gateway.generate({ role: 'PLANNER', systemPrompt: 'a'.repeat(40), recentHistory: [], maxTokens: 20, requestBudget: budget }),
    error => error.code === 'AGENT_BUDGET_EXCEEDED' && error.reason === 'TOTAL_TOKENS',
  );
  assert.equal(secondProviderCalls, 0, 'fallback cannot exceed the shared run budget');
  assert.equal(budget.accountedTokens, 31, 'failed provider attempt keeps its pre-reserved budget, including the UTF-8 separator');
  assert.equal(budget.modelCalls, 1, 'only the provider actually entered is counted');
});

test('provider fallback cannot exceed the hard model-call ceiling', async () => {
  let secondProviderCalls = 0;
  const first = {
    name: 'first',
    async generate() { throw Object.assign(new Error('temporary provider outage'), { code: 'PROVIDER_TEMPORARY', retryable: true }); },
  };
  const second = { name: 'second', async generate() { secondProviderCalls += 1; return { text: 'must not run' }; } };
  const budget = createPlanReviewTokenBudget({ maxInputTokens: 20, maxOutputTokens: 20, maxTotalTokens: 500, maxModelCalls: 1 });
  const gateway = createModelGateway({ providers: [first, second], maxOutputTokens: 20 });
  await assert.rejects(
    gateway.generate({ role: 'PLANNER', systemPrompt: 'safe bounded prompt', maxTokens: 20, requestBudget: budget }),
    error => error.code === 'AGENT_BUDGET_EXCEEDED' && error.reason === 'MODEL_CALLS',
  );
  assert.equal(secondProviderCalls, 0);
  assert.equal(budget.modelCalls, 1);
});

test('provider is never called when durable budget reservation fails', async () => {
  let providerCalls = 0;
  const budget = createPlanReviewTokenBudget({
    onReserve: async () => { throw Object.assign(new Error('Mongo reservation write failed'), { code: 'AGENT_BUDGET_PERSISTENCE_UNAVAILABLE' }); },
  });
  const provider = createBudgetedPlanReviewProvider({ async generate() { providerCalls += 1; return { text: 'unsafe to call' }; } }, budget);
  await assert.rejects(provider.generate({ systemPrompt: 'bounded input', maxTokens: 4 }), error => error.code === 'AGENT_BUDGET_PERSISTENCE_UNAVAILABLE');
  assert.equal(providerCalls, 0);
  assert.equal(budget.modelCalls, 1, 'the failed durable reservation remains conservatively accounted locally');
});

test('invalid restored token usage fails closed', () => {
  const budget = createPlanReviewTokenBudget({ maxTotalTokens: 40 });
  assert.throws(() => budget.restore(41), error => error.code === 'AGENT_BUDGET_EXCEEDED');
});

test('closed PlanReview budget prevents post-timeout provider retries', () => {
  const budget = createPlanReviewTokenBudget();
  budget.close();
  return assert.rejects(budget.reserve({ systemPrompt: 'safe' }), error => error.code === 'AGENT_BUDGET_EXCEEDED' && error.reason === 'RUN_CLOSED');
});

test('grounded explanation does not swallow a hard PlanReview budget rejection', async () => {
  const { generateGroundedExplanation } = await import('../services/groundedExplanationService.js');
  const budgetError = Object.assign(new Error('hard budget reached'), { code: 'AGENT_BUDGET_EXCEEDED' });
  await assert.rejects(
    generateGroundedExplanation({
      question: 'Explain only this safe evidence.',
      evidencePacket: {
        evidenceHash: 'fixture-hash',
        entries: [{ id: 'E_PLAN', kind: 'RECOMMENDATION', dataClass: 'DERIVED_VALUE', displayValue: 'Plan evidence.' }],
        unavailableFacts: [],
      },
    }, {
      providers: [{ name: 'budgeted', async generate() { throw budgetError; } }],
      getCache: async () => null,
      setCache: async () => undefined,
    }),
    error => error === budgetError,
  );
});
