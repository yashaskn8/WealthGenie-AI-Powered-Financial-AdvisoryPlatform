import crypto from 'node:crypto';
import { trace } from '../config/tracing.js';
import FinancialProfile from '../models/FinancialProfile.js';
import PlanHealthInspectionFence from '../models/PlanHealthInspectionFence.js';
import PlanHealthSchedulerLease from '../models/PlanHealthSchedulerLease.js';
import { inspectPlanHealth } from './planHealthMonitor.js';
import { PrometheusMetrics } from './metricsCollector.js';
import logger from '../utils/logger.js';

const tracer = trace.getTracer('wealthgenie-plan-health');
let schedulerInstance = null;
const MAX_CONSECUTIVE_SCAN_FAILURES_BEFORE_UNREADY = 3;
const PUBLICATION_FENCE_RETENTION_MS = 8 * 24 * 60 * 60 * 1000;

export function planHealthPeriodKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function leaseLostError() {
  const error = new Error('Plan Health scan lease was lost.');
  error.code = 'PLAN_HEALTH_LEASE_LOST';
  return error;
}

function isModified(result) {
  return Number(result?.modifiedCount ?? result?.nModified ?? 0) > 0;
}

function asPlainRecord(value) {
  return value?.toObject ? value.toObject() : value;
}

