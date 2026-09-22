import crypto from 'crypto';
import { END, START, StateGraph } from '@langchain/langgraph';
import { recordAgentError, startAgentSpan, withAgentSpan } from '../observability/agentTelemetry.js';
import { verifyEvidencePacket } from '../a2a/evidenceVerifier.js';
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
import {
  PLAN_REVIEW_GRAPH_VERSION,
  PLAN_REVIEW_TRAJECTORY_EVENTS,
} from './planReviewRuntime.js';

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

async function reportProgress(dependencies, payload) {
  if (typeof dependencies.onNodeProgress !== 'function') return;
  await withAgentSpan('agent.step', {
    'agent.type': 'PLAN_REVIEW',
    'agent.name': payload.node,
    'agent.graph_version': PLAN_REVIEW_GRAPH_VERSION,
    'agent.status': payload.event?.type || 'NODE_ENTERED',
  }, async span => {
    await dependencies.onNodeProgress({ graphVersion: PLAN_REVIEW_GRAPH_VERSION, ...payload });
    span.setAttribute('agent.status', 'COMPLETED');
  });
}

function trajectoryEvent(type, payload = {}) {
  if (!PLAN_REVIEW_TRAJECTORY_EVENTS.includes(type)) return null;
  return { type, ...payload, at: new Date().toISOString() };
}

function deterministicChecks(profile) {
  return profile ? [...SAFE_PLAN_REVIEW_TOOLS] : [];
}

function allowedTools(dependencies = {}) {
  const requested = dependencies.scaffoldSpec?.tools;
  if (!Array.isArray(requested)) return SAFE_PLAN_REVIEW_TOOLS;
  return SAFE_PLAN_REVIEW_TOOLS.filter(tool => requested.includes(tool));
}

function plannerPrompt(freshness, profileContext, tools = SAFE_PLAN_REVIEW_TOOLS) {
  return [
    'You are a bounded routing planner for a read-only financial plan review.',
    'Return JSON only: {"checks":["allowed_tool_name"]}.',
    `Allowed tools: ${tools.join(', ')}.`,
    'Never return mutation, optimizer, rebalance, HTTP, shell, raw database, or unknown tools.',
    `Freshness reason codes: ${JSON.stringify(freshness?.reasonCodes || [])}.`,
    `Profile available: ${Boolean(profileContext)}.`,
  ].join('\n');
}

