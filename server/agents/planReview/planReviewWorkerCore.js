import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { trace } from '../../config/tracing.js';
import AgentRun from '../../models/AgentRun.js';
import UserIntentMandate from '../../models/UserIntentMandate.js';
import AgentCheckpoint from '../../models/AgentCheckpoint.js';
import FinancialProfile from '../../models/FinancialProfile.js';
import RecommendationState from '../../models/RecommendationState.js';
import { PrometheusMetrics } from '../../services/metricsCollector.js';
import { runPlanReview } from './planReviewService.js';
import { MongoPlanReviewCheckpointer } from './mongoPlanReviewCheckpointer.js';
import { PLAN_REVIEW_BUDGETS, hashPlanReviewSnapshot } from './planReviewRuntime.js';
import { canonicalSha256 } from '../../utils/canonicalJson.js';
import { resolvePlanReviewSnapshot } from './planReviewSnapshot.js';
import { allocateAgentRunEventSequence } from '../../services/agentEventSequence.js';
import { SAFE_PLAN_REVIEW_TOOLS } from './planReviewSchemas.js';
import { reconcileTerminalPlanReviewMandates } from './planReviewApproval.js';
import logger from '../../utils/logger.js';

const NODE_LABELS = Object.freeze({
  load_context: 'Loading your saved plan',
  check_recommendation_freshness: 'Checking recommendation freshness',
  determine_required_checks: 'Selecting safe read-only checks',
  execute_safe_tools: 'Collecting plan evidence',
  validate_evidence: 'Validating evidence',
  synthesize_review: 'Preparing a grounded review',
  validate_agent_output: 'Checking review safety',
  policy_guard: 'Applying safety policy',
  persist_agent_run: 'Saving review result',
});

const tracer = trace.getTracer('wealthgenie-agent-runtime');
let defaultWorker = null;

function now() { return new Date(); }

function checkpointState(state) {
  const boundedCounter = (name, value, max) => {
    const count = value === undefined || value === null ? 0 : Number(value);
    if (!Number.isInteger(count) || count < 0 || count > max) {
      const error = new Error(`PlanReview checkpoint ${name} is outside its hard budget.`);
      error.code = 'AGENT_BUDGET_EXCEEDED';
      error.reason = name.toUpperCase();
      throw error;
    }
    return count;
  };
  const tokenUsage = boundedCounter('tokenUsage', state.tokenUsage, PLAN_REVIEW_BUDGETS.maxTotalTokens);
  const payload = {
    schemaVersion: 'plan-review-replay-checkpoint-1.0.0',
    runId: state.runId,
    planReviewSnapshotHash: state.planReviewSnapshotHash,
    sourceBinding: state.sourceBinding,
    counters: {
      stepCount: boundedCounter('stepCount', state.stepCount, PLAN_REVIEW_BUDGETS.maxSteps),
      toolCallCount: boundedCounter('toolCallCount', state.toolCallCount, PLAN_REVIEW_BUDGETS.maxToolCalls),
      modelCallCount: boundedCounter('modelCallCount', state.modelCallCount, PLAN_REVIEW_BUDGETS.maxModelCalls),
      tokenUsage,
      toolCallCounts: Object.fromEntries(Object.entries(state.toolCallCounts || {})
        .filter(([name, count]) => SAFE_PLAN_REVIEW_TOOLS.includes(name) && Number.isInteger(Number(count)) && Number(count) >= 0)
        .slice(0, SAFE_PLAN_REVIEW_TOOLS.length)
        .map(([name, count]) => {
          const bounded = boundedCounter(`toolCallCounts.${name}`, count, PLAN_REVIEW_BUDGETS.maxToolCallsPerTool);
          return [name, bounded];
        })),
    },
  };
  return { ...payload, checkpointHash: canonicalSha256(payload) };
}

