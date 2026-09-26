import crypto from 'crypto';
import { END, START, StateGraph } from '@langchain/langgraph';
import { recordAgentError, startAgentSpan, withAgentSpan } from '../observability/agentTelemetry.js';
import { verifyEvidencePacket } from '../a2a/evidenceVerifier.js';
import { PrometheusMetrics } from '../../services/metricsCollector.js';
import { generateGroundedExplanation, isGroundingBoundaryAttack } from '../../services/groundedExplanationService.js';
import { parseGroundedModelJson, validateGroundedExplanation } from '../../services/groundingValidator.js';
import { loadPlanReviewContext, executePlanReviewTool, getPlanReviewToolDefinitions } from './planReviewTools.js';
import { PlanReviewState } from './planReviewState.js';
import { createResearchBrief } from '../research/researchSchemas.js';
import { evaluateResearchNeed } from '../research/researchNeedEvaluator.js';
import { researchArtifactToEvidenceEntries } from '../research/researchArtifact.js';
import { verifyResearchArtifact } from '../research/researchClaimVerifier.js';
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
  PLAN_REVIEW_BUDGETS,
  PLAN_REVIEW_GRAPH_VERSION,
  PLAN_REVIEW_TRAJECTORY_EVENTS,
  hashPlanReviewSnapshot,
  planReviewGraphThreadId,
} from './planReviewRuntime.js';
import { resolvePromptBundle } from '../evolution/promptBundle.js';
import { canonicalSha256 } from '../../utils/canonicalJson.js';
import { hashGroundedEvidence } from '../../services/groundedEvidence.js';
import { createBudgetedPlanReviewProvider, createPlanReviewTokenBudget } from './planReviewTokenBudget.js';

function uuid() {
  return crypto.randomUUID();
}

function configuredLimit(value, fallback, hardMaximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(hardMaximum, Math.floor(parsed))
    : fallback;
}

