import crypto from 'node:crypto';
import mongoose from 'mongoose';
import FinancialProfile from '../models/FinancialProfile.js';
import PlanHealthEvent from '../models/PlanHealthEvent.js';
import PlanHealthSchedulerLease from '../models/PlanHealthSchedulerLease.js';
import { loadPlanReviewContext } from '../agents/planReview/planReviewTools.js';
import { PrometheusMetrics } from './metricsCollector.js';
import logger from '../utils/logger.js';

export const PLAN_HEALTH_MONITOR_VERSION = 'plan-health-monitor-1.0.0';

const SEVERITY = Object.freeze({
  RECOMMENDATION_MISSING: 'BLOCKED',
  PROFILE_CHANGED: 'ATTENTION',
  REGULATORY_POLICY_CHANGED: 'ATTENTION',
  MODEL_VERSION_MISSING: 'ATTENTION',
  PROFILE_HASH_MISSING: 'ATTENTION',
  REGULATORY_VERSION_UNAVAILABLE: 'BLOCKED',
});

export function planHealthEventFingerprint({ userId, profileId, recommendationId, reason }) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({
      userId: String(userId),
      profileId: String(profileId),
      recommendationId: recommendationId ? String(recommendationId) : null,
      reason,
      version: PLAN_HEALTH_MONITOR_VERSION,
    }))
    .digest('hex');
}

function eventCopy(reason) {
  if (reason === 'RECOMMENDATION_MISSING') return 'A current authoritative recommendation is not available.';
  if (reason === 'PROFILE_CHANGED') return 'Your saved plan no longer matches your current profile.';
  if (reason === 'REGULATORY_POLICY_CHANGED') return 'The saved plan was generated under an older regulatory policy version.';
  if (reason === 'REGULATORY_VERSION_UNAVAILABLE') return 'Verified regulatory policy evidence is currently unavailable.';
  return 'The saved plan needs a review before it can be treated as current.';
}

function leaseLostError() {
  return Object.assign(new Error('Plan Health scan lease was lost before its event write.'), { code: 'PLAN_HEALTH_LEASE_LOST' });
}

async function withLeaseFence({ leaseFence, leaseModel, mongo, action }) {
  if (!leaseFence) return action(null);
  const session = await mongo.startSession();
  let result;
  try {
    if (typeof session?.withTransaction !== 'function') {
      throw Object.assign(new Error('Plan Health event writes require transaction-capable MongoDB.'), {
        code: 'TRANSACTION_REQUIRED',
      });
    }
    await session.withTransaction(async () => {
      const nowValue = new Date();
      const fence = await leaseModel.updateOne({
        _id: leaseFence.periodKey,
        owner: leaseFence.owner,
        executionGeneration: leaseFence.executionGeneration,
        status: 'RUNNING',
        leaseUntil: { $gt: nowValue },
      }, { $inc: { mutationFence: 1 } }, { session });
      if (Number(fence?.modifiedCount ?? fence?.nModified ?? 0) !== 1) throw leaseLostError();
      result = await action(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export async function inspectPlanHealth({
  userId,
  profileId,
  profileModel = FinancialProfile,
  eventModel = PlanHealthEvent,
  dependencies = {},
  signal,
  assertLease = async () => undefined,
  leaseFence = null,
  leaseModel = PlanHealthSchedulerLease,
  mongo = mongoose,
}) {
  const context = await loadPlanReviewContext({ userId, profileId, dependencies: { ...dependencies, profileModel } });
  if (signal?.aborted) throw signal.reason;
  const reason = context.freshness?.reasonCodes?.[0] || null;
  if (!context.profile) return { status: 'HEALTHY', event: null };
  if (!reason) {
    await assertLease();
    if (signal?.aborted) throw signal.reason;
    await withLeaseFence({ leaseFence, leaseModel, mongo, action: session => eventModel.updateMany?.(
      { userId, profileId, status: { $in: ['UNREAD', 'READ', 'OPEN', 'ACKNOWLEDGED'] } },
      { $set: { status: 'RESOLVED', resolvedAt: new Date() } },
      session ? { session } : undefined,
    ) });
    return { status: 'HEALTHY', event: null };
  }
  const recommendationId = context.recommendation?._id || null;
  const event = {
    userId,
    profileId,
    recommendationId,
    reason,
    severity: SEVERITY[reason] || 'ATTENTION',
    recommendation: eventCopy(reason),
    detectedAt: new Date(),
    fingerprint: planHealthEventFingerprint({ userId, profileId, recommendationId, reason }),
    monitorVersion: PLAN_HEALTH_MONITOR_VERSION,
  };
  const activeStatuses = ['UNREAD', 'READ', 'OPEN', 'ACKNOWLEDGED'];
  await assertLease();
  if (signal?.aborted) throw signal.reason;
  try {
    await assertLease();
    if (signal?.aborted) throw signal.reason;
    const persisted = await withLeaseFence({ leaseFence, leaseModel, mongo, action: async session => {
      const options = session ? { session } : undefined;
      await eventModel.updateMany(
        { userId, profileId, fingerprint: { $ne: event.fingerprint }, status: { $in: activeStatuses } },
        { $set: { status: 'SUPERSEDED', supersededAt: event.detectedAt } },
        options,
      );
      const created = session
        ? await eventModel.create([event], options)
        : await eventModel.create(event);
      return Array.isArray(created) ? created[0] : created;
    } });
    PrometheusMetrics.inc('plan_health_events_created_total');
    PrometheusMetrics.inc('plan_health_events_total');
    return { status: 'ATTENTION', event: persisted.toObject ? persisted.toObject() : persisted };
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error?.code !== 11000) throw error;
    PrometheusMetrics.inc('plan_health_events_deduplicated_total');
    const existing = await eventModel.findOne({ fingerprint: event.fingerprint }).lean();
    if (existing?.status === 'RESOLVED' || existing?.status === 'SUPERSEDED') {
      await assertLease();
      if (signal?.aborted) throw signal.reason;
      const reopened = await withLeaseFence({ leaseFence, leaseModel, mongo, action: async session => {
        const query = eventModel.findOneAndUpdate(
          { fingerprint: event.fingerprint },
          {
            $set: { status: 'UNREAD', detectedAt: event.detectedAt },
            $unset: { acknowledgedAt: 1, resolvedAt: 1, supersededAt: 1 },
          },
          { new: true, ...(session ? { session } : {}) },
        );
        return query.lean ? query.lean() : query;
      } });
      return { status: 'ATTENTION', event: reopened || existing };
    }
    return { status: 'ATTENTION', event: existing };
  }
}

export async function listPlanHealthEvents({ userId, eventModel = PlanHealthEvent, limit = 20 }) {
  return eventModel.find({ userId }).sort({ detectedAt: -1 }).limit(Math.min(50, Math.max(1, Number(limit) || 20))).lean();
}

export async function acknowledgePlanHealthEvent({ userId, eventId, eventModel = PlanHealthEvent }) {
  return eventModel.findOneAndUpdate(
    { _id: eventId, userId, status: { $in: ['UNREAD', 'READ', 'OPEN'] } },
    { $set: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() } },
    { new: true },
  ).lean();
}

export function triggerPlanHealthCheck({ userId, profileId } = {}) {
  if (!userId || !profileId) return Promise.resolve(null);
  return inspectPlanHealth({ userId, profileId }).catch(error => {
    logger.warn('Event-driven plan health check failed', { code: error.code || 'PLAN_HEALTH_CHECK_FAILED' });
    return null;
  });
}