export async function claimPlanHealthSchedulerLease({
  model = PlanHealthSchedulerLease,
  periodKey = planHealthPeriodKey(),
  owner = crypto.randomUUID(),
  leaseMs = 300000,
  nowValue = new Date(),
} = {}) {
  try {
    const lease = await model.findOneAndUpdate({
      _id: periodKey,
      status: { $nin: ['COMPLETED', 'COMPLETED_WITH_ERRORS'] },
      $or: [
        { leaseUntil: null },
        { leaseUntil: { $lte: nowValue } },
        { leaseUntil: { $exists: false } },
      ],
    }, {
      $setOnInsert: {
        _id: periodKey,
        periodKey,
        usersScanned: 0,
        eventsCreated: 0,
        failureCount: 0,
        cursor: null,
      },
      $set: {
        owner,
        status: 'RUNNING',
        startedAt: nowValue,
        lastHeartbeatAt: nowValue,
        leaseUntil: new Date(nowValue.getTime() + leaseMs),
        failureCode: null,
      },
      $inc: { executionGeneration: 1 },
    }, { upsert: true, new: true, setDefaultsOnInsert: true });
    const record = asPlainRecord(lease);
    return record?.owner === owner ? record : null;
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || leaseLostError();
}

function timeoutError() {
  const error = new Error('Plan Health profile inspection exceeded its bounded execution time.');
  error.code = 'PLAN_HEALTH_PROFILE_TIMEOUT';
  return error;
}

function publicationFenceUnavailableError() {
  return Object.assign(new Error('Plan Health publication validity could not be durably reconciled.'), {
    code: 'PLAN_HEALTH_PUBLICATION_FENCE_UNAVAILABLE',
  });
}

async function transitionPublicationFence({ model, fence, status, result = null }) {
  const now = new Date();
  const filter = { _id: fence.tokenId, status: 'RUNNING' };
  if (status === 'PUBLISHED') filter.deadlineAt = { $gt: now };
  try {
    const changed = await model.updateOne(filter, {
      $set: {
        status,
        invalidatedAt: status === 'PUBLISHED' ? null : now,
        publishedAt: status === 'PUBLISHED' ? now : null,
        resultStatus: result?.status || null,
        eventId: result?.event?._id || null,
      },
    });
    if (isModified(changed)) return { status, result };
    const current = await model.findOne({ _id: fence.tokenId }).lean();
    if (!current) throw publicationFenceUnavailableError();
    if (current.status === 'PUBLISHED') {
      return {
        status: 'PUBLISHED',
        result: {
          status: current.resultStatus,
          event: current.eventId ? { _id: current.eventId } : null,
        },
      };
    }
    if (current.status === status || ['TIMED_OUT', 'CANCELLED', 'STALE', 'FAILED'].includes(current.status)) {
      return { status: current.status, result: null };
    }
    throw publicationFenceUnavailableError();
  } catch (error) {
    if (error?.code === 'PLAN_HEALTH_PUBLICATION_FENCE_UNAVAILABLE') throw error;
    throw Object.assign(publicationFenceUnavailableError(), { cause: error });
  }
}

async function inspectWithDeadline({
  inspect,
  profile,
  profileTimeoutMs,
  signal,
  assertLease,
  leaseFence,
  publicationFenceModel,
  setTimeoutImpl,
  clearTimeoutImpl,
}) {
  throwIfAborted(signal);
  const startedAt = new Date();
  const publicationFence = {
    tokenId: crypto.randomUUID(),
    periodKey: leaseFence.periodKey,
    profileId: profile._id,
    owner: leaseFence.owner,
    executionGeneration: leaseFence.executionGeneration,
  };
  await publicationFenceModel.create({
    _id: publicationFence.tokenId,
    periodKey: publicationFence.periodKey,
    profileId: profile._id,
    owner: publicationFence.owner,
    executionGeneration: publicationFence.executionGeneration,
    status: 'RUNNING',
    startedAt,
    deadlineAt: new Date(startedAt.getTime() + profileTimeoutMs),
    expiresAt: new Date(startedAt.getTime() + profileTimeoutMs + PUBLICATION_FENCE_RETENTION_MS),
  });
  const controller = new AbortController();
  let resolveDeadline;
  const deadline = new Promise(resolve => { resolveDeadline = resolve; });
  let invalidationInFlight = null;
  const invalidate = (status, reason) => {
    if (invalidationInFlight) return invalidationInFlight;
    invalidationInFlight = transitionPublicationFence({ model: publicationFenceModel, fence: publicationFence, status })
      .then(outcome => {
        if (outcome.status === 'PUBLISHED') resolveDeadline({ ok: true, result: outcome.result });
        else resolveDeadline({ ok: false, error: reason });
        return outcome;
      })
      .catch(error => {
        controller.abort(error);
        resolveDeadline({ ok: false, error });
        return { status: 'UNAVAILABLE', error };
      });
    return invalidationInFlight;
  };
  const abort = () => {
    const reason = signal.reason || leaseLostError();
    controller.abort(reason);
    const status = reason?.code === 'PLAN_HEALTH_LEASE_LOST' ? 'STALE' : 'CANCELLED';
    void invalidate(status, reason);
  };
  signal?.addEventListener('abort', abort, { once: true });
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const operation = Promise.resolve().then(async () => {
    const result = await inspect({
      userId: profile.userId,
      profileId: profile._id,
      signal: combinedSignal,
      assertLease,
      leaseFence,
      publicationFence,
    });
    throwIfAborted(combinedSignal);
    const settled = await transitionPublicationFence({
      model: publicationFenceModel,
      fence: publicationFence,
      status: 'PUBLISHED',
      result,
    });
    if (settled.status !== 'PUBLISHED') throw Object.assign(new Error('Plan Health inspection publication was invalidated.'), { code: 'PLAN_HEALTH_PUBLICATION_FENCE_LOST' });
    return { ok: true, result };
  }).catch(async error => {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason || error;
      const invalidStatus = reason?.code === 'PLAN_HEALTH_PROFILE_TIMEOUT'
        ? 'TIMED_OUT'
        : (reason?.code === 'PLAN_HEALTH_LEASE_LOST' ? 'STALE' : 'CANCELLED');
      const outcome = await invalidate(invalidStatus, reason);
      return outcome.status === 'PUBLISHED'
        ? { ok: true, result: outcome.result }
        : { ok: false, error: reason };
    }
    if (!['PLAN_HEALTH_PROFILE_TIMEOUT', 'PLAN_HEALTH_LEASE_LOST'].includes(error?.code)) {
      await transitionPublicationFence({ model: publicationFenceModel, fence: publicationFence, status: 'FAILED' }).catch(() => {});
    }
    return { ok: false, error };
  });
  const timer = setTimeoutImpl(() => {
    const error = timeoutError();
    controller.abort(error);
    void invalidate('TIMED_OUT', error);
  }, profileTimeoutMs);
  try {
    timer?.unref?.();
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeoutImpl(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function runBoundedBatch({
  profiles,
  concurrency,
  profileTimeoutMs,
  signal,
  assertLease,
  inspect,
  leaseFence,
  publicationFenceModel,
  setTimeoutImpl,
  clearTimeoutImpl,
}) {
  const results = [];
  for (let offset = 0; offset < profiles.length; offset += concurrency) {
    throwIfAborted(signal);
    const group = profiles.slice(offset, offset + concurrency);
    const settled = await Promise.all(group.map(async profile => {
      try {
        return await inspectWithDeadline({
          inspect, profile, profileTimeoutMs, signal, assertLease, leaseFence,
          publicationFenceModel, setTimeoutImpl, clearTimeoutImpl,
        });
      } catch (error) {
        if (signal?.aborted) throw signal.reason || error;
        return { ok: false, error };
      }
    }));
    results.push(...settled);
  }
  return results;
}

export async function runPlanHealthScan({
  profileModel = FinancialProfile,
  leaseModel = PlanHealthSchedulerLease,
  publicationFenceModel = PlanHealthInspectionFence,
  inspect = inspectPlanHealth,
  batchSize = 100,
  concurrency = 4,
  profileTimeoutMs = 30000,
  heartbeatMs = null,
  owner = crypto.randomUUID(),
  leaseMs = 300000,
  periodKey = planHealthPeriodKey(),
  nowValue = new Date(),
  signal: parentSignal = null,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  const lease = await claimPlanHealthSchedulerLease({ model: leaseModel, periodKey, owner, leaseMs, nowValue });
  if (!lease) return { claimed: false, scanned: 0, events: 0, failures: 0, periodKey };
  const generation = Number(lease.executionGeneration || 1);
  const scanController = new AbortController();
  const abortScan = () => scanController.abort(parentSignal?.reason || leaseLostError());
  parentSignal?.addEventListener('abort', abortScan, { once: true });
  const signal = parentSignal ? AbortSignal.any([parentSignal, scanController.signal]) : scanController.signal;
  const effectiveHeartbeatMs = Math.max(1000, Math.min(heartbeatMs || Math.floor(leaseMs / 3), Math.floor(leaseMs / 2)));
  let leaseLost = false;
  let heartbeatInFlight = Promise.resolve();
  const span = tracer.startSpan('agent.scheduler.run', {
    attributes: { 'agent.type': 'PLAN_HEALTH', 'worker.operation': 'scheduled_scan', 'lease.generation': generation },
  });
  const assertLease = async () => {
    throwIfAborted(signal);
    const current = await leaseModel.findOne({
      _id: periodKey,
      owner,
      executionGeneration: generation,
      status: 'RUNNING',
      leaseUntil: { $gt: new Date() },
    }).lean();
    if (!current) {
      leaseLost = true;
      throw leaseLostError();
    }
    return current;
  };
  const heartbeat = async () => {
    if (leaseLost || signal.aborted) return;
    heartbeatInFlight = heartbeatInFlight.then(async () => {
      const nowHeartbeat = new Date();
      const result = await leaseModel.updateOne({
        _id: periodKey,
        owner,
        executionGeneration: generation,
        status: 'RUNNING',
        leaseUntil: { $gt: nowHeartbeat },
      }, { $set: { lastHeartbeatAt: nowHeartbeat, leaseUntil: new Date(nowHeartbeat.getTime() + leaseMs) } });
      if (!isModified(result)) {
        leaseLost = true;
        scanController.abort(leaseLostError());
        PrometheusMetrics.inc('plan_health_lease_conflicts_total');
      }
    }).catch(error => {
      leaseLost = true;
      scanController.abort(error?.code === 'PLAN_HEALTH_LEASE_LOST' ? error : leaseLostError());
      PrometheusMetrics.inc('plan_health_lease_renewal_failures_total');
      logger.error('Plan Health scheduler lease renewal failed', { code: error?.code || 'LEASE_RENEWAL_FAILED' });
    });
    await heartbeatInFlight;
  };
  const heartbeatTimer = setIntervalImpl(() => { void heartbeat(); }, effectiveHeartbeatMs);
  heartbeatTimer.unref?.();

  let scanned = 0;
  let events = 0;
  let failures = 0;
  let cursor = lease.cursor || null;
  try {
    while (true) {
      await assertLease();
      const filter = cursor ? { _id: { $gt: cursor } } : {};
      const query = profileModel.find(filter).sort({ _id: 1 }).limit(batchSize);
      const profiles = await (query.lean ? query.lean() : query);
      throwIfAborted(signal);
      if (!profiles?.length) break;

      const batchSpan = tracer.startSpan('agent.plan_health.batch', { attributes: { 'agent.type': 'PLAN_HEALTH' } });
      const results = await runBoundedBatch({
        profiles,
        concurrency,
        profileTimeoutMs,
        signal,
        assertLease,
        inspect,
        leaseFence: { periodKey, owner, executionGeneration: generation },
        publicationFenceModel,
        setTimeoutImpl,
        clearTimeoutImpl,
      });
      batchSpan.end();
      throwIfAborted(signal);
      const batchEvents = results.filter(item => item.ok && item.result?.status === 'ATTENTION').length;
      const batchFailures = results.filter(item => !item.ok).length;
      if (batchFailures) {
        for (const item of results.filter(result => !result.ok)) {
          if (item.error?.code === 'PLAN_HEALTH_PROFILE_TIMEOUT') PrometheusMetrics.inc('plan_health_profile_timeouts_total');
          logger.warn('Plan Health profile inspection failed; scan will continue', {
            code: item.error?.code || 'PLAN_HEALTH_PROFILE_FAILED',
          });
        }
      }

      const lastProfileId = profiles[profiles.length - 1]._id;
      const progressAt = new Date();
      const progress = await leaseModel.updateOne({
        _id: periodKey,
        owner,
        executionGeneration: generation,
        status: 'RUNNING',
        leaseUntil: { $gt: progressAt },
      }, {
        $set: {
          cursor: lastProfileId,
          lastHeartbeatAt: progressAt,
          leaseUntil: new Date(progressAt.getTime() + leaseMs),
        },
        $inc: { usersScanned: profiles.length, eventsCreated: batchEvents, failureCount: batchFailures },
      });
      if (!isModified(progress)) {
        leaseLost = true;
        scanController.abort(leaseLostError());
        throw leaseLostError();
      }
      cursor = lastProfileId;
      scanned += profiles.length;
      events += batchEvents;
      failures += batchFailures;
      PrometheusMetrics.inc('plan_health_users_scanned_total', profiles.length);
      if (profiles.length < batchSize) break;
    }

    await heartbeatInFlight;
    const completedAt = new Date();
    const completed = await leaseModel.updateOne({
      _id: periodKey,
      owner,
      executionGeneration: generation,
      status: 'RUNNING',
      leaseUntil: { $gt: completedAt },
    }, {
      $set: {
        status: failures > 0 || Number(lease.failureCount || 0) > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
        completedAt,
        leaseUntil: null,
        lastHeartbeatAt: completedAt,
      },
    });
    if (!isModified(completed)) throw leaseLostError();
    PrometheusMetrics.inc('plan_health_scans_total');
    if (failures) PrometheusMetrics.inc('plan_health_scan_failures_total', failures);
    span.setAttribute('run.state', failures ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED');
    return { claimed: true, scanned, events, failures, periodKey };
  } catch (error) {
    if (!leaseLost && error?.code !== 'PLAN_HEALTH_LEASE_LOST') {
      const failedAt = new Date();
      await leaseModel.updateOne({
        _id: periodKey,
        owner,
        executionGeneration: generation,
        status: 'RUNNING',
        leaseUntil: { $gt: failedAt },
      }, {
        $set: { status: 'FAILED', failureCode: error?.code || 'PLAN_HEALTH_SCAN_FAILED', leaseUntil: null },
      }).catch(releaseError => {
        logger.error('Plan Health failure state could not be persisted', {
          code: releaseError?.code || 'PLAN_HEALTH_FAILURE_PERSISTENCE_FAILED',
        });
      });
      PrometheusMetrics.inc('plan_health_scan_errors_total');
      logger.error('Plan Health scan stopped before completion', { code: error?.code || 'PLAN_HEALTH_SCAN_FAILED' });
    }
    span.setAttribute('run.state', leaseLost ? 'LEASE_LOST' : 'FAILED');
    throw error;
  } finally {
    clearIntervalImpl(heartbeatTimer);
    parentSignal?.removeEventListener('abort', abortScan);
    span.end();
  }
}

export function createPlanHealthScheduler({
  config = {},
  owner = `plan-health-scheduler-${crypto.randomUUID()}`,
  runScan = runPlanHealthScan,
  random = Math.random,
  schedule = setTimeout,
  cancel = clearTimeout,
  setDeadlineTimer = setTimeout,
  clearDeadlineTimer = clearTimeout,
  loggerImpl = logger,
} = {}) {
  let timer = null;
  let activePromise = null;
  let activeController = null;
  let started = false;
  let draining = false;
  let lastRunStartedAt = null;
  let lastRunCompletedAt = null;
  let lastRunStatus = 'NEVER_RUN';
  let lastRunErrorCode = null;
  let consecutiveFailures = 0;
  let leaseHealth = 'UNKNOWN';

  const nextDelay = () => (config.intervalMs || 86400000)
    + (config.jitterMs > 0 ? Math.floor(random() * config.jitterMs) : 0);

  const scheduleNext = delay => {
    if (!started || draining) return;
    timer = schedule(() => {
      timer = null;
      if (!started || draining) return;
      activeController = new AbortController();
      lastRunStartedAt = new Date().toISOString();
      lastRunStatus = 'RUNNING';
      activePromise = Promise.resolve().then(() => runScan({
        owner,
        batchSize: config.batchSize,
        concurrency: config.concurrency,
        leaseMs: config.leaseMs,
        heartbeatMs: config.heartbeatMs,
        profileTimeoutMs: config.profileTimeoutMs,
        signal: activeController.signal,
      })).then(result => {
        consecutiveFailures = 0;
        lastRunStatus = result?.claimed === false ? 'SKIPPED_LEASE_HELD' : 'COMPLETED';
        lastRunErrorCode = null;
        leaseHealth = result?.claimed === false ? 'NOT_OWNER' : 'HEALTHY';
        return result;
      }).catch(error => {
        consecutiveFailures += 1;
        lastRunStatus = 'FAILED';
        lastRunErrorCode = String(error?.code || 'PLAN_HEALTH_SCAN_FAILED').slice(0, 80);
        leaseHealth = error?.code === 'PLAN_HEALTH_LEASE_LOST' ? 'LOST' : 'UNKNOWN';
        PrometheusMetrics.inc('plan_health_scheduler_failures_total');
        loggerImpl.error('Scheduled Plan Health scan failed', { code: error?.code || 'PLAN_HEALTH_SCAN_FAILED' });
      }).finally(() => {
        lastRunCompletedAt = new Date().toISOString();
        activePromise = null;
        activeController = null;
        scheduleNext(nextDelay());
      });
      timer?.unref?.();
    }, delay);
    timer?.unref?.();
  };

  return {
    start() {
      if (started || config.enabled === false) return this;
      started = true;
      draining = false;
      scheduleNext(config.initialDelayMs ?? config.jitterMs ?? 0);
      return this;
    },
    async stop({ graceMs = 10000 } = {}) {
      if (!started && !activePromise) return { drained: true };
      draining = true;
      started = false;
      if (timer) cancel(timer);
      timer = null;
      if (!activePromise) return { drained: true };
      let timeout;
      const grace = new Promise(resolve => {
        timeout = setDeadlineTimer(() => resolve(false), Math.max(0, graceMs));
        timeout?.unref?.();
      });
      const drained = await Promise.race([activePromise.then(() => true), grace]);
      clearDeadlineTimer(timeout);
      if (!drained) activeController?.abort(new Error('Plan Health scheduler shutdown deadline exceeded.'));
      if (drained) await activePromise;
      return { drained };
    },
    async waitForIdle() {
      if (activePromise) await activePromise;
    },
    state() {
      const lifecycle = draining ? 'DRAINING'
        : (activePromise ? 'RUNNING'
          : (timer ? 'SCHEDULED' : 'STOPPED'));
      const schedulerHealthy = consecutiveFailures < MAX_CONSECUTIVE_SCAN_FAILURES_BEFORE_UNREADY;
      return {
        lifecycle,
        running: started,
        scheduled: Boolean(timer),
        active: Boolean(activePromise),
        draining,
        schedulerHealthy,
        consecutiveFailures,
        lastRunStartedAt,
        lastRunCompletedAt,
        lastRunStatus,
        lastRunErrorCode,
        leaseHealth,
        ready: started && !draining && schedulerHealthy,
      };
    },
  };
}

export function startPlanHealthScheduler(options = {}) {
  if (schedulerInstance) return schedulerInstance;
  schedulerInstance = createPlanHealthScheduler(options).start();
  return schedulerInstance;
}

export async function stopPlanHealthScheduler(options = {}) {
  if (!schedulerInstance) return { drained: true };
  const current = schedulerInstance;
  const result = await current.stop(options);
  if (result.drained) schedulerInstance = null;
  return result;
}

export function getPlanHealthSchedulerState() {
  return schedulerInstance?.state() || {
    lifecycle: 'STOPPED', running: false, scheduled: false, active: false, draining: false,
    schedulerHealthy: false, consecutiveFailures: 0, lastRunStartedAt: null,
    lastRunCompletedAt: null, lastRunStatus: 'STOPPED', lastRunErrorCode: null,
    leaseHealth: 'UNKNOWN', ready: false,
  };
}
