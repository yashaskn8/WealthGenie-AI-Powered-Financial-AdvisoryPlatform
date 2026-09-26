import crypto from 'node:crypto';
import AgentRun from '../../models/AgentRun.js';
import FinancialProfile from '../../models/FinancialProfile.js';
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
import { resolvePlanReviewSnapshot } from './planReviewSnapshot.js';
import { createModelGateway } from '../modelGateway.js';
import { createResearchMeshClient } from '../research/researchMeshClient.js';

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

export async function persistPlanReviewRun({ review, userId, profileId, recommendationId, planReviewSnapshotHash, sourceBinding, traceId, correlationId, startedAt, completedAt, _planner, stepCount, toolCallCount, modelCallCount, tokenUsage, model = AgentRun }) {
  const document = await model.create({
    runId: review.runId,
    agentType: 'PLAN_REVIEW',
    userId,
    profileId: review.recommendedAction === 'REVIEW_PROFILE' ? null : profileId,
    recommendationId: recommendationId || null,
    planReviewSnapshotHash,
    sourceBinding,
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
    modelCallCount: Math.min(2, Number(modelCallCount) || 0),
    tokenUsage: Math.min(PLAN_REVIEW_BUDGETS.maxTotalTokens, Number(tokenUsage) || 0),
    result: publicReview(review),
    startedAt: new Date(startedAt),
    completedAt,
  });
  return document;
}

export async function runPlanReview({ userId, profileId, runId = null, executionGeneration = 1, expectedPlanReviewSnapshotHash = null, resumeCheckpoint = null, correlationId = null, traceId = null, returnInternalResult = false, runtimeConfig = getRuntimeConfig(), dependencies = {} }) {
  const researchConfig = runtimeConfig.researchMesh || {};
  const researchEnabled = Boolean(researchConfig.a2aV1Enabled && researchConfig.adaptiveResearchEnabled);
  let researchMeshClient = dependencies.researchMeshClient || null;
  let researchClientInitError = null;
  if (researchEnabled && !researchMeshClient) {
    try {
      researchMeshClient = createResearchMeshClient({ env: dependencies.researchEnv || process.env, fetchImpl: dependencies.fetchImpl || globalThis.fetch });
    } catch (error) {
      researchClientInitError = error.code || 'RESEARCH_AGENT_CONFIGURATION_INVALID';
    }
  }
  const result = await invokePlanReviewGraph({
    userId,
    profileId,
    runId,
    executionGeneration,
    expectedPlanReviewSnapshotHash,
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
      researchAdaptiveEnabled: researchEnabled,
      researchDeepEnabled: Boolean(researchConfig.deepResearchEnabled),
      researchMeshClient,
      researchClientInitError,
      researchBudget: researchConfig.budgets,
      ...dependencies,
    },
  });
  return returnInternalResult ? result.review : publicReview(result.review);
}

function publicRun(run, { currentStateMatch = null } = {}) {
  if (!run) return null;
  return {
    runId: run.runId,
    status: run.status,
    profileId: run.profileId ? String(run.profileId) : null,
    recommendationId: run.recommendationId ? String(run.recommendationId) : null,
    planReviewSnapshotHash: run.planReviewSnapshotHash || null,
    currentStateMatch,
    recommendedAction: run.recommendedAction,
    result: run.result || null,
    progress: run.progress || { completedNodes: [], percent: 0, label: null },
    currentNode: run.currentNode || null,
    attempt: run.attempt || 0,
    maxAttempts: run.maxAttempts || PLAN_REVIEW_BUDGETS.maxAttempts,
    tokenUsage: run.tokenUsage || 0,
    agentVersion: run.agentVersion || PLAN_REVIEW_AGENT_VERSION,
    graphVersion: run.graphVersion || PLAN_REVIEW_GRAPH_VERSION,
    queuedAt: run.queuedAt || null,
    startedAt: run.startedAt || null,
    completedAt: run.completedAt || null,
    failure: run.failure || null,
    approval: run.approval || null,
  };
}

