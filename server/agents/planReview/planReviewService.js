import crypto from 'node:crypto';
import AgentRun from '../../models/AgentRun.js';
import { ProviderManager } from '../../services/providerAbstraction.js';
import { getRuntimeConfig } from '../../config/runtime.js';
import { invokePlanReviewGraph } from './planReviewGraph.js';
import { PLAN_REVIEW_POLICY_VERSION, PLAN_REVIEW_PLANNER_VERSION } from './planReviewSchemas.js';
import {
  PLAN_REVIEW_AGENT_VERSION,
  PLAN_REVIEW_GRAPH_VERSION,
  PLAN_REVIEW_TOOL_CATALOG_VERSION,
  PLAN_REVIEW_BUDGETS,
  hashPlanReviewRequest,
  isActivePlanReviewState,
} from './planReviewRuntime.js';
import { createModelGateway } from '../modelGateway.js';

function primaryProvider() {
  const configured = String(process.env.LLM_PRIMARY_PROVIDER || 'NVIDIA_NIM').trim().toUpperCase();
  return {
    NVIDIA_NIM: ProviderManager.nvidia,
    GEMINI: ProviderManager.gemini,
    GROQ: ProviderManager.groq,
  }[configured] || ProviderManager.nvidia;
}

function publicReview(review) {
  if (!review) return null;
  const { execution: _execution, policyReasonCodes: _policyReasonCodes, ...safe } = review;
  return safe;
}

export async function persistPlanReviewRun({ review, userId, profileId, recommendationId, traceId, correlationId, startedAt, completedAt, _planner, stepCount, toolCallCount, model = AgentRun }) {
  const document = await model.create({
    runId: review.runId,
    agentType: 'PLAN_REVIEW',
    userId,
    profileId: review.recommendedAction === 'REVIEW_PROFILE' ? null : profileId,
    recommendationId: recommendationId || null,
    status: review.status,
    recommendedAction: review.recommendedAction,
    findingCodes: (review.findings || []).map(item => item.code),
    evidenceIds: (review.evidence?.entries || []).map(item => item.id).filter(Boolean),
    provider: review.provider?.name || 'DETERMINISTIC_FALLBACK',
    model: review.provider?.model || null,
    plannerVersion: PLAN_REVIEW_PLANNER_VERSION,
    policyVersion: PLAN_REVIEW_POLICY_VERSION,
    groundingVersion: review.evidence?.entries?.length ? 'grounded-financial-evidence-1.0.0' : null,
    agentVersion: PLAN_REVIEW_AGENT_VERSION,
    graphVersion: PLAN_REVIEW_GRAPH_VERSION,
    toolCatalogVersion: PLAN_REVIEW_TOOL_CATALOG_VERSION,
    traceId: traceId || null,
    correlationId: correlationId || null,
    stepCount: Math.min(6, Number(stepCount) || 0),
    toolCallCount: Math.min(8, Number(toolCallCount) || 0),
    result: publicReview(review),
    startedAt: new Date(startedAt),
    completedAt,
  });
  return document;
}

export async function runPlanReview({ userId, profileId, runId = null, resumeCheckpoint = null, correlationId = null, traceId = null, runtimeConfig = getRuntimeConfig(), dependencies = {} }) {
  const result = await invokePlanReviewGraph({
    userId,
    profileId,
    runId,
    resumeCheckpoint,
    correlationId,
    traceId,
    dependencies: {
      timeoutMs: runtimeConfig.agentPlanReview.timeoutMs,
      maxSteps: runtimeConfig.agentPlanReview.maxSteps,
      maxToolCalls: runtimeConfig.agentPlanReview.maxToolCalls,
      maxToolCallsPerTool: runtimeConfig.agentPlanReview.maxToolCallsPerTool,
      maxModelCalls: runtimeConfig.agentPlanReview.maxModelCalls,
      maxInputTokens: runtimeConfig.agentPlanReview.maxInputTokens,
      maxOutputTokens: runtimeConfig.agentPlanReview.maxOutputTokens,
      maxTotalTokens: runtimeConfig.agentPlanReview.maxTotalTokens,
      toolTimeoutMs: Math.min(5000, runtimeConfig.agentPlanReview.timeoutMs),
      plannerProvider: process.env.AGENT_USE_MODEL_PLANNER === 'true' ? primaryProvider() : null,
      modelPlannerEnabled: process.env.AGENT_USE_MODEL_PLANNER === 'true',
      modelGateway: createModelGateway({ maxOutputTokens: runtimeConfig.agentPlanReview.maxOutputTokens }),
      persistAgentRun: payload => persistPlanReviewRun(payload),
      ...dependencies,
    },
  });
  return publicReview(result.review);
}