export async function planWithProvider({ freshness, profileContext, provider, tools = SAFE_PLAN_REVIEW_TOOLS }) {
  if (!provider || typeof provider.generate !== 'function') return null;
  const response = await withAgentSpan('gen_ai.chat', {
    'agent.type': 'PLAN_REVIEW',
    'gen_ai.operation.name': 'planner',
    'gen_ai.request.model': provider.configuredModel?.() || provider.model || 'configured-provider',
  }, async span => {
    const value = await provider.generate({
      systemPrompt: plannerPrompt(freshness, profileContext, tools),
      recentHistory: [{ role: 'user', parts: [{ text: 'Select only the minimum safe read-only checks.' }] }],
      maxTokens: 240,
      jsonMode: true,
      tools: null,
    });
    if (value?.model) span.setAttribute('gen_ai.response.model', value.model);
    if (value?.tokensUsed) span.setAttribute('gen_ai.usage.total_tokens', Number(value.tokensUsed));
    return value;
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
  if (state.resumeCheckpoint?.contextReady && state.resumeCheckpoint.profileContext) {
    return {
      ...state.resumeCheckpoint,
      status: 'RUNNING',
      stepCount: incrementStep(state, dependencies),
    };
  }
  const contextLoader = dependencies.loadPlanReviewContext || loadPlanReviewContext;
  const context = await contextLoader({
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
  const tools = allowedTools(dependencies);
  const required = deterministicChecks(state.profile).filter(tool => tools.includes(tool));
  let planner = { provider: 'DETERMINISTIC', model: null, fallback: true };
  let requestedChecks = required;
  let modelCallCount = Number(state.modelCallCount || 0);
  const plannerProvider = dependencies.plannerProvider || (dependencies.modelGateway && dependencies.modelPlannerEnabled ? {
    name: 'model-gateway',
    configuredModel: () => 'model-gateway',
    generate: args => dependencies.modelGateway.generate({ role: 'PLANNER', ...args }),
  } : null);
  if (state.profile && plannerProvider) {
    try {
      if (modelCallCount >= configuredLimit(dependencies.maxModelCalls, 2, 2)) {
        const error = new Error('AGENT_BUDGET_EXCEEDED');
        error.code = 'AGENT_BUDGET_EXCEEDED';
        throw error;
      }
      modelCallCount += 1;
      const modelPlan = await planWithProvider({
        freshness: state.freshness,
        profileContext: state.profileContext,
        provider: plannerProvider,
        tools,
      });
      if (modelPlan) {
        planner = modelPlan;
        const maxToolCalls = configuredLimit(dependencies.maxToolCalls, MAX_TOOL_CALLS, MAX_TOOL_CALLS);
        requestedChecks = unique([...modelPlan.checks, ...required]).filter(tool => tools.includes(tool)).slice(0, maxToolCalls);
      }
    } catch (error) {
      if (error?.code === 'AGENT_BUDGET_EXCEEDED') throw error;
      planner = { provider: 'DETERMINISTIC', model: null, fallback: true };
    }
  }
  return {
    stepCount: incrementStep(state, dependencies),
    requestedChecks,
    planner,
    modelCallCount,
  };
}

async function executeSafeToolsNode(state, dependencies) {
  const toolResults = { ...(state.toolResults || {}) };
  const toolCallCounts = { ...(state.toolCallCounts || {}) };
  const repeatedRequests = [];
  let toolCallCount = Number(state.toolCallCount || 0);
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
  const tools = allowedTools(dependencies);
  for (const toolName of state.requestedChecks || []) {
    if (!tools.includes(toolName)) {
      repeatedRequests.push(`UNKNOWN_TOOL:${toolName}`);
      continue;
    }
    if (toolCallCount >= maxToolCalls || (toolCallCounts[toolName] || 0) >= maxToolCallsPerTool) {
      repeatedRequests.push(`LIMIT:${toolName}`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(toolResults, toolName)) {
      repeatedRequests.push(`CHECKPOINT_REUSED:${toolName}`);
      continue;
    }
    toolCallCount += 1;
    toolCallCounts[toolName] = (toolCallCounts[toolName] || 0) + 1;
    try {
      const timeoutMs = Number(dependencies.toolTimeoutMs) || 5000;
      const result = await withAgentSpan('agent.tool', {
        'agent.type': 'PLAN_REVIEW',
        'agent.tool_name': toolName,
      }, async span => {
        const value = await withTimeout(executePlanReviewTool(toolName, context), timeoutMs);
        span.setAttribute('agent.tool_outcome', 'SUCCEEDED');
        return value;
      });
      toolResults[toolName] = result;
      PrometheusMetrics.recordAgentToolCall(toolName, true);
      await reportProgress(dependencies, {
        node: 'execute_safe_tools',
        state: { ...state, toolResults, toolCallCounts, toolCallCount, repeatedRequests },
        event: trajectoryEvent('TOOL_SUCCEEDED', { tool: toolName }),
      });
    } catch (error) {
      toolResults[toolName] = { status: 'UNAVAILABLE', unavailableFacts: [error.code || 'TOOL_FAILED'] };
      repeatedRequests.push(`${toolName}:${error.code || 'TOOL_FAILED'}`);
      PrometheusMetrics.recordAgentToolCall(toolName, false);
      await reportProgress(dependencies, {
        node: 'execute_safe_tools',
        state: { ...state, toolResults, toolCallCounts, toolCallCount, repeatedRequests },
        event: trajectoryEvent('TOOL_FAILED', { tool: toolName, code: error.code || 'TOOL_FAILED' }),
      });
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
  let modelCallCount = Number(state.modelCallCount || 0);
  const evidenceHasInjection = validated.evidencePacket.entries.some(entry => isGroundingBoundaryAttack(
    [entry?.displayValue, entry?.value && JSON.stringify(entry.value)].filter(Boolean).join(' '),
  ));
  if (state.profile && state.recommendation && evidence?.status === 'AVAILABLE'
      && validated.evidencePacket.entries.length > 0 && !evidenceHasInjection) {
    try {
      if (modelCallCount >= configuredLimit(dependencies.maxModelCalls, 2, 2)) {
        const error = new Error('AGENT_BUDGET_EXCEEDED');
        error.code = 'AGENT_BUDGET_EXCEEDED';
        throw error;
      }
      modelCallCount += 1;
      explanation = await withAgentSpan('gen_ai.chat', {
        'agent.type': 'PLAN_REVIEW',
        'gen_ai.operation.name': 'explainer',
      }, async span => {
        const gatewayProvider = dependencies.modelGateway ? {
          name: 'model-gateway',
          configuredModel: () => 'model-gateway',
          generate: args => dependencies.modelGateway.generate({ role: 'EXPLAINER', ...args }),
        } : null;
        const value = await generateGroundedExplanation({
          question: 'Review the current saved financial plan for evidence alignment. Do not propose new allocations, weights, products, tax results, or changes. State only what the evidence supports and its limitations.',
          evidencePacket: validated.evidencePacket,
        }, {
          providers: gatewayProvider ? [gatewayProvider] : dependencies.explanationProviders,
          getCache: async () => null,
          setCache: async () => undefined,
        });
        if (value?.model) span.setAttribute('gen_ai.response.model', value.model);
        if (value?.tokensUsed) span.setAttribute('gen_ai.usage.total_tokens', Number(value.tokensUsed));
        span.setAttribute('agent.fallback_used', Boolean(value?.fallback));
        return value;
      });
      provider = { provider: explanation.provider, model: explanation.model, fallback: explanation.fallback };
    } catch (error) {
      if (error?.code === 'AGENT_BUDGET_EXCEEDED') throw error;
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
    modelCallCount,
    review,
    stepCount: incrementStep(state, dependencies),
  };
}

async function validateAgentOutputNode(state, dependencies = {}) {
  if (!state.review) {
    return { validation: { valid: false, errors: ['REVIEW_MISSING'] } };
  }
  const verifier = dependencies.evidenceVerifier || verifyEvidencePacket;
  const evidenceVerification = await verifier({ review: state.review, evidencePacket: state.evidencePacket });
  if (!state.explanation) {
    return {
      validation: { valid: evidenceVerification.valid, errors: evidenceVerification.valid ? [] : ['EVIDENCE_VERIFICATION_FAILED'] },
      evidenceVerification,
    };
  }
  const candidate = {
    text: state.explanation.text,
    evidenceIdsUsed: state.explanation.evidenceIdsUsed,
    claims: state.explanation.claims,
    unavailableFacts: state.explanation.unavailableFacts,
  };
  const validation = validateGroundedExplanation(candidate, state.evidencePacket);
  return {
    validation: {
      ...validation,
      valid: validation.valid && evidenceVerification.valid,
      errors: [...(validation.errors || []), ...(evidenceVerification.valid ? [] : ['EVIDENCE_VERIFICATION_FAILED'])],
    },
    evidenceVerification,
  };
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
      modelCallCount: state.modelCallCount,
    });
  }
  PrometheusMetrics.recordAgentRun(state.status === 'COMPLETED' ? 'completed' : 'failed');
  return { status: state.status || 'COMPLETED' };
}

export function createPlanReviewGraph(dependencies = {}) {
  const graph = new StateGraph(PlanReviewState)
    .addNode('load_context', async state => {
      const next = await loadContextNode(state, dependencies);
      await reportProgress(dependencies, { node: 'load_context', state: { ...state, ...next }, event: trajectoryEvent('NODE_ENTERED', { node: 'load_context' }) });
      return next;
    })
    .addNode('check_recommendation_freshness', async state => {
      const next = { freshness: state.freshness, stepCount: incrementStep(state, dependencies) };
      await reportProgress(dependencies, { node: 'check_recommendation_freshness', state: { ...state, ...next }, event: trajectoryEvent('NODE_ENTERED', { node: 'check_recommendation_freshness' }) });
      return next;
    })
    .addNode('determine_required_checks', async state => {
      const next = await determineChecksNode(state, dependencies);
      await reportProgress(dependencies, { node: 'determine_required_checks', state: { ...state, ...next }, event: trajectoryEvent('NODE_ENTERED', { node: 'determine_required_checks' }) });
      return next;
    })
    .addNode('execute_safe_tools', async state => executeSafeToolsNode(state, dependencies))
    .addNode('validate_evidence', async state => {
      const next = await validateEvidenceNode(state);
      await reportProgress(dependencies, { node: 'validate_evidence', state: { ...state, ...next }, event: trajectoryEvent('EVIDENCE_VALIDATED') });
      return next;
    })
    .addNode('synthesize_review', async state => {
      const next = await synthesizeNode(state, dependencies);
      await reportProgress(dependencies, { node: 'synthesize_review', state: { ...state, ...next }, event: trajectoryEvent(next.explanation?.fallback ? 'FALLBACK_USED' : 'NODE_ENTERED', { node: 'synthesize_review' }) });
      return next;
    })
    .addNode('validate_agent_output', async state => {
      const next = await validateAgentOutputNode(state, dependencies);
      await reportProgress(dependencies, { node: 'validate_agent_output', state: { ...state, ...next }, event: trajectoryEvent('NODE_ENTERED', { node: 'validate_agent_output' }) });
      return next;
    })
    .addNode('policy_guard', async state => {
      const next = await policyGuardNode(state);
      await reportProgress(dependencies, { node: 'policy_guard', state: { ...state, ...next }, event: trajectoryEvent(next.policy?.allowed === false ? 'POLICY_REJECTED' : 'NODE_ENTERED', { node: 'policy_guard' }) });
      return next;
    })
    .addNode('persist_agent_run', async state => {
      const next = await persistNode(state, dependencies);
      await reportProgress(dependencies, { node: 'persist_agent_run', state: { ...state, ...next }, event: trajectoryEvent('RUN_COMPLETED') });
      return next;
    })
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
  return graph.compile(dependencies.checkpointer ? { checkpointer: dependencies.checkpointer } : undefined);
}

export async function invokePlanReviewGraph({ userId, profileId, runId: requestedRunId = null, correlationId = null, traceId = null, resumeCheckpoint = null, dependencies = {} }) {
  const runId = requestedRunId || uuid();
  const startedAt = new Date();
  const graph = createPlanReviewGraph(dependencies);
  const state = {
    runId,
    userId: String(userId),
    profileId: String(profileId),
    correlationId,
    traceId: traceId || correlationId || runId,
    startedAt: startedAt.toISOString(),
    resumeCheckpoint: resumeCheckpoint?.state || resumeCheckpoint || null,
  };
  const timeoutMs = Number(dependencies.timeoutMs) || 30000;
  const invoke = graph.invoke(state, {
    recursionLimit: 20,
    ...(dependencies.checkpointer ? { configurable: { thread_id: runId } } : {}),
  });
  return startAgentSpan('plan_review.run', {
    attributes: {
      'agent.type': 'PLAN_REVIEW',
      'agent.run_id': runId,
      'agent.correlation_id_present': Boolean(correlationId),
      'agent.graph_version': PLAN_REVIEW_GRAPH_VERSION,
      'agent.version': 'plan-review-agent-2.0.0',
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
      recordAgentError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

export { getPlanReviewToolDefinitions };
