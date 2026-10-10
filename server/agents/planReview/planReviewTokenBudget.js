import { PLAN_REVIEW_BUDGETS } from './planReviewRuntime.js';
import { getProviderOutputContract, toGroqStrictSchema } from '../../services/providerOutputContracts.js';

// Provider prompt tokenization includes model/chat framing beyond UTF-8 text.
// The previous bytes/4 estimate undercounted a measured Groq request by 108
// tokens (1,434 estimated vs 1,542 reported), so reserve an empirical 15%
// margin. Provider-reported usage remains authoritative when settling a call.
const INPUT_TOKEN_ESTIMATE_MARGIN = 1.15;

export function estimatePlanReviewInputTokens(inputBytes) {
  if (!Number.isSafeInteger(inputBytes) || inputBytes < 0) {
    throw new TypeError('PlanReview prompt size must be a non-negative byte count.');
  }
  return Math.ceil((inputBytes / 4) * INPUT_TOKEN_ESTIMATE_MARGIN);
}

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

function structuredOutputSchemaBytes({ outputContract, providerOutputMode, providerName } = {}) {
  // PlanReview's live certification uses Groq. Count the exact Groq strict
  // schema envelope only when that adapter actually sends it; JSON Object
  // mode and non-Groq test doubles do not put this schema on the wire.
  if (!outputContract || providerName !== 'groq' || providerOutputMode === 'GROQ_JSON_OBJECT') return 0;
  const contract = getProviderOutputContract(outputContract);
  if (!contract) return 0;
  const schema = toGroqStrictSchema(contract.schema);
  const envelope = { response_format: { type: 'json_schema', json_schema: { name: contract.name, strict: true, schema } } };
  return Buffer.byteLength(JSON.stringify(envelope), 'utf8');
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
  const durableReservations = typeof onReserve === 'function';
  if (accountedTokens > limits.maxTotalTokens) throw budgetError('RESTORED_USAGE_INVALID');
  if (modelCalls > limits.maxModelCalls) throw budgetError('RESTORED_MODEL_CALLS_INVALID');

  return Object.freeze({
    limits,
    durableReservations,
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
    async reserve({
      systemPrompt = '',
      recentHistory = [],
      maxTokens = limits.maxOutputTokens,
      outputContract = null,
      providerOutputMode = null,
      providerName = null,
    } = {}) {
      if (closed) throw budgetError('RUN_CLOSED');
      const schemaBytes = structuredOutputSchemaBytes({ outputContract, providerOutputMode, providerName });
      const inputBytes = Buffer.byteLength(`${textOf(systemPrompt)}\n${textOf(recentHistory)}`, 'utf8') + schemaBytes;
      const inputTokens = estimatePlanReviewInputTokens(inputBytes);
      const outputTokens = positiveLimit(maxTokens, limits.maxOutputTokens, limits.maxOutputTokens);
      if (inputTokens > limits.maxInputTokens) throw budgetError('INPUT_TOKENS');
      if (accountedTokens + inputTokens + outputTokens > limits.maxTotalTokens) throw budgetError('TOTAL_TOKENS');
      if (modelCalls >= limits.maxModelCalls) throw budgetError('MODEL_CALLS');
      const reservation = Object.freeze({ inputTokens, outputTokens, schemaBytes, reservedTokens: inputTokens + outputTokens });
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
    configuredModel: (...args) => provider.configuredModel?.(...args) || provider.model || null,
    isConfigured: (...args) => provider.isConfigured?.(...args) ?? true,
    get lastFailureReason() { return provider.lastFailureReason || null; },
    get lastResponseDiagnostics() { return provider.lastResponseDiagnostics || null; },
    recordOutputValidation: details => provider.recordOutputValidation?.(details),
    async generate(args = {}) {
      if (typeof provider.isConfigured === 'function' && !provider.isConfigured()) {
        return null;
      }
      const reservation = await budget.reserve({ ...args, providerName: provider.name || null });
      const response = await provider.generate({ ...args, maxTokens: reservation.outputTokens });
      if (args.signal?.aborted) {
        throw args.signal.reason || Object.assign(new Error('PlanReview provider result arrived after cancellation.'), { name: 'AbortError' });
      }
      const usage = response?.tokensUsed ?? response?.routing?.tokensUsed ?? response?.usage?.totalTokens;
      budget.settle(reservation, usage);
      // Keep conservative reservation accounting internal. The response's
      // token count is provider evidence and must never be replaced with an
      // input estimate or reservation when usage is missing.
      return response;
    },
  };
}
