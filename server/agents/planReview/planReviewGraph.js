import crypto from 'crypto';
import { END, START, StateGraph } from '@langchain/langgraph';
import { trace } from '../../config/tracing.js';
import { PrometheusMetrics } from '../../services/metricsCollector.js';
import { generateGroundedExplanation, isGroundingBoundaryAttack } from '../../services/groundedExplanationService.js';
import { parseGroundedModelJson, validateGroundedExplanation } from '../../services/groundingValidator.js';
import { loadPlanReviewContext, executePlanReviewTool, getPlanReviewToolDefinitions } from './planReviewTools.js';
import { PlanReviewState } from './planReviewState.js';
import {
  MAX_AGENT_STEPS,
  MAX_TOOL_CALLS,
  MAX_TOOL_CALLS_PER_TOOL,
  SAFE_PLAN_REVIEW_TOOLS,
  validatePlannerPlan,
} from './planReviewSchemas.js';
import {
  buildSafeReview,
  policyGuardReview,
  safeFallbackAfterPolicyRejection,
} from './planReviewPolicy.js';

function uuid() {
  return crypto.randomUUID();
}

function configuredLimit(value, fallback, hardMaximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(hardMaximum, Math.floor(parsed))
    : fallback;
}

function incrementStep(state, dependencies = {}) {
  const limit = configuredLimit(dependencies.maxSteps, MAX_AGENT_STEPS, MAX_AGENT_STEPS);
  return Math.min(limit, Number(state.stepCount || 0) + 1);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('TOOL_TIMEOUT');
      error.code = 'TOOL_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function deterministicChecks(profile) {
  return profile ? [...SAFE_PLAN_REVIEW_TOOLS] : [];
}

function plannerPrompt(freshness, profileContext) {
  return [
    'You are a bounded routing planner for a read-only financial plan review.',
    'Return JSON only: {"checks":["allowed_tool_name"]}.',
    `Allowed tools: ${SAFE_PLAN_REVIEW_TOOLS.join(', ')}.`,
    'Never return mutation, optimizer, rebalance, HTTP, shell, raw database, or unknown tools.',
    `Freshness reason codes: ${JSON.stringify(freshness?.reasonCodes || [])}.`,
    `Profile available: ${Boolean(profileContext)}.`,
  ].join('\n');
}

export async function planWithProvider({ freshness, profileContext, provider }) {
  if (!provider || typeof provider.generate !== 'function') return null;
  const response = await provider.generate({
    systemPrompt: plannerPrompt(freshness, profileContext),
    recentHistory: [{ role: 'user', parts: [{ text: 'Select only the minimum safe read-only checks.' }] }],
    maxTokens: 240,
    jsonMode: true,
    tools: null,
  });
  if (!response?.text) return null;
  const parsed = parseGroundedModelJson(response.text);
  const validation = validatePlannerPlan(parsed);
  if (validation.error) {
    const error = new Error('INVALID_PLANNER_OUTPUT');
    error.details = validation.error.details.map(detail => detail.type);
    throw error;
  }
  return { ...validation.value, provider: response.provider || provider.name, model: response.model || null, fallback: false };
}

async function loadContextNode(state, dependencies) {
  const context = await loadPlanReviewContext({
    userId: state.userId,
    profileId: state.profileId,
    dependencies,
  });
  return {
    stepCount: incrementStep(state, dependencies),
    profile: context.profile,
    profileContext: context.profileContext,
    recommendation: context.recommendation,
    recommendationSummary: context.recommendationSummary,
    freshness: context.freshness,
    status: 'RUNNING',
  };
}

async function determineChecksNode(state, dependencies) {
  const required = deterministicChecks(state.profile);
  let planner = { provider: 'DETERMINISTIC', model: null, fallback: true };
  let requestedChecks = required;
  if (state.profile && dependencies.plannerProvider) {
    try {
      const modelPlan = await planWithProvider({
        freshness: state.freshness,
        profileContext: state.profileContext,
        provider: dependencies.plannerProvider,
      });
      if (modelPlan) {
        planner = modelPlan;
        const maxToolCalls = configuredLimit(dependencies.maxToolCalls, MAX_TOOL_CALLS, MAX_TOOL_CALLS);
        requestedChecks = unique([...modelPlan.checks, ...required]).slice(0, maxToolCalls);
      }
    } catch {
      planner = { provider: 'DETERMINISTIC', model: null, fallback: true };
    }
  }
  return {
    stepCount: incrementStep(state, dependencies),
    requestedChecks,
    planner,
  };
}