function scaffoldLimit(dependencies, key, fallback, hardMaximum) {
  return configuredLimit(
    dependencies[key] ?? dependencies.scaffoldSpec?.softBudgets?.[key],
    fallback,
    hardMaximum,
  );
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

function plannerPrompt(freshness, profileContext, tools = SAFE_PLAN_REVIEW_TOOLS, promptBundle = null) {
  return [
    promptBundle?.plannerInstruction || 'You are a bounded routing planner for a read-only financial plan review.',
    'Return JSON only: {"checks":["allowed_tool_name"]}.',
    `Allowed tools: ${tools.join(', ')}.`,
    'Never return mutation, optimizer, rebalance, HTTP, shell, raw database, or unknown tools.',
    `Freshness reason codes: ${JSON.stringify(freshness?.reasonCodes || [])}.`,
    `Profile available: ${Boolean(profileContext)}.`,
  ].join('\n');
}

export async function planWithProvider({ freshness, profileContext, provider, tools = SAFE_PLAN_REVIEW_TOOLS, promptBundle = null }) {
  if (!provider || typeof provider.generate !== 'function') return null;
  const response = await withAgentSpan('gen_ai.chat', {
    'agent.type': 'PLAN_REVIEW',
    'gen_ai.operation.name': 'planner',
    'gen_ai.request.model': provider.configuredModel?.() || provider.model || 'configured-provider',
  }, async span => {
    const value = await provider.generate({
      systemPrompt: plannerPrompt(freshness, profileContext, tools, promptBundle),
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
  const contextLoader = dependencies.loadPlanReviewContext || loadPlanReviewContext;
  const context = await contextLoader({
    userId: state.userId,
    profileId: state.profileId,
    dependencies,
  });
  if (state.expectedPlanReviewSnapshotHash
      && context.planReviewSnapshotHash !== state.expectedPlanReviewSnapshotHash) {
    const error = new Error('The financial source state changed before the queued plan review started.');
    error.code = 'PLAN_REVIEW_SOURCE_SUPERSEDED';
    throw error;
  }
  const replay = state.resumeCheckpoint;
  let counters = {};
  if (replay?.schemaVersion === 'plan-review-replay-checkpoint-1.0.0') {
    const replayValid = replay.schemaVersion === 'plan-review-replay-checkpoint-1.0.0'
      && replay.runId === state.runId
      && replay.planReviewSnapshotHash === context.planReviewSnapshotHash
      && hashPlanReviewSnapshot(replay.sourceBinding) === replay.planReviewSnapshotHash
      && canonicalSha256({
        schemaVersion: replay.schemaVersion,
        runId: replay.runId,
        planReviewSnapshotHash: replay.planReviewSnapshotHash,
        sourceBinding: replay.sourceBinding,
        counters: replay.counters,
      }) === replay.checkpointHash;
    if (!replayValid) {
      const error = new Error('PlanReview replay checkpoint failed source or integrity validation.');
      error.code = 'CHECKPOINT_FAILURE';
      throw error;
    }
    counters = replay.counters || {};
  }
  const maxSteps = configuredLimit(dependencies.maxSteps, MAX_AGENT_STEPS, MAX_AGENT_STEPS);
  const maxToolCalls = configuredLimit(dependencies.maxToolCalls, MAX_TOOL_CALLS, MAX_TOOL_CALLS);
  const toolCallCounts = Object.fromEntries(Object.entries(counters.toolCallCounts || {})
    .filter(([name, count]) => SAFE_PLAN_REVIEW_TOOLS.includes(name) && Number.isInteger(Number(count)) && Number(count) >= 0)
    .map(([name, count]) => [name, Math.min(MAX_TOOL_CALLS_PER_TOOL, Number(count))]));
  const tokenUsage = counters.tokenUsage === undefined ? 0 : Number(counters.tokenUsage);
  const modelCallCount = counters.modelCallCount === undefined ? 0 : Number(counters.modelCallCount);
  const maxModelCalls = scaffoldLimit(dependencies, 'maxModelCalls', PLAN_REVIEW_BUDGETS.maxModelCalls, PLAN_REVIEW_BUDGETS.maxModelCalls);
  if (!Number.isInteger(tokenUsage) || tokenUsage < 0 || tokenUsage > scaffoldLimit(dependencies, 'maxTotalTokens', PLAN_REVIEW_BUDGETS.maxTotalTokens, PLAN_REVIEW_BUDGETS.maxTotalTokens)) {
    const error = new Error('PlanReview checkpoint token usage is invalid.');
    error.code = 'AGENT_BUDGET_EXCEEDED';
    throw error;
  }
  if (!Number.isInteger(modelCallCount) || modelCallCount < 0 || modelCallCount > maxModelCalls) {
    const error = new Error('PlanReview checkpoint model-call usage is invalid.');
    error.code = 'AGENT_BUDGET_EXCEEDED';
    throw error;
  }
  dependencies.modelBudget?.restore(tokenUsage);
  dependencies.modelBudget?.restoreModelCalls(modelCallCount);
  return {
    stepCount: Math.min(maxSteps, Math.max(0, Number(counters.stepCount) || 0) + 1),
    toolCallCount: Math.min(maxToolCalls, Math.max(0, Number(counters.toolCallCount) || 0)),
    toolCallCounts,
    modelCallCount,
    tokenUsage,
    profile: context.profile,
    profileContext: context.profileContext,
    recommendation: context.recommendation,
    currentState: context.currentState,
    sourceBinding: context.sourceBinding,
    planReviewSnapshotHash: context.planReviewSnapshotHash,
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
  const promptBundle = resolvePromptBundle({ dependencies, scaffoldSpec: dependencies.scaffoldSpec });
  const plannerRole = dependencies.scaffoldSpec?.safeModelRoleRouting?.planner || 'PLANNER';
  const plannerProvider = dependencies.plannerProvider
    ? createBudgetedPlanReviewProvider(dependencies.plannerProvider, dependencies.modelBudget)
    : (dependencies.modelGateway && dependencies.modelPlannerEnabled ? {
    name: 'model-gateway',
    configuredModel: () => 'model-gateway',
    generate: args => dependencies.modelGateway.generate({ role: plannerRole, ...args, requestBudget: dependencies.modelBudget }),
  } : null);
  if (state.profile && plannerProvider) {
    try {
      if (modelCallCount >= scaffoldLimit(dependencies, 'maxModelCalls', 2, 2)) {
        const error = new Error('AGENT_BUDGET_EXCEEDED');
        error.code = 'AGENT_BUDGET_EXCEEDED';
        throw error;
      }
      const modelPlan = await planWithProvider({
        freshness: state.freshness,
        profileContext: dependencies.scaffoldSpec?.contextCompressionPolicy === 'MINIMAL_PROFILE_CONTEXT'
          ? { available: Boolean(state.profileContext) }
          : state.profileContext,
        provider: plannerProvider,
        tools,
        promptBundle,
      });
      if (modelPlan) {
        planner = modelPlan;
        const maxToolCalls = scaffoldLimit(dependencies, 'maxToolCalls', MAX_TOOL_CALLS, MAX_TOOL_CALLS);
        requestedChecks = unique([...modelPlan.checks, ...required]).filter(tool => tools.includes(tool)).slice(0, maxToolCalls);
      }
      modelCallCount = dependencies.modelBudget?.modelCalls ?? modelCallCount + 1;
    } catch (error) {
      if (error?.code === 'AGENT_BUDGET_EXCEEDED' || error?.code === 'AGENT_BUDGET_PERSISTENCE_UNAVAILABLE') throw error;
      planner = { provider: 'DETERMINISTIC', model: null, fallback: true };
      modelCallCount = dependencies.modelBudget?.modelCalls ?? modelCallCount + 1;
    }
  }
  return {
    stepCount: incrementStep(state, dependencies),
    requestedChecks,
    planner,
    modelCallCount,
    tokenUsage: dependencies.modelBudget?.accountedTokens ?? Number(state.tokenUsage || 0),
  };
}

async function executeSafeToolsNode(state, dependencies) {
  const toolResults = { ...(state.toolResults || {}) };
  const toolCallCounts = { ...(state.toolCallCounts || {}) };
  const repeatedRequests = [];
  let toolCallCount = Number(state.toolCallCount || 0);
  const maxToolCalls = scaffoldLimit(dependencies, 'maxToolCalls', MAX_TOOL_CALLS, MAX_TOOL_CALLS);
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
    currentState: state.currentState,
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
  const evidence = state.evidencePacket || state.toolResults?.get_plan_evidence_snapshot;
  const goalSummary = state.toolResults?.get_goal_status_summary
    || { status: state.profile ? 'NONE' : 'UNAVAILABLE', items: [] };
  const evidencePacket = evidence?.status === 'AVAILABLE'
    ? { ...evidence, entries: evidence.entries || [], unavailableFacts: evidence.unavailableFacts || [], status: 'AVAILABLE' }
    : evidence?.supplementalResearchOnly === true
      ? { ...evidence, status: 'UNAVAILABLE' }
      : { groundingVersion: null, evidenceHash: null, entries: [], unavailableFacts: evidence?.unavailableFacts || ['EVIDENCE_UNAVAILABLE'], status: 'UNAVAILABLE' };
  const evidenceIds = unique(evidencePacket.entries.map(item => item?.id));
  const evidenceValid = evidenceIds.length === evidencePacket.entries.length
    && evidenceIds.every(id => /^E_[A-Z0-9_:-]+$/.test(id));
  const { evidenceHash, status: _status, ...hashPayload } = evidencePacket;
  const hashRequired = evidencePacket.status === 'AVAILABLE' || evidencePacket.supplementalResearchOnly === true;
  const hashValid = !hashRequired
    || (typeof evidenceHash === 'string' && hashGroundedEvidence(hashPayload) === evidenceHash);
  if (!evidenceValid || !hashValid) {
    evidencePacket.entries = [];
    evidencePacket.status = 'UNAVAILABLE';
    evidencePacket.evidenceHash = null;
    evidencePacket.unavailableFacts = unique([
      ...evidencePacket.unavailableFacts,
      'EVIDENCE_UNAVAILABLE',
      ...(!hashValid ? ['EVIDENCE_HASH_INVALID'] : []),
    ]);
  }
  return {
    evidencePacket,
    goalSummary,
    errors: evidenceValid && hashValid ? [] : ['INVALID_EVIDENCE_SNAPSHOT'],
  };
}

function researchBriefForPlan(state, mode) {
  return createResearchBrief({
    topic: 'Current public financial and regulatory evidence',
    question: 'Retrieve current public evidence that can safely explain a read-only financial plan review. Do not use private user information, make recommendations, or perform financial calculations.',
    jurisdiction: 'IN',
    requestedFactTypes: ['regulatory_context', 'public_market_context'],
    instrumentCategories: [],
    maxResearchDepth: mode === 'DEEP_RESEARCH' ? 3 : 1,
    correlationId: state.correlationId || null,
    runId: state.runId || null,
  });
}

async function researchMeshNode(state, dependencies) {
  const evidencePacket = state.evidencePacket || { status: 'UNAVAILABLE', entries: [], unavailableFacts: ['EVIDENCE_UNAVAILABLE'] };
  const researchNeed = evaluateResearchNeed({
    enabled: Boolean(dependencies.researchAdaptiveEnabled),
    evidenceStatus: evidencePacket.status,
    reasonCodes: evidencePacket.unavailableFacts || [],
    evidenceEntries: evidencePacket.entries || [],
  });
  const base = { researchNeed };
  if (researchNeed.mode === 'NO_RESEARCH') return base;
  if (!dependencies.researchMeshClient) return { ...base, researchFailure: 'RESEARCH_AGENT_UNAVAILABLE' };
  if (researchNeed.mode === 'DEEP_RESEARCH' && !dependencies.researchDeepEnabled) {
    return { ...base, researchFailure: 'DEEP_RESEARCH_DISABLED' };
  }
  const brief = researchBriefForPlan(state, researchNeed.mode);
  try {
    await reportProgress(dependencies, { node: 'research_mesh', state: { ...state, researchNeed }, event: trajectoryEvent('RESEARCH_REQUIRED', { mode: researchNeed.mode }) });
    await reportProgress(dependencies, { node: 'research_mesh', state: { ...state, researchNeed, researchBrief: brief }, event: trajectoryEvent('RESEARCH_TASK_STARTED') });
    const result = await dependencies.researchMeshClient.sendResearch({ brief });
    const verification = verifyResearchArtifact(result.artifact, { brief });
    if (!verification.valid) {
      return { ...base, researchBrief: brief, researchFailure: 'RESEARCH_ARTIFACT_REJECTED', researchVerification: verification };
    }
    const researchEntries = researchArtifactToEvidenceEntries(result.artifact);
    const existingIds = new Set(evidencePacket.entries.map(entry => entry.id));
    if (researchEntries.some(entry => existingIds.has(entry.id))) {
      return { ...base, researchBrief: brief, researchFailure: 'RESEARCH_EVIDENCE_ID_COLLISION', researchVerification: verification };
    }
    const mergedEntries = [...evidencePacket.entries, ...researchEntries];
    const { evidenceHash: _oldEvidenceHash, status: _status, ...hashPayload } = evidencePacket;
    const mergedPacket = {
      ...hashPayload,
      status: evidencePacket.status,
      supplementalResearchOnly: evidencePacket.status !== 'AVAILABLE' || evidencePacket.supplementalResearchOnly === true,
      entries: mergedEntries,
      // Research can supplement explanation, but it cannot erase authoritative
      // evidence failures or make a missing financial snapshot appear ready.
      unavailableFacts: [...(evidencePacket.unavailableFacts || [])],
    };
    const { status: _mergedStatus, ...mergedHashPayload } = mergedPacket;
    mergedPacket.evidenceHash = hashGroundedEvidence(mergedHashPayload);
    return {
      ...base,
      researchBrief: brief,
      researchArtifact: result.artifact,
      researchVerification: verification,
      supplementalResearchStatus: 'AVAILABLE',
      evidencePacket: mergedPacket,
    };
  } catch (error) {
    await reportProgress(dependencies, { node: 'research_mesh', state: { ...state, researchNeed, researchBrief: brief }, event: trajectoryEvent('RESEARCH_FAILED', { code: error.code || 'RESEARCH_FAILED' }) });
    return { ...base, researchBrief: brief, researchFailure: error.code || 'RESEARCH_FAILED' };
  }
}

async function synthesizeNode(state, dependencies) {
  const validated = await validateEvidenceNode(state);
  const promptBundle = resolvePromptBundle({ dependencies, scaffoldSpec: dependencies.scaffoldSpec });
  const evidenceEntries = [...(validated.evidencePacket.entries || [])];
  if (dependencies.scaffoldSpec?.evidenceOrderingPolicy === 'AUTHORITATIVE_FIRST') {
    evidenceEntries.sort((left, right) => String(left?.sourceTrustTier || '').localeCompare(String(right?.sourceTrustTier || '')));
  }
  const evidence = { ...validated.evidencePacket, entries: evidenceEntries };
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
      if (modelCallCount >= scaffoldLimit(dependencies, 'maxModelCalls', 2, 2)) {
        const error = new Error('AGENT_BUDGET_EXCEEDED');
        error.code = 'AGENT_BUDGET_EXCEEDED';
        throw error;
      }
      explanation = await withAgentSpan('gen_ai.chat', {
        'agent.type': 'PLAN_REVIEW',
        'gen_ai.operation.name': 'explainer',
      }, async span => {
        const gatewayProvider = dependencies.modelGateway ? {
          name: 'model-gateway',
          configuredModel: () => 'model-gateway',
          generate: args => dependencies.modelGateway.generate({ role: dependencies.scaffoldSpec?.safeModelRoleRouting?.synthesis || 'EXPLAINER', ...args, requestBudget: dependencies.modelBudget }),
        } : null;
        const explanationProviders = gatewayProvider
          ? [gatewayProvider]
          : (dependencies.explanationProviders || []).map(item => createBudgetedPlanReviewProvider(item, dependencies.modelBudget));
        const value = await generateGroundedExplanation({
          question: promptBundle.synthesisInstruction,
          evidencePacket: evidence,
        }, {
          providers: explanationProviders,
          getCache: async () => null,
          setCache: async () => undefined,
        });
        if (value?.model) span.setAttribute('gen_ai.response.model', value.model);
        if (value?.tokensUsed) span.setAttribute('gen_ai.usage.total_tokens', Number(value.tokensUsed));
        span.setAttribute('agent.fallback_used', Boolean(value?.fallback));
        return value;
      });
      provider = { provider: explanation.provider, model: explanation.model, fallback: explanation.fallback };
      modelCallCount = dependencies.modelBudget?.modelCalls ?? modelCallCount + 1;
    } catch (error) {
      if (error?.code === 'AGENT_BUDGET_EXCEEDED' || error?.code === 'AGENT_BUDGET_PERSISTENCE_UNAVAILABLE') throw error;
      explanation = null;
      provider = safeProvider;
      modelCallCount = dependencies.modelBudget?.modelCalls ?? modelCallCount + 1;
    }
  }
  const base = buildSafeReview({
    runId: state.runId,
    profile: state.profile,
    freshness: state.freshness,
    goalSummary: validated.goalSummary,
    evidence,
    provider,
    stepCount: state.stepCount,
    toolCallCount: state.toolCallCount,
  });
  const review = explanation?.text && !explanation.fallback
    ? { ...base, summary: explanation.text, provider }
    : base;
  const tokenUsage = dependencies.modelBudget?.accountedTokens ?? Number(state.tokenUsage || 0);
  review.execution = { ...review.execution, modelCallCount, tokenUsage };
  return {
    ...validated,
    explanation,
    modelCallCount,
    tokenUsage,
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

async function policyGuardNode(state, dependencies = {}) {
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
    evidence: state.evidencePacket,
    provider: state.review?.provider,
    reasonCodes: unique([...policy.reasonCodes, ...(state.validation?.errors || [])]),
    stepCount: state.stepCount,
    toolCallCount: state.toolCallCount,
    modelCallCount: state.modelCallCount,
    tokenUsage: dependencies.modelBudget?.accountedTokens ?? state.tokenUsage,
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
      recommendationId: state.sourceBinding?.recommendationId || state.recommendation?._id || null,
      planReviewSnapshotHash: state.planReviewSnapshotHash,
      sourceBinding: state.sourceBinding,
      traceId: state.traceId,
      correlationId: state.correlationId,
      startedAt: state.startedAt,
      completedAt: new Date(),
      planner: state.planner,
      stepCount: state.stepCount,
      toolCallCount: state.toolCallCount,
      modelCallCount: state.modelCallCount,
      tokenUsage: dependencies.modelBudget?.accountedTokens ?? state.tokenUsage,
    });
  }
  PrometheusMetrics.recordAgentRun(state.status === 'COMPLETED' ? 'completed' : 'failed');
  return { status: state.status || 'COMPLETED' };
}

export function createPlanReviewGraph(dependencies = {}) {
  const runtimeDependencies = {
    ...dependencies,
    modelBudget: dependencies.modelBudget || createPlanReviewTokenBudget({
      maxInputTokens: scaffoldLimit(dependencies, 'maxInputTokens', PLAN_REVIEW_BUDGETS.maxInputTokens, PLAN_REVIEW_BUDGETS.maxInputTokens),
      maxOutputTokens: scaffoldLimit(dependencies, 'maxOutputTokens', PLAN_REVIEW_BUDGETS.maxOutputTokens, PLAN_REVIEW_BUDGETS.maxOutputTokens),
      maxTotalTokens: scaffoldLimit(dependencies, 'maxTotalTokens', PLAN_REVIEW_BUDGETS.maxTotalTokens, PLAN_REVIEW_BUDGETS.maxTotalTokens),
      maxModelCalls: scaffoldLimit(dependencies, 'maxModelCalls', PLAN_REVIEW_BUDGETS.maxModelCalls, PLAN_REVIEW_BUDGETS.maxModelCalls),
      onReserve: dependencies.onModelBudgetReservation,
    }),
  };
  const graph = new StateGraph(PlanReviewState)
    .addNode('load_context', async state => {
      const next = await loadContextNode(state, runtimeDependencies);
      await reportProgress(runtimeDependencies, { node: 'load_context', state: { ...state, ...next }, event: trajectoryEvent('NODE_ENTERED', { node: 'load_context' }) });
      return next;
    })
    .addNode('check_recommendation_freshness', async state => {
      const next = { freshness: state.freshness, stepCount: incrementStep(state, runtimeDependencies) };
      await reportProgress(runtimeDependencies, { node: 'check_recommendation_freshness', state: { ...state, ...next }, event: trajectoryEvent('NODE_ENTERED', { node: 'check_recommendation_freshness' }) });
      return next;
    })
    .addNode('determine_required_checks', async state => {
      const next = await determineChecksNode(state, runtimeDependencies);
      await reportProgress(runtimeDependencies, { node: 'determine_required_checks', state: { ...state, ...next }, event: trajectoryEvent('NODE_ENTERED', { node: 'determine_required_checks' }) });
      return next;
    })
    .addNode('execute_safe_tools', async state => executeSafeToolsNode(state, runtimeDependencies))
    .addNode('validate_evidence', async state => {
      const next = await validateEvidenceNode(state);
      await reportProgress(runtimeDependencies, { node: 'validate_evidence', state: { ...state, ...next }, event: trajectoryEvent('EVIDENCE_VALIDATED') });
      return next;
    })
    .addNode('research_mesh', async state => {
      const next = await researchMeshNode(state, runtimeDependencies);
      await reportProgress(runtimeDependencies, { node: 'research_mesh', state: { ...state, ...next }, event: next.researchFailure ? trajectoryEvent('RESEARCH_FAILED', { code: next.researchFailure }) : trajectoryEvent('RESEARCH_COMPLETED', { mode: next.researchNeed?.mode }) });
      return next;
    })
    .addNode('synthesize_review', async state => {
      const next = await synthesizeNode(state, runtimeDependencies);
      await reportProgress(runtimeDependencies, { node: 'synthesize_review', state: { ...state, ...next }, event: trajectoryEvent(next.explanation?.fallback ? 'FALLBACK_USED' : 'NODE_ENTERED', { node: 'synthesize_review' }) });
      return next;
    })
    .addNode('validate_agent_output', async state => {
      const next = await validateAgentOutputNode(state, runtimeDependencies);
      await reportProgress(runtimeDependencies, { node: 'validate_agent_output', state: { ...state, ...next }, event: trajectoryEvent('NODE_ENTERED', { node: 'validate_agent_output' }) });
      return next;
    })
    .addNode('policy_guard', async state => {
      const next = await policyGuardNode(state, runtimeDependencies);
      await reportProgress(runtimeDependencies, { node: 'policy_guard', state: { ...state, ...next }, event: trajectoryEvent(next.policy?.allowed === false ? 'POLICY_REJECTED' : 'NODE_ENTERED', { node: 'policy_guard' }) });
      return next;
    })
    .addNode('persist_agent_run', async state => {
      const next = await persistNode(state, runtimeDependencies);
      await reportProgress(runtimeDependencies, { node: 'persist_agent_run', state: { ...state, ...next }, event: trajectoryEvent('RUN_COMPLETED') });
      return next;
    })
    .addEdge(START, 'load_context')
    .addEdge('load_context', 'check_recommendation_freshness')
    .addEdge('check_recommendation_freshness', 'determine_required_checks')
    .addEdge('determine_required_checks', 'execute_safe_tools')
    .addEdge('execute_safe_tools', 'validate_evidence')
    .addEdge('validate_evidence', 'research_mesh')
    .addEdge('research_mesh', 'synthesize_review')
    .addEdge('synthesize_review', 'validate_agent_output')
    .addEdge('validate_agent_output', 'policy_guard')
    .addEdge('policy_guard', 'persist_agent_run')
    .addEdge('persist_agent_run', END);
  return graph.compile(runtimeDependencies.checkpointer ? { checkpointer: runtimeDependencies.checkpointer } : undefined);
}

export async function invokePlanReviewGraph({
  userId,
  profileId,
  runId: requestedRunId = null,
  executionGeneration = 1,
  expectedPlanReviewSnapshotHash = null,
  correlationId = null,
  traceId = null,
  resumeCheckpoint = null,
  dependencies = {},
}) {
  const runId = requestedRunId || uuid();
  const checkpointThreadId = planReviewGraphThreadId(runId, executionGeneration);
  const startedAt = new Date();
  const modelBudget = dependencies.modelBudget || createPlanReviewTokenBudget({
    maxInputTokens: scaffoldLimit(dependencies, 'maxInputTokens', PLAN_REVIEW_BUDGETS.maxInputTokens, PLAN_REVIEW_BUDGETS.maxInputTokens),
    maxOutputTokens: scaffoldLimit(dependencies, 'maxOutputTokens', PLAN_REVIEW_BUDGETS.maxOutputTokens, PLAN_REVIEW_BUDGETS.maxOutputTokens),
    maxTotalTokens: scaffoldLimit(dependencies, 'maxTotalTokens', PLAN_REVIEW_BUDGETS.maxTotalTokens, PLAN_REVIEW_BUDGETS.maxTotalTokens),
    maxModelCalls: scaffoldLimit(dependencies, 'maxModelCalls', PLAN_REVIEW_BUDGETS.maxModelCalls, PLAN_REVIEW_BUDGETS.maxModelCalls),
    onReserve: dependencies.onModelBudgetReservation,
  });
  const executionDependencies = { ...dependencies, modelBudget };
  const graph = createPlanReviewGraph(executionDependencies);
  const state = {
    runId,
    userId: String(userId),
    profileId: String(profileId),
    executionGeneration,
    expectedPlanReviewSnapshotHash,
    correlationId,
    traceId: traceId || correlationId || runId,
    startedAt: startedAt.toISOString(),
    resumeCheckpoint: resumeCheckpoint?.state || resumeCheckpoint || null,
  };
  const timeoutMs = Number(dependencies.timeoutMs) || 30000;
  const invoke = graph.invoke(state, {
    recursionLimit: 20,
    ...(executionDependencies.checkpointer ? { configurable: { thread_id: checkpointThreadId } } : {}),
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
      modelBudget.close();
      return result;
    } catch (error) {
      modelBudget.close();
      if (error && typeof error === 'object') {
        error.planReviewUsage = {
          modelCallCount: modelBudget.modelCalls,
          tokenUsage: modelBudget.accountedTokens,
        };
      }
      recordAgentError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

export { getPlanReviewToolDefinitions };
