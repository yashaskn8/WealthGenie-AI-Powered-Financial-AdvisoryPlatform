import AgentRun from '../../models/AgentRun.js';
import { ProviderManager } from '../../services/providerAbstraction.js';
import { getRuntimeConfig } from '../../config/runtime.js';
import { invokePlanReviewGraph } from './planReviewGraph.js';
import { PLAN_REVIEW_POLICY_VERSION, PLAN_REVIEW_PLANNER_VERSION } from './planReviewSchemas.js';

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

export async function runPlanReview({ userId, profileId, correlationId = null, traceId = null, runtimeConfig = getRuntimeConfig(), dependencies = {} }) {
  const result = await invokePlanReviewGraph({
    userId,
    profileId,
    correlationId,
    traceId,
    dependencies: {
      timeoutMs: runtimeConfig.agentPlanReview.timeoutMs,
      maxSteps: runtimeConfig.agentPlanReview.maxSteps,
      maxToolCalls: runtimeConfig.agentPlanReview.maxToolCalls,
      maxToolCallsPerTool: runtimeConfig.agentPlanReview.maxToolCallsPerTool,
      toolTimeoutMs: Math.min(5000, runtimeConfig.agentPlanReview.timeoutMs),
      plannerProvider: process.env.AGENT_USE_MODEL_PLANNER === 'true' ? primaryProvider() : null,
      persistAgentRun: payload => persistPlanReviewRun(payload),
      ...dependencies,
    },
  });
  return publicReview(result.review);
}

export async function getPlanReviewRun({ userId, runId, model = AgentRun }) {
  return model.findOne({ userId, runId }).lean();
}
