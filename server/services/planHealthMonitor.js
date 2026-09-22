import crypto from 'node:crypto';
import FinancialProfile from '../models/FinancialProfile.js';
import PlanHealthEvent from '../models/PlanHealthEvent.js';
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

function fingerprint({ userId, recommendationId, reason }) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ userId: String(userId), recommendationId: recommendationId ? String(recommendationId) : null, reason, version: PLAN_HEALTH_MONITOR_VERSION }))
    .digest('hex');
}

function eventCopy(reason) {
  if (reason === 'RECOMMENDATION_MISSING') return 'A current authoritative recommendation is not available.';
  if (reason === 'PROFILE_CHANGED') return 'Your saved plan no longer matches your current profile.';
  if (reason === 'REGULATORY_POLICY_CHANGED') return 'The saved plan was generated under an older regulatory policy version.';
  if (reason === 'REGULATORY_VERSION_UNAVAILABLE') return 'Verified regulatory policy evidence is currently unavailable.';
  return 'The saved plan needs a review before it can be treated as current.';
}

export async function inspectPlanHealth({ userId, profileId, profileModel = FinancialProfile, eventModel = PlanHealthEvent, dependencies = {} }) {
  const context = await loadPlanReviewContext({ userId, profileId, dependencies: { ...dependencies, profileModel } });
  const reason = context.freshness?.reasonCodes?.[0] || null;
  if (!context.profile) return { status: 'HEALTHY', event: null };
  if (!reason) {
    await eventModel.updateMany?.(
      { userId, profileId, status: { $in: ['UNREAD', 'READ', 'OPEN', 'ACKNOWLEDGED'] } },
      { $set: { status: 'RESOLVED', resolvedAt: new Date() } },
    );
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
    fingerprint: fingerprint({ userId, recommendationId, reason }),
    monitorVersion: PLAN_HEALTH_MONITOR_VERSION,
  };
  const activeStatuses = ['UNREAD', 'READ', 'OPEN', 'ACKNOWLEDGED'];
  await eventModel.updateMany?.(
    { userId, profileId, fingerprint: { $ne: event.fingerprint }, status: { $in: activeStatuses } },
    { $set: { status: 'SUPERSEDED', supersededAt: event.detectedAt } },
  );
  try {
    const persisted = await eventModel.create(event);
    PrometheusMetrics.inc('plan_health_events_created_total');
    PrometheusMetrics.inc('plan_health_events_total');
    return { status: 'ATTENTION', event: persisted.toObject ? persisted.toObject() : persisted };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    PrometheusMetrics.inc('plan_health_events_deduplicated_total');
    const existing = await eventModel.findOne({ fingerprint: event.fingerprint }).lean();
    if (existing?.status === 'RESOLVED' || existing?.status === 'SUPERSEDED') {
      const reopened = await eventModel.findOneAndUpdate(
        { fingerprint: event.fingerprint },
        {
          $set: {
            status: 'UNREAD',
            detectedAt: event.detectedAt,
          },
          $unset: { acknowledgedAt: 1, resolvedAt: 1, supersededAt: 1 },
        },
        { new: true },
      ).lean();
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