function publicRun(run) {
  if (!run) return null;
  return {
    runId: run.runId,
    status: run.status,
    profileId: run.profileId ? String(run.profileId) : null,
    recommendationId: run.recommendationId ? String(run.recommendationId) : null,
    recommendedAction: run.recommendedAction,
    result: run.result || null,
    progress: run.progress || { completedNodes: [], percent: 0, label: null },
    currentNode: run.currentNode || null,
    attempt: run.attempt || 0,
    maxAttempts: run.maxAttempts || PLAN_REVIEW_BUDGETS.maxAttempts,
    agentVersion: run.agentVersion || PLAN_REVIEW_AGENT_VERSION,
    graphVersion: run.graphVersion || PLAN_REVIEW_GRAPH_VERSION,
    queuedAt: run.queuedAt || null,
    startedAt: run.startedAt || null,
    completedAt: run.completedAt || null,
    failure: run.failure || null,
    approval: run.approval || null,
  };
}

export async function enqueuePlanReviewRun({ userId, profileId, correlationId = null, model = AgentRun, runtimeConfig = getRuntimeConfig() }) {
  const dedupeKey = hashPlanReviewRequest({ userId, profileId });
  const active = await model.findOne({
    userId,
    profileId,
    agentType: 'PLAN_REVIEW',
    status: { $in: ['QUEUED', 'RUNNING', 'WAITING_FOR_APPROVAL'] },
    activeDedupeKey: dedupeKey,
  }).lean();
  if (active) return { created: false, run: publicRun(active) };

  if (typeof model.countDocuments === 'function') {
    const [queuedForUser, activeForUser, globalQueued] = await Promise.all([
      model.countDocuments({ userId, agentType: 'PLAN_REVIEW', status: 'QUEUED' }),
      model.countDocuments({ userId, agentType: 'PLAN_REVIEW', status: 'RUNNING' }),
      model.countDocuments({ agentType: 'PLAN_REVIEW', status: 'QUEUED' }),
    ]);
    if (queuedForUser >= runtimeConfig.agentPlanReview.maxQueuedRunsPerUser
      || activeForUser >= runtimeConfig.agentPlanReview.maxActiveRunsPerUser
      || globalQueued >= runtimeConfig.agentPlanReview.maxGlobalQueuedRuns) {
      const error = new Error('The plan review queue is currently full. Please retry shortly.');
      error.status = 429;
      error.code = 'AGENT_QUEUE_SATURATED';
      error.retryAfterMs = 5000;
      throw error;
    }
  }

  try {
    const created = await model.create({
      runId: crypto.randomUUID(),
      agentType: 'PLAN_REVIEW',
      userId,
      profileId,
      status: 'QUEUED',
      priority: 'INTERACTIVE_PLAN_REVIEW',
      dedupeKey,
      activeDedupeKey: dedupeKey,
      correlationId,
      agentVersion: PLAN_REVIEW_AGENT_VERSION,
      graphVersion: PLAN_REVIEW_GRAPH_VERSION,
      toolCatalogVersion: PLAN_REVIEW_TOOL_CATALOG_VERSION,
      plannerVersion: PLAN_REVIEW_PLANNER_VERSION,
      policyVersion: PLAN_REVIEW_POLICY_VERSION,
      maxAttempts: PLAN_REVIEW_BUDGETS.maxAttempts,
    });
    return { created: true, run: publicRun(created) };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const existing = await model.findOne({ activeDedupeKey: dedupeKey }).lean();
    if (!existing) throw error;
    return { created: false, run: publicRun(existing) };
  }
}

export async function getPlanReviewRun({ userId, runId, model = AgentRun }) {
  const run = await model.findOne({ userId, runId }).lean();
  return publicRun(run);
}

export async function getCurrentPlanReviewRun({ userId, profileId, model = AgentRun }) {
  const run = await model.findOne({ userId, profileId, agentType: 'PLAN_REVIEW' })
    .sort({ queuedAt: -1, createdAt: -1 })
    .lean();
  return publicRun(run);
}

export { isActivePlanReviewState };
