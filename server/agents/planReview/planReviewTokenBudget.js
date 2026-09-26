import { PLAN_REVIEW_BUDGETS } from './planReviewRuntime.js';

function budgetError(reason) {
  const error = new Error(`PlanReview model token budget exceeded (${reason}).`);
  error.code = 'AGENT_BUDGET_EXCEEDED';
  error.reason = reason;
  return error;
}

function textOf(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).join('\n');
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (Array.isArray(value.parts)) return value.parts.map(textOf).join('\n');
    return Object.values(value).map(textOf).join('\n');
  }
  return '';
}

function positiveLimit(value, fallback, hardMaximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(hardMaximum, Math.floor(parsed))
    : fallback;
}

/**
 * Per-graph accounting. Calls reserve their full input estimate plus output
 * ceiling before reaching a provider; failed/fallback attempts keep the
 * reservation because provider billing cannot safely be assumed to be zero.
 */
export function createPlanReviewTokenBudget({
  maxInputTokens = PLAN_REVIEW_BUDGETS.maxInputTokens,
  maxOutputTokens = PLAN_REVIEW_BUDGETS.maxOutputTokens,
  maxTotalTokens = PLAN_REVIEW_BUDGETS.maxTotalTokens,
  maxModelCalls = PLAN_REVIEW_BUDGETS.maxModelCalls,
  initialUsage = 0,
  initialModelCalls = 0,
  onReserve = null,
} = {}) {
  const limits = Object.freeze({
    maxInputTokens: positiveLimit(maxInputTokens, PLAN_REVIEW_BUDGETS.maxInputTokens, PLAN_REVIEW_BUDGETS.maxInputTokens),
    maxOutputTokens: positiveLimit(maxOutputTokens, PLAN_REVIEW_BUDGETS.maxOutputTokens, PLAN_REVIEW_BUDGETS.maxOutputTokens),
    maxTotalTokens: positiveLimit(maxTotalTokens, PLAN_REVIEW_BUDGETS.maxTotalTokens, PLAN_REVIEW_BUDGETS.maxTotalTokens),
    maxModelCalls: positiveLimit(maxModelCalls, PLAN_REVIEW_BUDGETS.maxModelCalls, PLAN_REVIEW_BUDGETS.maxModelCalls),
  });
  let accountedTokens = Number.isInteger(initialUsage) && initialUsage >= 0 ? initialUsage : 0;
  let modelCalls = Number.isInteger(initialModelCalls) && initialModelCalls >= 0 ? initialModelCalls : 0;
  let closed = false;
  if (accountedTokens > limits.maxTotalTokens) throw budgetError('RESTORED_USAGE_INVALID');
  if (modelCalls > limits.maxModelCalls) throw budgetError('RESTORED_MODEL_CALLS_INVALID');

  return Object.freeze({
    limits,
    get accountedTokens() { return accountedTokens; },
    get modelCalls() { return modelCalls; },
    close() { closed = true; },
    restore(value) {
      if (!Number.isInteger(value) || value < 0 || value > limits.maxTotalTokens) throw budgetError('RESTORED_USAGE_INVALID');
      accountedTokens = Math.max(accountedTokens, value);
      return accountedTokens;
    },
    restoreModelCalls(value) {
      if (!Number.isInteger(value) || value < 0 || value > limits.maxModelCalls) throw budgetError('RESTORED_MODEL_CALLS_INVALID');
      modelCalls = Math.max(modelCalls, value);
      return modelCalls;
    },
    async reserve({ systemPrompt = '', recentHistory = [], maxTokens = limits.maxOutputTokens } = {}) {
      if (closed) throw budgetError('RUN_CLOSED');
      const inputBytes = Buffer.byteLength(`${textOf(systemPrompt)}\n${textOf(recentHistory)}`, 'utf8');
      const inputTokens = Math.ceil(inputBytes / 4);
      const outputTokens = positiveLimit(maxTokens, limits.maxOutputTokens, limits.maxOutputTokens);
      if (inputTokens > limits.maxInputTokens) throw budgetError('INPUT_TOKENS');
      if (accountedTokens + inputTokens + outputTokens > limits.maxTotalTokens) throw budgetError('TOTAL_TOKENS');
      if (modelCalls >= limits.maxModelCalls) throw budgetError('MODEL_CALLS');
      const reservation = Object.freeze({ inputTokens, outputTokens, reservedTokens: inputTokens + outputTokens });
      accountedTokens += reservation.reservedTokens;
      modelCalls += 1;
      if (typeof onReserve === 'function') {
        await onReserve({ tokenUsage: accountedTokens, modelCallCount: modelCalls });
      }
      return reservation;
    },
    settle(reservation, reportedTokens) {
      if (!reservation || !Number.isInteger(reservation.reservedTokens)) throw new TypeError('A valid PlanReview token reservation is required.');
      const reported = Number(reportedTokens);
      if (!Number.isFinite(reported) || reported <= 0) return accountedTokens;
      const actual = Math.max(reservation.inputTokens, Math.ceil(reported));
      accountedTokens = Math.max(0, accountedTokens - reservation.reservedTokens + actual);
      if (accountedTokens > limits.maxTotalTokens) throw budgetError('MEASURED_TOTAL_TOKENS');
      return accountedTokens;
    },
  });
}

export function createBudgetedPlanReviewProvider(provider, budget) {
  if (!provider || typeof provider.generate !== 'function') return provider;
  return {
    ...provider,
    async generate(args = {}) {
      const reservation = await budget.reserve(args);
      const response = await provider.generate({ ...args, maxTokens: reservation.outputTokens });
      const usage = response?.tokensUsed ?? response?.routing?.tokensUsed ?? response?.usage?.totalTokens;
      budget.settle(reservation, usage);
      return response ? { ...response, tokensUsed: Number(usage) > 0 ? Math.max(reservation.inputTokens, Number(usage)) : reservation.reservedTokens } : response;
    },
  };
}
