import crypto from 'node:crypto';

export const RESEARCH_MESH_VERSION = 'research-mesh-1.0.0';
export const RESEARCH_POLICY_VERSION = 'research-policy-1.0.0';
export const A2A_V1_PROTOCOL_VERSION = '1.0';

export const RESEARCH_NEED_MODES = Object.freeze([
  'NO_RESEARCH',
  'QUICK_RESEARCH',
  'DEEP_RESEARCH',
]);

export const RESEARCH_HARD_BUDGETS = Object.freeze({
  maxResearchRounds: 3,
  maxSearchQueries: 6,
  maxResultsPerQuery: 5,
  maxUniqueDocuments: 12,
  maxConcurrentFetches: 4,
  maxModelCalls: 6,
  maxOutputTokens: 2500,
  maxTotalTokens: 15000,
  maxDurationMs: 60000,
});

export const RESEARCH_CAPABILITIES = Object.freeze([
  'search:public_financial_sources',
  'retrieve:public_document',
  'extract:public_evidence',
  'verify:research_claim',
  'emit:research_artifact',
]);

export const RESEARCH_FORBIDDEN_CAPABILITIES = Object.freeze([
  'read:raw_financial_profile',
  'read:user_income',
  'read:user_email',
  'read:user_phone',
  'write:financial_profile',
  'write:recommendation',
  'execute:plan_recompute',
  'authorize:financial_action',
  'trade',
  'pay',
  'transfer',
  'rebalance',
  'invoke:authorized_action_executor',
  'promote:agent_scaffold',
]);

export const RESEARCH_EVENT_TYPES = Object.freeze([
  'RESEARCH_REQUIRED',
  'RESEARCH_TASK_STARTED',
  'RESEARCH_SEARCH_ROUND',
  'RESEARCH_SOURCES_FOUND',
  'RESEARCH_VERIFYING',
  'RESEARCH_COMPLETED',
  'RESEARCH_FAILED',
  'SCENARIO_ANALYSIS_STARTED',
  'SCENARIO_ANALYSIS_COMPLETED',
]);

export function boundedResearchBudget(overrides = {}) {
  const budget = {};
  for (const [key, hardMaximum] of Object.entries(RESEARCH_HARD_BUDGETS)) {
    const candidate = Number(overrides[key]);
    budget[key] = Number.isInteger(candidate) && candidate >= 0
      ? Math.min(candidate, hardMaximum)
      : hardMaximum;
  }
  return Object.freeze(budget);
}

export function stableResearchId(prefix, value) {
  return `${prefix}_${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24).toUpperCase()}`;
}

export function emptyResearchBudgetUsage() {
  return {
    rounds: 0,
    queryCount: 0,
    documentCount: 0,
    modelCalls: 0,
    tokenUsage: 0,
    durationMs: 0,
    exhausted: false,
  };
}