async function executeSafeToolsNode(state, dependencies) {
  const toolResults = {};
  const toolCallCounts = {};
  const repeatedRequests = [];
  let toolCallCount = 0;
  const maxToolCalls = configuredLimit(dependencies.maxToolCalls, MAX_TOOL_CALLS, MAX_TOOL_CALLS);
  const maxToolCallsPerTool = configuredLimit(
    dependencies.maxToolCallsPerTool,
    MAX_TOOL_CALLS_PER_TOOL,
    MAX_TOOL_CALLS_PER_TOOL,
  );
  const context = {
    userId: state.userId,
    profileId: state.profileId,
    profile: state.profile,
    profileContext: state.profileContext,
    recommendation: state.recommendation,
    recommendationSummary: state.recommendationSummary,
    freshness: state.freshness,
    dependencies,
  };
  for (const toolName of state.requestedChecks || []) {
    if (!SAFE_PLAN_REVIEW_TOOLS.includes(toolName)) {
      repeatedRequests.push(`UNKNOWN_TOOL:${toolName}`);
      continue;
    }
    if (toolCallCount >= maxToolCalls || (toolCallCounts[toolName] || 0) >= maxToolCallsPerTool) {
      repeatedRequests.push(`LIMIT:${toolName}`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(toolResults, toolName)) {
      repeatedRequests.push(`REPEATED:${toolName}`);
      continue;
    }
    toolCallCount += 1;
    toolCallCounts[toolName] = (toolCallCounts[toolName] || 0) + 1;
    try {
      const timeoutMs = Number(dependencies.toolTimeoutMs) || 5000;
      const result = await withTimeout(executePlanReviewTool(toolName, context), timeoutMs);
      toolResults[toolName] = result;
      PrometheusMetrics.recordAgentToolCall(toolName, true);
    } catch (error) {
      toolResults[toolName] = { status: 'UNAVAILABLE', unavailableFacts: [error.code || 'TOOL_FAILED'] };
      repeatedRequests.push(`${toolName}:${error.code || 'TOOL_FAILED'}`);
      PrometheusMetrics.recordAgentToolCall(toolName, false);
    }
  }
  return {
    toolResults,
    toolCallCounts,
    toolCallCount,
    repeatedRequests,
  };
}

async function validateEvidenceNode(state) {
  const evidence = state.toolResults?.get_plan_evidence_snapshot;
  const goalSummary = state.toolResults?.get_goal_status_summary
    || { status: state.profile ? 'NONE' : 'UNAVAILABLE', items: [] };
  const evidencePacket = evidence?.status === 'AVAILABLE'
    ? {
      groundingVersion: evidence.groundingVersion,
      evidenceHash: evidence.evidenceHash,
      entries: evidence.entries || [],
      unavailableFacts: evidence.unavailableFacts || [],
    }
    : { groundingVersion: null, evidenceHash: null, entries: [], unavailableFacts: evidence?.unavailableFacts || ['EVIDENCE_UNAVAILABLE'] };
  const evidenceIds = unique(evidencePacket.entries.map(item => item?.id));
  const evidenceValid = evidenceIds.length === evidencePacket.entries.length
    && evidenceIds.every(id => /^E_[A-Z0-9_:-]+$/.test(id));
  if (!evidenceValid) {
    evidencePacket.entries = [];
    evidencePacket.unavailableFacts = unique([...evidencePacket.unavailableFacts, 'EVIDENCE_UNAVAILABLE']);
  }
  return {
    evidencePacket,
    goalSummary,
    errors: evidenceValid ? [] : ['INVALID_EVIDENCE_SNAPSHOT'],
  };
}

async function synthesizeNode(state, dependencies) {
  const validated = await validateEvidenceNode(state);
  const evidence = state.toolResults?.get_plan_evidence_snapshot;
  const safeProvider = { provider: 'DETERMINISTIC_FALLBACK', model: null, fallback: true };
  let explanation = null;
  let provider = safeProvider;
  const evidenceHasInjection = validated.evidencePacket.entries.some(entry => isGroundingBoundaryAttack(
    [entry?.displayValue, entry?.value && JSON.stringify(entry.value)].filter(Boolean).join(' '),
  ));
  if (state.profile && state.recommendation && evidence?.status === 'AVAILABLE'
      && validated.evidencePacket.entries.length > 0 && !evidenceHasInjection) {
    try {
      explanation = await generateGroundedExplanation({
        question: 'Review the current saved financial plan for evidence alignment. Do not propose new allocations, weights, products, tax results, or changes. State only what the evidence supports and its limitations.',
        evidencePacket: validated.evidencePacket,
      }, {
        providers: dependencies.explanationProviders,
        getCache: async () => null,
        setCache: async () => undefined,
      });
      provider = { provider: explanation.provider, model: explanation.model, fallback: explanation.fallback };
    } catch {
      explanation = null;
      provider = safeProvider;
    }
  }
  const base = buildSafeReview({
    runId: state.runId,
    profile: state.profile,
    freshness: state.freshness,
    goalSummary: validated.goalSummary,
    evidence: evidence || { status: 'UNAVAILABLE', entries: [], unavailableFacts: ['EVIDENCE_UNAVAILABLE'] },
    provider,
    stepCount: state.stepCount,
    toolCallCount: state.toolCallCount,
  });
  const review = explanation?.text && !explanation.fallback
    ? { ...base, summary: explanation.text, provider }
    : base;
  return {
    ...validated,
    explanation,
    review,
    stepCount: incrementStep(state, dependencies),
  };
}

async function validateAgentOutputNode(state) {
  if (!state.review) {
    return { validation: { valid: false, errors: ['REVIEW_MISSING'] } };
  }
  if (!state.explanation) return { validation: { valid: true, errors: [] } };
  const candidate = {
    text: state.explanation.text,
    evidenceIdsUsed: state.explanation.evidenceIdsUsed,
    claims: state.explanation.claims,
    unavailableFacts: state.explanation.unavailableFacts,
  };
  const validation = validateGroundedExplanation(candidate, state.evidencePacket);
  return { validation };
}

async function policyGuardNode(state) {
  const policy = policyGuardReview(state.review, state.evidencePacket, state.explanation);
  if (policy.allowed && state.validation?.valid) {
    return { policy, status: 'COMPLETED' };
  }
  PrometheusMetrics.recordAgentPolicyRejection();
  const fallback = safeFallbackAfterPolicyRejection({
    runId: state.runId,
    profile: state.profile,
    freshness: state.freshness,
    goalSummary: state.goalSummary,
    evidence: state.toolResults?.get_plan_evidence_snapshot,
    provider: state.review?.provider,
    reasonCodes: unique([...policy.reasonCodes, ...(state.validation?.errors || [])]),
    stepCount: state.stepCount,
    toolCallCount: state.toolCallCount,
  });
  return { policy: { ...policy, allowed: false }, review: fallback, status: 'COMPLETED' };
}

async function persistNode(state, dependencies) {
  const review = state.review;
  if (typeof dependencies.persistAgentRun === 'function') {
    await dependencies.persistAgentRun({
      review,
      userId: state.userId,
      profileId: state.profileId,
      recommendationId: state.recommendation?._id || null,
      traceId: state.traceId,
      correlationId: state.correlationId,
      startedAt: state.startedAt,
      completedAt: new Date(),
      planner: state.planner,
      stepCount: state.stepCount,
      toolCallCount: state.toolCallCount,
    });
  }
  PrometheusMetrics.recordAgentRun(state.status === 'COMPLETED' ? 'completed' : 'failed');
  return { status: state.status || 'COMPLETED' };
}

export function createPlanReviewGraph(dependencies = {}) {
  const graph = new StateGraph(PlanReviewState)
    .addNode('load_context', state => loadContextNode(state, dependencies))
    .addNode('check_recommendation_freshness', state => ({ freshness: state.freshness, stepCount: incrementStep(state, dependencies) }))
    .addNode('determine_required_checks', state => determineChecksNode(state, dependencies))
    .addNode('execute_safe_tools', state => executeSafeToolsNode(state, dependencies))
    .addNode('validate_evidence', validateEvidenceNode)
    .addNode('synthesize_review', state => synthesizeNode(state, dependencies))
    .addNode('validate_agent_output', validateAgentOutputNode)
    .addNode('policy_guard', policyGuardNode)
    .addNode('persist_agent_run', state => persistNode(state, dependencies))
    .addEdge(START, 'load_context')
    .addEdge('load_context', 'check_recommendation_freshness')
    .addEdge('check_recommendation_freshness', 'determine_required_checks')
    .addEdge('determine_required_checks', 'execute_safe_tools')
    .addEdge('execute_safe_tools', 'validate_evidence')
    .addEdge('validate_evidence', 'synthesize_review')
    .addEdge('synthesize_review', 'validate_agent_output')
    .addEdge('validate_agent_output', 'policy_guard')
    .addEdge('policy_guard', 'persist_agent_run')
    .addEdge('persist_agent_run', END);
  return graph.compile();
}

export async function invokePlanReviewGraph({ userId, profileId, correlationId = null, traceId = null, dependencies = {} }) {
  const runId = uuid();
  const startedAt = new Date();
  const graph = createPlanReviewGraph(dependencies);
  const state = {
    runId,
    userId: String(userId),
    profileId: String(profileId),
    correlationId,
    traceId: traceId || correlationId || runId,
    startedAt: startedAt.toISOString(),
  };
  const timeoutMs = Number(dependencies.timeoutMs) || 30000;
  const invoke = graph.invoke(state, { recursionLimit: 20 });
  const tracer = trace.getTracer('wealthgenie.plan-review');
  return tracer.startActiveSpan('plan_review.run', {
    attributes: {
      'agent.type': 'PLAN_REVIEW',
      'agent.run_id': runId,
      'agent.correlation_id_present': Boolean(correlationId),
    },
  }, async span => {
    try {
      const result = await Promise.race([
        invoke,
        new Promise((_, reject) => setTimeout(() => {
          const error = new Error('PLAN_REVIEW_TIMEOUT');
          error.code = 'PLAN_REVIEW_TIMEOUT';
          reject(error);
        }, timeoutMs)),
      ]);
      span.setAttribute('agent.step_count', Number(result.stepCount || 0));
      span.setAttribute('agent.tool_call_count', Number(result.toolCallCount || 0));
      return result;
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: 2 });
      throw error;
    } finally {
      span.end();
    }
  });
}

export { getPlanReviewToolDefinitions };
