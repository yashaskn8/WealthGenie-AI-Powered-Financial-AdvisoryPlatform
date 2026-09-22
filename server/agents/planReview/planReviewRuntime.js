import crypto from 'node:crypto';

export const PLAN_REVIEW_AGENT_VERSION = 'plan-review-agent-2.0.0';
export const PLAN_REVIEW_GRAPH_VERSION = 'plan-review-graph-1.1.0';
export const PLAN_REVIEW_GROUNDING_VERSION = 'grounded-financial-evidence-1.0.0';
export const PLAN_REVIEW_TOOL_CATALOG_VERSION = 'plan-review-tools-1.0.0';

export const PLAN_REVIEW_RUN_STATES = Object.freeze([
  'QUEUED',
  'RUNNING',
  'WAITING_FOR_APPROVAL',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'BUDGET_EXCEEDED',
  'FEATURE_UNAVAILABLE',
]);

export const ACTIVE_PLAN_REVIEW_STATES = Object.freeze([
  'QUEUED',
  'RUNNING',
  'WAITING_FOR_APPROVAL',
]);

export const TERMINAL_PLAN_REVIEW_STATES = Object.freeze([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'BUDGET_EXCEEDED',
  'FEATURE_UNAVAILABLE',
]);

export const PLAN_REVIEW_TRANSITIONS = Object.freeze({
  QUEUED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['WAITING_FOR_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED', 'BUDGET_EXCEEDED'],
  WAITING_FOR_APPROVAL: ['RUNNING', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  BUDGET_EXCEEDED: [],
  FEATURE_UNAVAILABLE: [],
});

export const PLAN_REVIEW_TRAJECTORY_EVENTS = Object.freeze([
  'PLAN_CREATED',
  'NODE_ENTERED',
  'TOOL_SELECTED',
  'TOOL_SUCCEEDED',
  'TOOL_FAILED',
  'EVIDENCE_VALIDATED',
  'RESEARCH_REQUIRED',
  'RESEARCH_TASK_STARTED',
  'RESEARCH_SEARCH_ROUND',
  'RESEARCH_SOURCES_FOUND',
  'RESEARCH_VERIFYING',
  'RESEARCH_COMPLETED',
  'RESEARCH_FAILED',
  'SCENARIO_ANALYSIS_STARTED',
  'SCENARIO_ANALYSIS_COMPLETED',
  'POLICY_REJECTED',
  'FALLBACK_USED',
  'APPROVAL_REQUESTED',
  'RUN_COMPLETED',
]);

export const PLAN_REVIEW_BUDGETS = Object.freeze({
  maxSteps: 6,
  maxToolCalls: 8,
  maxToolCallsPerTool: 2,
  maxModelCalls: 2,
  maxInputTokens: 4000,
  maxOutputTokens: 1200,
  maxTotalTokens: 5200,
  maxDurationMs: 30000,
  maxAttempts: 2,
});

export function hashPlanReviewRequest({ userId, profileId, agentVersion = PLAN_REVIEW_AGENT_VERSION }) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ userId: String(userId), profileId: String(profileId), agentVersion }))
    .digest('hex');
}

export function isActivePlanReviewState(status) {
  return ACTIVE_PLAN_REVIEW_STATES.includes(status);
}

export function isTerminalPlanReviewState(status) {
  return TERMINAL_PLAN_REVIEW_STATES.includes(status);
}

export function canTransitionPlanReviewState(from, to) {
  return PLAN_REVIEW_TRANSITIONS[from]?.includes(to) === true;
}

export function assertPlanReviewTransition(from, to) {
  if (!canTransitionPlanReviewState(from, to)) {
    const error = new Error(`Invalid plan review state transition: ${from} -> ${to}`);
    error.code = 'INVALID_AGENT_STATE_TRANSITION';
    throw error;
  }
}

export function buildApprovalAction(action, run) {
  const allowed = new Set(['APPROVE_RECOMPUTE', 'REJECT_RECOMPUTE', 'OPEN_PROFILE', 'OPEN_GOALS']);
  if (!allowed.has(action)) {
    const error = new Error('Unsupported plan review approval action.');
    error.code = 'UNSUPPORTED_AGENT_ACTION';
    throw error;
  }
  return {
    action,
    runId: String(run.runId),
    profileId: run.profileId ? String(run.profileId) : null,
    recommendationId: run.recommendationId ? String(run.recommendationId) : null,
    requiresAuthoritativeWorkflow: action === 'APPROVE_RECOMPUTE',
    mutationPerformed: false,
  };
}