export function reconcilePlanReviewReplayCheckpoint(run) {
  const checkpoint = run?.checkpoint?.state || run?.checkpoint || null;
  if (!checkpoint) return null;
  const payload = {
    schemaVersion: checkpoint.schemaVersion,
    runId: checkpoint.runId,
    planReviewSnapshotHash: checkpoint.planReviewSnapshotHash,
    sourceBinding: checkpoint.sourceBinding,
    counters: checkpoint.counters,
  };
  const valid = checkpoint.schemaVersion === 'plan-review-replay-checkpoint-1.0.0'
    && checkpoint.runId === run.runId
    && checkpoint.planReviewSnapshotHash === run.planReviewSnapshotHash
    && hashPlanReviewSnapshot(checkpoint.sourceBinding) === checkpoint.planReviewSnapshotHash
    && canonicalSha256(payload) === checkpoint.checkpointHash;
  if (!valid) {
    return {
      schemaVersion: 'plan-review-replay-checkpoint-1.0.0',
      runId: run.runId,
      planReviewSnapshotHash: run.planReviewSnapshotHash,
      sourceBinding: run.sourceBinding,
      counters: checkpoint.counters || {},
      checkpointHash: 'INVALID_CHECKPOINT_HASH',
    };
  }
  const counters = {
    ...checkpoint.counters,
    modelCallCount: Math.max(Number(checkpoint.counters?.modelCallCount) || 0, Number(run.modelCallCount) || 0),
    tokenUsage: Math.max(Number(checkpoint.counters?.tokenUsage) || 0, Number(run.tokenUsage) || 0),
  };
  const reconciled = { ...payload, counters };
  return { ...reconciled, checkpointHash: canonicalSha256(reconciled) };
}

function progressFor(node, completedNodes = []) {
  const order = Object.keys(NODE_LABELS);
  const completed = [...new Set(completedNodes)];
  return {
    completedNodes: completed,
    percent: Math.min(100, Math.round((completed.length / order.length) * 100)),
    label: NODE_LABELS[node] || 'Working on your plan review',
  };
}

function addTrajectory(existing, event, node) {
  if (!event?.type) return existing || [];
  return [...(existing || []), {
    type: event.type,
    node,
    tool: event.tool || null,
    code: event.code || null,
    at: event.at || now().toISOString(),
  }].slice(-100);
}

function leaseFilter(run) {
  return { runId: run.runId, workerId: run.workerId, executionGeneration: run.executionGeneration };
}

function staleLeaseError() {
  const error = new Error('The worker lease is no longer valid.');
  error.code = 'AGENT_LEASE_LOST';
  return error;
}

function isModified(result) {
  return Number(result?.modifiedCount ?? result?.nModified ?? 0) > 0;
}

function classifyFailure(error) {
  if (error?.code === 'AGENT_RUN_CANCELLED') return 'CANCELLED';
  if (error?.code === 'PLAN_REVIEW_SOURCE_SUPERSEDED') return 'PLAN_REVIEW_SOURCE_SUPERSEDED';
  if (error?.code === 'AGENT_BUDGET_EXCEEDED') return 'BUDGET_EXCEEDED';
  if (error?.code === 'AGENT_BUDGET_PERSISTENCE_UNAVAILABLE') return 'BUDGET_RESERVATION_UNAVAILABLE';
  if (error?.code === 'PLAN_REVIEW_TIMEOUT' || error?.code === 'TOOL_TIMEOUT') return 'PLAN_REVIEW_TIMEOUT';
  if (error?.code === 'AGENT_LEASE_LOST') return 'STALE_FINALIZATION_REJECTED';
  if (error?.code === 'CHECKPOINT_FAILURE') return 'CHECKPOINT_FAILURE';
  if (error?.code === 'UNKNOWN_TOOL' || error?.code?.startsWith?.('TOOL_')) return 'TOOL_FAILURE';
  if (error?.retryable || error?.code === 'PROVIDER_UNAVAILABLE' || error?.code === 'MODEL_TIMEOUT') return 'PROVIDER_UNAVAILABLE';
  return 'INTERNAL_RUNTIME_FAILURE';
}

export async function claimNextPlanReviewRun({ model = AgentRun, leaseMs = 60000, worker = crypto.randomUUID(), nowValue = now() } = {}) {
  const span = tracer.startSpan('agent.queue.claim', { attributes: { 'agent.type': 'PLAN_REVIEW', 'worker.operation': 'claim' } });
  try {
    const claimed = await model.findOneAndUpdate({
      agentType: 'PLAN_REVIEW',
      $or: [
        { status: 'QUEUED', $or: [{ retryAt: null }, { retryAt: { $lte: nowValue } }] },
        { status: 'RUNNING', leaseUntil: { $lt: nowValue }, attempt: { $lt: PLAN_REVIEW_BUDGETS.maxAttempts } },
      ],
    }, {
      $set: {
        status: 'RUNNING',
        workerId: worker,
        leaseUntil: new Date(nowValue.getTime() + leaseMs),
        lastHeartbeatAt: nowValue,
        startedAt: nowValue,
        currentNode: 'load_context',
        retryAt: null,
      },
      $inc: { attempt: 1, executionGeneration: 1 },
    }, { sort: { priority: 1, queuedAt: 1 }, new: true });
    if (claimed) PrometheusMetrics.setGauge('agent_worker_jobs_active', 1);
    if (claimed?.attempt > 1) PrometheusMetrics.inc('agent_worker_recovered_runs_total');
    span.setAttribute('run.state', claimed ? 'RUNNING' : 'EMPTY');
    return claimed?.lean ? claimed.lean() : claimed;
  } finally {
    span.end();
  }
}

