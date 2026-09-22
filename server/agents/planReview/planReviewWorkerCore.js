import crypto from 'node:crypto';
import { trace } from '../../config/tracing.js';
import AgentRun from '../../models/AgentRun.js';
import AgentCheckpoint from '../../models/AgentCheckpoint.js';
import { PrometheusMetrics } from '../../services/metricsCollector.js';
import { runPlanReview } from './planReviewService.js';
import { MongoPlanReviewCheckpointer } from './mongoPlanReviewCheckpointer.js';
import { PLAN_REVIEW_BUDGETS } from './planReviewRuntime.js';
import { allocateAgentRunEventSequence } from '../../services/agentEventSequence.js';

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

function bounded(value, limit = 100) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.slice(0, limit);
  if (Array.isArray(value)) return value.slice(0, limit).map(item => bounded(item, limit));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, limit).map(([key, item]) => [key, bounded(item, limit)]));
  return value;
}

function checkpointState(state) {
  return bounded({
    runId: state.runId,
    profile: state.profile,
    profileContext: state.profileContext,
    recommendationSummary: state.recommendationSummary,
    freshness: state.freshness,
    requestedChecks: state.requestedChecks,
    toolResults: state.toolResults,
    toolCallCounts: state.toolCallCounts,
    toolCallCount: state.toolCallCount,
    stepCount: state.stepCount,
    repeatedRequests: state.repeatedRequests,
    evidencePacket: state.evidencePacket,
    goalSummary: state.goalSummary,
    planner: state.planner,
    review: state.review,
    explanation: state.explanation ? {
      provider: state.explanation.provider,
      model: state.explanation.model,
      fallback: state.explanation.fallback,
      evidenceIdsUsed: state.explanation.evidenceIdsUsed,
      claims: state.explanation.claims,
      unavailableFacts: state.explanation.unavailableFacts,
      text: state.explanation.text,
    } : null,
    validation: state.validation,
    evidenceVerification: state.evidenceVerification,
    policy: state.policy,
    contextReady: Boolean(state.profileContext),
  }, 120);
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
  if (error?.code === 'AGENT_BUDGET_EXCEEDED') return 'BUDGET_EXCEEDED';
  if (error?.code === 'AGENT_LEASE_LOST') return 'INTERNAL_RUNTIME_FAILURE';
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
  constructor({ model = AgentRun, checkpointModel = AgentCheckpoint, eventModel = null, runtimeConfig = null, worker = null } = {}) {
    this.model = model;
    this.checkpointModel = checkpointModel;
    this.eventModel = eventModel;
    this.runtimeConfig = runtimeConfig;
    this.workerId = worker || `plan-review-worker-${crypto.randomUUID()}`;
    this.leaseMs = runtimeConfig?.agentPlanReview?.leaseMs || 60000;
    this.heartbeatMs = runtimeConfig?.agentPlanReview?.heartbeatMs || Math.floor(this.leaseMs / 4);
    this.timer = null;
    this.heartbeatTimer = null;
    this.activePromise = null;
    this.activeRun = null;
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
      const result = await this.model.updateOne({ ...leaseFilter(this.activeRun), status: 'RUNNING', leaseUntil: { $gt: now() } }, {
        $set: { lastHeartbeatAt: now(), leaseUntil: new Date(Date.now() + this.leaseMs) },
      });
      if (!isModified(result)) {
        this.leaseLost = true;
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
      { runId: run.runId, sequence },
      { $set: { runId: run.runId, userId: run.userId, executionGeneration: run.executionGeneration, workerId: run.workerId, sequence, node: payload.node || 'unknown', state: safeState } },
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
    const result = review || null;
    const status = result?.recommendedAction === 'RECOMPUTE_PLAN' ? 'WAITING_FOR_APPROVAL' : 'COMPLETED';
    const update = {
      $set: {
        status,
        result,
        recommendedAction: result?.recommendedAction || 'INSUFFICIENT_EVIDENCE',
        findingCodes: (result?.findings || []).map(item => item.code),
        evidenceIds: (result?.evidence?.entries || []).map(item => item.id).filter(Boolean),
        provider: result?.provider?.name || 'DETERMINISTIC_FALLBACK',
        model: result?.provider?.model || null,
        stepCount: result?.execution?.stepCount || 0,
        toolCallCount: result?.execution?.toolCallCount || 0,
        completedAt: now(),
        leaseUntil: null,
        currentNode: null,
        progress: { completedNodes: Object.keys(NODE_LABELS), percent: 100, label: 'Review ready' },
      },
      $push: { trajectory: { $each: [{ type: 'RUN_COMPLETED', at: now().toISOString() }], $slice: -100 } },
    };
    if (status === 'COMPLETED') update.$unset = { activeDedupeKey: 1 };
    const written = await this.model.updateOne({ ...leaseFilter(run), status: 'RUNNING' }, update);
    if (!isModified(written)) {
      PrometheusMetrics.inc('agent_worker_stale_write_rejections_total');
      throw staleLeaseError();
    }
    await this.appendEvent(run, Number(current?.checkpointSequence || 0) + 1, {
      type: 'RUN_COMPLETED',
      at: now().toISOString(),
    }, 'persist_agent_run');
  }

  async failRun(run, error) {
    if (error?.code === 'AGENT_LEASE_LOST') return;
    const terminal = Number(run.attempt || 0) >= Number(run.maxAttempts || PLAN_REVIEW_BUDGETS.maxAttempts);
    const cancelled = error?.code === 'AGENT_RUN_CANCELLED';
    const budgetExceeded = error?.code === 'AGENT_BUDGET_EXCEEDED';
    const classification = classifyFailure(error);
    if (cancelled) PrometheusMetrics.inc('agent_cancellation_total');
    if (budgetExceeded) PrometheusMetrics.inc('agent_budget_exceeded_total');
    const update = {
      $set: {
        status: cancelled ? 'CANCELLED' : (budgetExceeded ? 'BUDGET_EXCEEDED' : (terminal ? 'FAILED' : 'QUEUED')),
        retryAt: terminal || cancelled || budgetExceeded ? null : new Date(Date.now() + Math.min(30000, 1000 * (2 ** Math.max(0, Number(run.attempt || 1) - 1)))),
        failure: { code: classification, message: String(error?.message || 'Agent run failed').slice(0, 240) },
        deadLetter: terminal && !cancelled ? { code: classification, at: now() } : null,
        leaseUntil: null,
        completedAt: terminal || cancelled || budgetExceeded ? now() : null,
        currentNode: terminal || cancelled || budgetExceeded ? null : run.currentNode,
      },
    };
    if (terminal || cancelled || budgetExceeded) update.$unset = { activeDedupeKey: 1 };
    const written = await this.model.updateOne({ ...leaseFilter(run), status: 'RUNNING' }, update);
    if (!isModified(written)) {
      PrometheusMetrics.inc('agent_worker_stale_write_rejections_total');
      throw staleLeaseError();
    }
    await this.appendEvent(run, Number(run.checkpointSequence || 0) + 1, {
      type: cancelled ? 'RUN_CANCELLED' : 'RUN_FAILED',
      code: classification,
      at: now().toISOString(),
    }, run.currentNode);
  }

  async processNext() {
    if (this.draining || this.activePromise) return false;
    await updateQueueMetrics(this.model);
    const run = await claimNextPlanReviewRun({ model: this.model, worker: this.workerId, leaseMs: this.leaseMs });
    if (!run) return false;
    this.activeRun = run;
    this.leaseLost = false;
    this.startHeartbeat();
    const span = tracer.startSpan('agent.worker.execute', { attributes: { 'agent.type': 'PLAN_REVIEW', attempt: run.attempt || 0, 'queue.priority': run.priority || 'INTERACTIVE_PLAN_REVIEW' } });
    this.activePromise = (async () => {
      try {
        const review = await runPlanReview({
          userId: run.userId,
          profileId: run.profileId,
          runId: run.runId,
          resumeCheckpoint: run.checkpoint,
          correlationId: run.correlationId,
          runtimeConfig: this.runtimeConfig,
          dependencies: {
            checkpointer: new MongoPlanReviewCheckpointer({ runId: run.runId, userId: run.userId, workerId: run.workerId, executionGeneration: run.executionGeneration, assertLease: () => this.assertLease(run) }),
            onNodeProgress: payload => this.updateProgress(run, payload),
            // The queue owns AgentRun finalization. Keeping this graph callback
            // side-effect free lets the final LangGraph checkpoint be written
            // while the lease is still RUNNING; finishRun then applies the
            // fenced terminal transition exactly once.
            persistAgentRun: async () => undefined,
          },
        });
        const latest = await this.model.findOne({ ...leaseFilter(run) }).lean();
        if (latest?.status === 'RUNNING') await this.finishRun(run, review);
        PrometheusMetrics.inc('agent_worker_jobs_completed_total');
        PrometheusMetrics.inc('agent_queue_runs_completed_total');
        span.setAttribute('run.state', 'COMPLETED');
      } catch (error) {
        await this.failRun(run, error).catch(failureError => {
          if (failureError?.code !== 'AGENT_LEASE_LOST') throw failureError;
        });
        PrometheusMetrics.inc('agent_worker_jobs_failed_total');
        PrometheusMetrics.inc('agent_queue_runs_failed_total');
        span.setAttribute('run.state', classifyFailure(error));
      } finally {
        PrometheusMetrics.setGauge('agent_worker_jobs_active', 0);
        this.stopHeartbeat();
        this.activeRun = null;
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
    void recoverExpiredPlanReviewRuns({ model: this.model }).catch(() => {});
    void this.processNext().catch(() => {});
    return this;
  }

  async stop({ graceMs = this.runtimeConfig?.agentPlanReview?.shutdownGraceMs || 10000 } = {}) {
    this.draining = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
