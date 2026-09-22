import crypto from 'node:crypto';
import { trace } from '../config/tracing.js';
import FinancialProfile from '../models/FinancialProfile.js';
import PlanHealthSchedulerLease from '../models/PlanHealthSchedulerLease.js';
import { inspectPlanHealth } from './planHealthMonitor.js';
import { PrometheusMetrics } from './metricsCollector.js';

const tracer = trace.getTracer('wealthgenie-plan-health');
let schedulerTimer = null;
let schedulerPromise = null;
let schedulerOwner = null;

export function planHealthPeriodKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
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
      $or: [{ completedAt: null }, { completedAt: { $exists: false } }],
      $and: [{ $or: [{ leaseUntil: { $lt: nowValue } }, { leaseUntil: { $exists: false } }] }],
    }, {
      $setOnInsert: { _id: periodKey, periodKey, usersScanned: 0 },
      $set: { owner, leaseUntil: new Date(nowValue.getTime() + leaseMs) },
    }, { upsert: true, new: true });
    return lease?.owner === owner ? lease : null;
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
}

async function scanBatch({ profiles, concurrency = 4 }) {
  const results = [];
  for (let index = 0; index < profiles.length; index += concurrency) {
    const slice = profiles.slice(index, index + concurrency);
    results.push(...await Promise.all(slice.map(profile => inspectPlanHealth({ userId: profile.userId, profileId: profile._id }))));
  }
  return results;
}

export async function runPlanHealthScan({
  profileModel = FinancialProfile,
  leaseModel = PlanHealthSchedulerLease,
  batchSize = 100,
  concurrency = 4,
  owner = crypto.randomUUID(),
  leaseMs = 300000,
  periodKey = planHealthPeriodKey(),
  nowValue = new Date(),
} = {}) {
  const lease = await claimPlanHealthSchedulerLease({ model: leaseModel, periodKey, owner, leaseMs, nowValue });
  if (!lease) return { claimed: false, scanned: 0, events: 0, deduplicated: 0, periodKey };
  const span = tracer.startSpan('agent.scheduler.run', { attributes: { 'agent.type': 'PLAN_HEALTH', 'worker.operation': 'scheduled_scan' } });
  let scanned = 0;
  let events = 0;
  try {
    let lastId = null;
    while (true) {
      const filter = lastId ? { _id: { $gt: lastId } } : {};
      const query = profileModel.find(filter).sort({ _id: 1 }).limit(batchSize);
      const profiles = await (query.lean ? query.lean() : query);
      if (!profiles?.length) break;
      const batchSpan = tracer.startSpan('agent.plan_health.batch', { attributes: { 'agent.type': 'PLAN_HEALTH' } });
      const results = await scanBatch({ profiles, concurrency });
      scanned += profiles.length;
      events += results.filter(result => result.status === 'ATTENTION').length;
      batchSpan.end();
      lastId = profiles[profiles.length - 1]._id;
      PrometheusMetrics.inc('plan_health_users_scanned_total', profiles.length);
      if (profiles.length < batchSize) break;
    }
    await leaseModel.updateOne(
      { _id: periodKey, owner, completedAt: null },
      { $set: { completedAt: new Date(), leaseUntil: null, usersScanned: scanned } },
    );
    PrometheusMetrics.inc('plan_health_scans_total');
    span.setAttribute('run.state', 'COMPLETED');
    return { claimed: true, scanned, events, deduplicated: 0, periodKey };
  } finally {
    span.end();
  }
}

function scheduleNext({ intervalMs, jitterMs, config }) {
  if (!schedulerTimer) return;
  const delay = intervalMs + (jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0);
  schedulerTimer = setTimeout(async () => {
    schedulerTimer = null;
    schedulerPromise = runPlanHealthScan({
      owner: schedulerOwner,
      batchSize: config.batchSize,
      concurrency: config.concurrency,
      leaseMs: config.leaseMs,
    }).catch(() => null).finally(() => {
      schedulerPromise = null;
      scheduleNext({ intervalMs, jitterMs, config });
    });
    schedulerTimer.unref?.();
  }, delay);
  schedulerTimer.unref?.();
}

export function startPlanHealthScheduler({ config = {}, owner = `plan-health-scheduler-${crypto.randomUUID()}` } = {}) {
  if (schedulerTimer || config.enabled === false) return;
  schedulerOwner = owner;
  schedulerTimer = setTimeout(() => {
    schedulerTimer = null;
    schedulerPromise = runPlanHealthScan({ owner, batchSize: config.batchSize, concurrency: config.concurrency, leaseMs: config.leaseMs })
      .catch(() => null)
      .finally(() => { schedulerPromise = null; scheduleNext({ intervalMs: config.intervalMs, jitterMs: config.jitterMs, config }); });
    schedulerTimer.unref?.();
  }, config.jitterMs || 0);
  schedulerTimer.unref?.();
}

export async function stopPlanHealthScheduler() {
  if (schedulerTimer) clearTimeout(schedulerTimer);
  schedulerTimer = null;
  if (schedulerPromise) await schedulerPromise;
  schedulerPromise = null;
  schedulerOwner = null;
}

export function getPlanHealthSchedulerState() {
  return { running: Boolean(schedulerTimer || schedulerPromise), draining: false };
}