export async function recoverExpiredPlanReviewRuns({ model = AgentRun, nowValue = now() } = {}) {
  const result = await model.updateMany({
    agentType: 'PLAN_REVIEW',
    status: 'RUNNING',
    leaseUntil: { $lt: nowValue },
    attempt: { $gte: PLAN_REVIEW_BUDGETS.maxAttempts },
  }, {
    $set: {
      status: 'FAILED',
      failure: { code: 'INTERNAL_RUNTIME_FAILURE', message: 'Worker lease expired after the maximum retry attempts.' },
      deadLetter: { code: 'INTERNAL_RUNTIME_FAILURE', at: nowValue },
      completedAt: nowValue,
      leaseUntil: null,
      currentNode: null,
    },
    $unset: { activeDedupeKey: 1 },
  });
  return Number(result?.modifiedCount ?? result?.nModified ?? 0);
}

async function updateQueueMetrics(model) {
  if (typeof model.findOne !== 'function') return;
  const oldest = await model.findOne({ agentType: 'PLAN_REVIEW', status: 'QUEUED' }).sort({ queuedAt: 1 }).lean();
  PrometheusMetrics.setGauge('agent_queue_oldest_age_seconds', oldest?.queuedAt
    ? Math.max(0, (Date.now() - new Date(oldest.queuedAt).getTime()) / 1000)
    : 0);
}

class PlanReviewWorker {
  constructor({
    model = AgentRun,
    checkpointModel = AgentCheckpoint,
    eventModel = null,
    mandateModel = UserIntentMandate,
    profileModel = FinancialProfile,
    stateModel = RecommendationState,
    snapshotResolver = resolvePlanReviewSnapshot,
    mongo = mongoose,
    runtimeConfig = null,
    worker = null,
    runPlanReviewImpl = runPlanReview,
  } = {}) {
    this.model = model;
    this.checkpointModel = checkpointModel;
    this.eventModel = eventModel;
    this.mandateModel = mandateModel;
    this.profileModel = profileModel;
    this.stateModel = stateModel;
    this.snapshotResolver = snapshotResolver;
    this.mongo = mongo;
    this.runtimeConfig = runtimeConfig;
    this.runPlanReviewImpl = runPlanReviewImpl;
    this.workerId = worker || `plan-review-worker-${crypto.randomUUID()}`;
    this.leaseMs = runtimeConfig?.agentPlanReview?.leaseMs || 60000;
    this.heartbeatMs = runtimeConfig?.agentPlanReview?.heartbeatMs || Math.floor(this.leaseMs / 4);
    this.timer = null;
    this.heartbeatTimer = null;
    this.mandateReconciliationTimer = null;
    this.activePromise = null;
    this.activeRun = null;
    this.activeAbortController = null;
    this.draining = false;
    this.leaseLost = false;
  }

  state() {
    return {
      running: Boolean(this.timer),
      draining: this.draining,
      ready: Boolean(this.timer) && !this.draining,
      activeJobs: this.activePromise ? 1 : 0,
    };
  }

  async assertLease(run = this.activeRun) {
    if (!run || this.leaseLost) throw staleLeaseError();
    const current = await this.model.findOne({ ...leaseFilter(run), status: 'RUNNING', leaseUntil: { $gt: now() } }).lean();
    if (!current) {
      this.leaseLost = true;
      PrometheusMetrics.inc('agent_worker_stale_write_rejections_total');
      throw staleLeaseError();
    }
    return current;
  }