export async function enqueuePlanReviewRun({
  userId,
  profileId,
  correlationId = null,
  model = AgentRun,
  profileModel = FinancialProfile,
  snapshotResolver = resolvePlanReviewSnapshot,
  snapshotDependencies = {},
  runtimeConfig = getRuntimeConfig(),
}) {
  const snapshot = await snapshotResolver({ userId, profileId, profileModel, dependencies: snapshotDependencies });
  const { sourceBinding, planReviewSnapshotHash } = snapshot;
  const dedupeKey = hashPlanReviewRequest({ userId, profileId, planReviewSnapshotHash });

  // A newer source snapshot gets a separate active identity. Retire prior
  // active work without deleting its historical result or checkpoint trail.
  await model.updateMany?.({
    userId,
    profileId,
    agentType: 'PLAN_REVIEW',
    status: { $in: ['QUEUED', 'RUNNING', 'WAITING_FOR_APPROVAL'] },
    planReviewSnapshotHash: { $ne: planReviewSnapshotHash },
  }, {
    $set: {
      status: 'SUPERSEDED',
      completedAt: new Date(),
      leaseUntil: null,
      failure: { code: 'PLAN_REVIEW_SOURCE_SUPERSEDED', message: 'Financial source state changed before this review completed.' },
    },
    $unset: { activeDedupeKey: 1 },
  });

  const active = await model.findOne({
    userId,
    profileId,
    agentType: 'PLAN_REVIEW',
    status: { $in: ['QUEUED', 'RUNNING', 'WAITING_FOR_APPROVAL'] },
    activeDedupeKey: dedupeKey,
  }).lean();
  if (active) return { created: false, run: publicRun(active, { currentStateMatch: true }) };

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
      recommendationId: sourceBinding.recommendationId,
      planReviewSnapshotHash,
      sourceBinding,
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
    return { created: true, run: publicRun(created, { currentStateMatch: true }) };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const existing = await model.findOne({ activeDedupeKey: dedupeKey, planReviewSnapshotHash }).lean();
    if (!existing) throw error;
    return { created: false, run: publicRun(existing, { currentStateMatch: true }) };
  }
}

async function currentSnapshotHash({ userId, profileId, profileModel, snapshotResolver, snapshotDependencies }) {
  const snapshot = await snapshotResolver({ userId, profileId, profileModel, dependencies: snapshotDependencies });
  return snapshot.planReviewSnapshotHash;
}

export async function getPlanReviewRun({
  userId,
  runId,
  model = AgentRun,
  profileModel = FinancialProfile,
  snapshotResolver = resolvePlanReviewSnapshot,
  snapshotDependencies = {},
}) {
  const run = await model.findOne({ userId, runId }).lean();
  if (!run) return null;
  const activeStatus = ['QUEUED', 'RUNNING', 'WAITING_FOR_APPROVAL'].includes(run.status);
  let match = false;
  if (run.profileId && run.planReviewSnapshotHash) {
    const currentHash = await currentSnapshotHash({ userId, profileId: run.profileId, profileModel, snapshotResolver, snapshotDependencies });
    match = currentHash === run.planReviewSnapshotHash;
  }
  if (!match && activeStatus) {
    await model.updateOne({ userId, runId, status: run.status, planReviewSnapshotHash: run.planReviewSnapshotHash }, {
      $set: {
        status: 'SUPERSEDED',
        completedAt: new Date(),
        leaseUntil: null,
        failure: { code: 'PLAN_REVIEW_SOURCE_SUPERSEDED', message: 'Financial source state changed before this review completed.' },
      },
      $unset: { activeDedupeKey: 1 },
    });
    run.status = 'SUPERSEDED';
  }
  return publicRun(run, { currentStateMatch: match });
}

export async function getCurrentPlanReviewRun({
  userId,
  profileId,
  model = AgentRun,
  profileModel = FinancialProfile,
  snapshotResolver = resolvePlanReviewSnapshot,
  snapshotDependencies = {},
}) {
  const planReviewSnapshotHash = await currentSnapshotHash({ userId, profileId, profileModel, snapshotResolver, snapshotDependencies });
  const run = await model.findOne({ userId, profileId, agentType: 'PLAN_REVIEW', planReviewSnapshotHash })
    .sort({ queuedAt: -1, createdAt: -1 })
    .lean();
  return publicRun(run, { currentStateMatch: Boolean(run) });
}

export { isActivePlanReviewState };