  async heartbeat() {
    if (!this.activeRun || this.leaseLost) return false;
    const span = tracer.startSpan('agent.queue.heartbeat', { attributes: { 'agent.type': 'PLAN_REVIEW', 'worker.operation': 'heartbeat' } });
    try {
      const result = await this.model.updateOne({
        ...leaseFilter(this.activeRun),
        status: 'RUNNING',
        cancellationRequested: { $ne: true },
        leaseUntil: { $gt: now() },
      }, {
        $set: { lastHeartbeatAt: now(), leaseUntil: new Date(Date.now() + this.leaseMs) },
      });
      if (!isModified(result)) {
        this.leaseLost = true;
        this.activeAbortController?.abort(staleLeaseError());
        PrometheusMetrics.inc('agent_worker_lease_conflicts_total');
        PrometheusMetrics.inc('agent_worker_stale_write_rejections_total');
        span.setAttribute('run.state', 'LEASE_LOST');
        return false;
      }
      span.setAttribute('run.state', 'RUNNING');
      return true;
    } finally {
      span.end();
    }
  }

  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => { void this.heartbeat().catch(() => { this.leaseLost = true; }); }, this.heartbeatMs);
    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  async updateProgress(run, payload) {
    await this.assertLease(run);
    const current = await this.model.findOne(leaseFilter(run)).lean();
    if (current?.cancellationRequested) {
      const error = new Error('AGENT_RUN_CANCELLED');
      error.code = 'AGENT_RUN_CANCELLED';
      throw error;
    }
    const completedNodes = [...new Set([...(current?.progress?.completedNodes || []), ...(payload.node && payload.event?.type !== 'TOOL_FAILED' ? [payload.node] : [])])];
    const sequence = Number(current?.checkpointSequence || 0) + 1;
    const safeState = checkpointState(payload.state || {});
    await this.checkpointModel.findOneAndUpdate(
      { runId: run.runId, userId: run.userId, executionGeneration: run.executionGeneration, sequence },
      {
        $setOnInsert: { runId: run.runId, userId: run.userId, executionGeneration: run.executionGeneration, sequence, createdAt: now() },
        $set: { workerId: run.workerId, node: payload.node || 'unknown', state: safeState },
      },
      { upsert: true, new: true },
    );
    PrometheusMetrics.inc('agent_checkpoint_writes_total');
    const set = {
      currentNode: payload.node || null,
      lastHeartbeatAt: now(),
      leaseUntil: new Date(Date.now() + this.leaseMs),
      checkpoint: { state: safeState },
      checkpointSequence: sequence,
      progress: progressFor(payload.node, completedNodes),
    };
    if (payload.event) set.trajectory = addTrajectory(current?.trajectory, payload.event, payload.node);
    if (payload.event?.type === 'TOOL_SUCCEEDED' || payload.event?.type === 'TOOL_FAILED') {
      const ledger = {
        sequence,
        tool: payload.event.tool || null,
        success: payload.event.type === 'TOOL_SUCCEEDED',
        code: payload.event.code || null,
        inputHash: null,
        outputHash: null,
        startedAt: payload.event.at || now().toISOString(),
        completedAt: now().toISOString(),
      };
      set.toolExecutionLedger = [...(current?.toolExecutionLedger || []), ledger].slice(-50);
    }
    const result = await this.model.updateOne({ ...leaseFilter(run), status: 'RUNNING' }, { $set: set });
    if (!isModified(result)) {
      PrometheusMetrics.inc('agent_worker_stale_write_rejections_total');
      throw staleLeaseError();
    }
    await this.appendEvent(run, sequence, payload.event, payload.node);
  }

  async persistModelBudgetReservation(run, usage) {
    if (!Number.isInteger(usage?.modelCallCount)
        || usage.modelCallCount < 0
        || usage.modelCallCount > PLAN_REVIEW_BUDGETS.maxModelCalls
        || !Number.isInteger(usage?.tokenUsage)
        || usage.tokenUsage < 0
        || usage.tokenUsage > PLAN_REVIEW_BUDGETS.maxTotalTokens) {
      const error = new Error('PlanReview model budget reservation is invalid.');
      error.code = 'AGENT_BUDGET_EXCEEDED';
      throw error;
    }
    let result;
    try {
      result = await this.model.updateOne({
        ...leaseFilter(run),
        status: 'RUNNING',
        leaseUntil: { $gt: now() },
      }, {
        $max: {
          modelCallCount: usage.modelCallCount,
          tokenUsage: usage.tokenUsage,
        },
        $set: { lastHeartbeatAt: now(), leaseUntil: new Date(Date.now() + this.leaseMs) },
      });
    } catch (cause) {
      const error = new Error('Unable to durably reserve the PlanReview provider budget.');
      error.code = 'AGENT_BUDGET_PERSISTENCE_UNAVAILABLE';
      error.cause = cause;
      throw error;
    }
    if (!isModified(result)) throw staleLeaseError();
  }

  async appendEvent(run, sequence, event, node = null) {
    if (!this.eventModel?.create || !event?.type) return;
    try {
      const eventSequence = await allocateAgentRunEventSequence({
        runModel: this.model,
        eventModel: this.eventModel,
        runId: run.runId,
        userId: run.userId,
        executionGeneration: run.executionGeneration,
      }) || sequence;
      await this.eventModel.create({
        runId: run.runId,
        userId: run.userId,
        executionGeneration: run.executionGeneration,
        sequence: eventSequence,
        eventType: event.type,
        node: node || null,
        data: {
          type: event.type,
          node: node || null,
          tool: event.tool || null,
          code: event.code || null,
          at: event.at || now().toISOString(),
        },
      });
    } catch (error) {
      // Event streaming is a progress surface. A transient event write must
      // never change the authoritative AgentRun result or financial outcome.
      if (error?.code !== 11000) PrometheusMetrics.inc('agent_event_persistence_failures_total');
    }
  }

  async finishRun(run, review) {
    const current = await this.assertLease(run);
    if (!run.sourceBinding || hashPlanReviewSnapshot(run.sourceBinding) !== run.planReviewSnapshotHash) {
      const error = new Error('The queued PlanReview source binding failed integrity verification.');
      error.code = 'PLAN_REVIEW_SOURCE_BINDING_INVALID';
      throw error;
    }
    const result = review || null;
    const status = result?.recommendedAction === 'RECOMPUTE_PLAN' ? 'WAITING_FOR_APPROVAL' : 'COMPLETED';
    const exactCounter = (name, value, max) => {
      const count = value === undefined || value === null ? 0 : Number(value);
      if (!Number.isInteger(count) || count < 0 || count > max) {
        const error = new Error(`PlanReview ${name} exceeded its hard execution budget.`);
        error.code = 'AGENT_BUDGET_EXCEEDED';
        error.reason = name.toUpperCase();
        throw error;
      }
      return count;
    };
    const terminalEvent = status === 'COMPLETED' ? 'RUN_COMPLETED' : 'RUN_WAITING_FOR_APPROVAL';
    const update = {
      $set: {
        status,
        result,
        recommendedAction: result?.recommendedAction || 'INSUFFICIENT_EVIDENCE',
        findingCodes: (result?.findings || []).map(item => item.code),
        evidenceIds: (result?.evidence?.entries || []).map(item => item.id).filter(Boolean),
        provider: result?.provider?.name || 'DETERMINISTIC_FALLBACK',
        model: result?.provider?.model || null,
        stepCount: exactCounter('stepCount', result?.execution?.stepCount, PLAN_REVIEW_BUDGETS.maxSteps),
        toolCallCount: exactCounter('toolCallCount', result?.execution?.toolCallCount, PLAN_REVIEW_BUDGETS.maxToolCalls),
        modelCallCount: exactCounter('modelCallCount', result?.execution?.modelCallCount, PLAN_REVIEW_BUDGETS.maxModelCalls),
        tokenUsage: exactCounter('tokenUsage', result?.execution?.tokenUsage, PLAN_REVIEW_BUDGETS.maxTotalTokens),
        completedAt: now(),
        leaseUntil: null,
        currentNode: null,
        progress: { completedNodes: Object.keys(NODE_LABELS), percent: 100, label: 'Review ready' },
      },
      $push: { trajectory: { $each: [{ type: terminalEvent, at: now().toISOString() }], $slice: -100 } },
    };
    if (status === 'COMPLETED') update.$unset = { activeDedupeKey: 1 };
    const terminalSequence = Number(current?.eventSequence || 0) + 1;
    const eventSequenceFence = current?.eventSequence === undefined
      ? { $or: [{ eventSequence: { $exists: false } }, { eventSequence: 0 }] }
      : { eventSequence: current.eventSequence };
    if (this.eventModel?.create) update.$inc = { eventSequence: 1 };
    let committed = false;
    const session = await this.mongo.startSession();
    try {
      if (typeof session.withTransaction !== 'function') {
        const error = new Error('PlanReview publication requires transaction-capable MongoDB.');
        error.code = 'TRANSACTION_REQUIRED';
        throw error;
      }
      await session.withTransaction(async () => {
        const snapshot = await this.snapshotResolver({
          userId: run.userId,
          profileId: run.profileId,
          profileModel: this.profileModel,
          session,
          dependencies: { stateModel: this.stateModel },
        });
        if (snapshot.planReviewSnapshotHash !== run.planReviewSnapshotHash) {
          const error = new Error('Financial source state changed while the PlanReview was running.');
          error.code = 'PLAN_REVIEW_SOURCE_SUPERSEDED';
          throw error;
        }

        const profileWrite = await this.profileModel.updateOne({
          _id: run.profileId,
          userId: run.userId,
          version: snapshot.sourceBinding.profileVersion,
        }, { $inc: { planReviewPublicationFence: 1 } }, { session });
        if (!isModified(profileWrite)) {
          const error = new Error('Profile changed before PlanReview publication.');
          error.code = 'PLAN_REVIEW_SOURCE_SUPERSEDED';
          throw error;
        }

        const pointer = snapshot.currentState?.statePointer;
        if (pointer) {
          const stateWrite = await this.stateModel.updateOne({
            _id: pointer._id,
            userId: run.userId,
            profileId: run.profileId,
            currentRecommendationId: pointer.currentRecommendationId,
            currentAllocationRevision: pointer.currentAllocationRevision,
            currentAllocationRevisionId: pointer.currentAllocationRevisionId,
            generationRevision: pointer.generationRevision,
            profileInputHash: pointer.profileInputHash,
            profileVersion: pointer.profileVersion,
            portfolioFingerprint: pointer.portfolioFingerprint,
            returnAssumptionVersion: pointer.returnAssumptionVersion,
            returnAssumptionHash: pointer.returnAssumptionHash,
            returnAssumptionSource: pointer.returnAssumptionSource,
          }, { $inc: { planReviewPublicationFence: 1 } }, { session });
          if (!isModified(stateWrite)) {
            const error = new Error('Canonical recommendation state changed before PlanReview publication.');
            error.code = 'PLAN_REVIEW_SOURCE_SUPERSEDED';
            throw error;
          }
        }

        const written = await this.model.updateOne({
          ...leaseFilter(run),
          status: 'RUNNING',
          cancellationRequested: { $ne: true },
          ...eventSequenceFence,
          planReviewSnapshotHash: run.planReviewSnapshotHash,
          leaseUntil: { $gt: now() },
        }, update, { session });
        if (!isModified(written)) {
          PrometheusMetrics.inc('agent_worker_stale_write_rejections_total');
          throw staleLeaseError();
        }
        if (this.eventModel?.create) {
          await this.eventModel.create([{
            runId: run.runId,
            userId: run.userId,
            executionGeneration: run.executionGeneration,
            sequence: terminalSequence,
            eventType: terminalEvent,
            node: 'persist_agent_run',
            data: { type: terminalEvent, node: 'persist_agent_run', at: now().toISOString() },
          }], { session });
        }
      });
      committed = true;
    } finally {
      await session.endSession();
    }
    if (!committed) return { committed: false, status: null };
    if (status === 'COMPLETED') PrometheusMetrics.recordAgentRun('completed');
    return { committed: true, status, runId: run.runId };
  }

  async failRun(run, error) {
    if (error?.code === 'AGENT_LEASE_LOST') return;
    const terminal = Number(run.attempt || 0) >= Number(run.maxAttempts || PLAN_REVIEW_BUDGETS.maxAttempts);
    const cancelled = error?.code === 'AGENT_RUN_CANCELLED';
    const budgetExceeded = error?.code === 'AGENT_BUDGET_EXCEEDED';
    const superseded = error?.code === 'PLAN_REVIEW_SOURCE_SUPERSEDED';
    const classification = classifyFailure(error);
    const update = {
      $set: {
        status: superseded ? 'SUPERSEDED' : (cancelled ? 'CANCELLED' : (budgetExceeded ? 'BUDGET_EXCEEDED' : (terminal ? 'FAILED' : 'QUEUED'))),
        retryAt: terminal || cancelled || budgetExceeded || superseded ? null : new Date(Date.now() + Math.min(30000, 1000 * (2 ** Math.max(0, Number(run.attempt || 1) - 1)))),
        failure: { code: classification, message: String(error?.message || 'Agent run failed').slice(0, 240) },
        deadLetter: terminal && !cancelled && !budgetExceeded && !superseded
          ? { code: classification, at: now() }
          : null,
        leaseUntil: null,
        completedAt: terminal || cancelled || budgetExceeded || superseded ? now() : null,
        currentNode: terminal || cancelled || budgetExceeded || superseded ? null : run.currentNode,
      },
    };
    const measuredUsage = error?.planReviewUsage;
    if (Number.isInteger(measuredUsage?.modelCallCount)
        && measuredUsage.modelCallCount >= 0
        && measuredUsage.modelCallCount <= PLAN_REVIEW_BUDGETS.maxModelCalls) {
      update.$max = { ...(update.$max || {}), modelCallCount: measuredUsage.modelCallCount };
    }
    if (Number.isInteger(measuredUsage?.tokenUsage)
        && measuredUsage.tokenUsage >= 0
        && measuredUsage.tokenUsage <= PLAN_REVIEW_BUDGETS.maxTotalTokens) {
      update.$max = { ...(update.$max || {}), tokenUsage: measuredUsage.tokenUsage };
    }
    if (terminal || cancelled || budgetExceeded || superseded) update.$unset = { activeDedupeKey: 1 };
    const written = await this.model.updateOne({ ...leaseFilter(run), status: 'RUNNING' }, update);
    if (!isModified(written)) {
      PrometheusMetrics.inc('agent_worker_stale_write_rejections_total');
      throw staleLeaseError();
    }
    if (cancelled) PrometheusMetrics.inc('agent_cancellation_total');
    if (budgetExceeded) PrometheusMetrics.inc('agent_budget_exceeded_total');
    await this.appendEvent(run, Number(run.checkpointSequence || 0) + 1, {
      type: superseded ? 'RUN_SUPERSEDED' : (cancelled ? 'RUN_CANCELLED' : 'RUN_FAILED'),
      code: classification,
      at: now().toISOString(),
    }, run.currentNode);
    return {
      persisted: true,
      status: update.$set.status,
      terminal: terminal || cancelled || budgetExceeded || superseded,
    };
  }

  async processNext() {
    if (this.draining || this.activePromise || this.runtimeConfig?.agenticPlanReviewEnabled === false) return false;
    await updateQueueMetrics(this.model);
    const run = await claimNextPlanReviewRun({ model: this.model, worker: this.workerId, leaseMs: this.leaseMs });
    if (!run) return false;
    this.activeRun = run;
    this.leaseLost = false;
    this.activeAbortController = new AbortController();
    this.startHeartbeat();
    const span = tracer.startSpan('agent.worker.execute', { attributes: { 'agent.type': 'PLAN_REVIEW', attempt: run.attempt || 0, 'queue.priority': run.priority || 'INTERACTIVE_PLAN_REVIEW' } });
    this.activePromise = (async () => {
      try {
        const review = await this.runPlanReviewImpl({
          userId: run.userId,
          profileId: run.profileId,
          runId: run.runId,
          executionGeneration: run.executionGeneration,
          expectedPlanReviewSnapshotHash: run.planReviewSnapshotHash,
          resumeCheckpoint: reconcilePlanReviewReplayCheckpoint(run),
          correlationId: run.correlationId,
          returnInternalResult: true,
          runtimeConfig: this.runtimeConfig,
          dependencies: {
            signal: this.activeAbortController.signal,
            checkpointer: new MongoPlanReviewCheckpointer({ runId: run.runId, userId: run.userId, workerId: run.workerId, executionGeneration: run.executionGeneration, assertLease: () => this.assertLease(run) }),
            onNodeProgress: payload => this.updateProgress(run, payload),
            onModelBudgetReservation: usage => this.persistModelBudgetReservation(run, usage),
            // The queue owns AgentRun finalization. Keeping this graph callback
            // side-effect free lets the final LangGraph checkpoint be written
            // while the lease is still RUNNING; finishRun then applies the
            // fenced terminal transition exactly once.
            persistAgentRun: async () => undefined,
          },
        });
        const latest = await this.model.findOne({ ...leaseFilter(run) }).lean();
        if (latest?.status !== 'RUNNING') {
          PrometheusMetrics.inc('agent_worker_stale_write_rejections_total');
          span.setAttribute('run.state', latest?.status || 'STALE_FINALIZATION_REJECTED');
        } else {
          const finalization = await this.finishRun(run, review);
          if (finalization?.committed && finalization.status === 'COMPLETED') {
            PrometheusMetrics.inc('agent_worker_jobs_completed_total');
            PrometheusMetrics.inc('agent_queue_runs_completed_total');
            span.setAttribute('run.state', 'COMPLETED');
          } else if (finalization?.committed && finalization.status === 'WAITING_FOR_APPROVAL') {
            PrometheusMetrics.inc('agent_worker_jobs_waiting_for_approval_total');
            span.setAttribute('run.state', 'WAITING_FOR_APPROVAL');
          } else {
            PrometheusMetrics.inc('agent_worker_stale_write_rejections_total');
            span.setAttribute('run.state', 'STALE_FINALIZATION_REJECTED');
          }
        }
      } catch (error) {
        const failureResult = await this.failRun(run, error).catch(failureError => {
          if (failureError?.code !== 'AGENT_LEASE_LOST') throw failureError;
          return null;
        });
        if (failureResult?.persisted) {
          if (error?.code === 'PLAN_REVIEW_TIMEOUT' || error?.code === 'TOOL_TIMEOUT') {
            PrometheusMetrics.inc('agent_worker_jobs_timed_out_total');
          }
          if (failureResult.status === 'FAILED') {
            PrometheusMetrics.inc('agent_worker_jobs_failed_total');
            PrometheusMetrics.inc('agent_queue_runs_failed_total');
            PrometheusMetrics.recordAgentRun('failed');
          } else if (failureResult.status === 'CANCELLED') {
            PrometheusMetrics.inc('agent_worker_jobs_cancelled_total');
          } else if (failureResult.status === 'SUPERSEDED') {
            PrometheusMetrics.inc('agent_worker_jobs_superseded_total');
          } else if (failureResult.status === 'BUDGET_EXCEEDED') {
            PrometheusMetrics.inc('agent_worker_jobs_budget_exceeded_total');
          }
        }
        span.setAttribute('run.state', failureResult?.status || classifyFailure(error));
      } finally {
        PrometheusMetrics.setGauge('agent_worker_jobs_active', 0);
        this.stopHeartbeat();
        this.activeRun = null;
        this.activeAbortController = null;
        this.leaseLost = false;
        this.activePromise = null;
        span.end();
      }
    })();
    await this.activePromise;
    return true;
  }

  start({ intervalMs = 500 } = {}) {
    if (this.timer) return this;
    this.draining = false;
    this.timer = setInterval(() => { void this.processNext().catch(() => {}); }, intervalMs);
    this.timer.unref?.();
    void reconcileTerminalPlanReviewMandates({ runModel: this.model, mandateModel: this.mandateModel }).catch(error => {
      PrometheusMetrics.inc('agent_mandate_reconciliation_failures_total');
      logger.warn('PlanReview mandate reconciliation sweep failed', { code: error.code || 'MANDATE_RECONCILIATION_FAILED' });
    });
    this.mandateReconciliationTimer = setInterval(() => {
      void reconcileTerminalPlanReviewMandates({ runModel: this.model, mandateModel: this.mandateModel }).catch(error => {
        PrometheusMetrics.inc('agent_mandate_reconciliation_failures_total');
        logger.warn('PlanReview mandate reconciliation sweep failed', { code: error.code || 'MANDATE_RECONCILIATION_FAILED' });
      });
    }, 30000);
    this.mandateReconciliationTimer.unref?.();
    void recoverExpiredPlanReviewRuns({ model: this.model }).catch(() => {});
    void this.processNext().catch(() => {});
    return this;
  }

  async stop({ graceMs = this.runtimeConfig?.agentPlanReview?.shutdownGraceMs || 10000 } = {}) {
    this.draining = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.mandateReconciliationTimer) clearInterval(this.mandateReconciliationTimer);
    this.mandateReconciliationTimer = null;
    if (this.activePromise) {
      await Promise.race([
        this.activePromise,
        new Promise(resolve => { const timer = setTimeout(resolve, graceMs); timer.unref?.(); }),
      ]);
    }
    if (!this.activePromise) this.stopHeartbeat();
  }
}

export function createPlanReviewWorker(options = {}) { return new PlanReviewWorker(options); }

export async function processNextPlanReviewRun(options = {}) {
  const worker = createPlanReviewWorker(options);
  return worker.processNext();
}

export function startPlanReviewWorker({ intervalMs = 500, runtimeConfig, ...options } = {}) {
  if (!defaultWorker) defaultWorker = createPlanReviewWorker({ runtimeConfig, ...options });
  defaultWorker.start({ intervalMs });
  return defaultWorker;
}

export async function stopPlanReviewWorker(options = {}) {
  if (!defaultWorker) return;
  await defaultWorker.stop(options);
  defaultWorker = null;
}

export function getPlanReviewWorkerState() {
  return defaultWorker?.state() || { running: false, draining: false, ready: false, activeJobs: 0 };
}
