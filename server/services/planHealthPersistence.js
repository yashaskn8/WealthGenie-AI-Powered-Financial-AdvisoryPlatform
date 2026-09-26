import PlanHealthEvent from '../models/PlanHealthEvent.js';
import PlanHealthSchedulerLease from '../models/PlanHealthSchedulerLease.js';
import AgentQueueAdmission from '../models/AgentQueueAdmission.js';
import AgentRun from '../models/AgentRun.js';
import PlanHealthInspectionFence from '../models/PlanHealthInspectionFence.js';
import { verifyPersistenceIndexes } from './persistenceIndexReadiness.js';
import { planHealthEventFingerprint } from './planHealthMonitor.js';

const ACTIVE_EVENT_STATUSES = Object.freeze(['UNREAD', 'READ', 'OPEN', 'ACKNOWLEDGED']);
const EVENT_STATUSES = new Set([...ACTIVE_EVENT_STATUSES, 'RESOLVED', 'SUPERSEDED']);
const MAX_DUPLICATE_EVENT_GROUP_SIZE = 1000;

export const PHASE5_PLAN_HEALTH_INDEX_MODELS = Object.freeze([
  PlanHealthEvent,
  PlanHealthSchedulerLease,
  PlanHealthInspectionFence,
  AgentQueueAdmission,
  AgentRun,
]);

function sameIndexKey(actual, expected) {
  return JSON.stringify(Object.entries(actual || {})) === JSON.stringify(Object.entries(expected));
}

function persistenceUnavailable(message, code = 'PLAN_HEALTH_PERSISTENCE_UNAVAILABLE') {
  return Object.assign(new Error(message), { status: 503, code });
}

export async function verifyAgentRuntimePersistence({
  admissionModel = AgentQueueAdmission,
  agentRunModel = AgentRun,
  force = false,
} = {}) {
  await verifyPersistenceIndexes({ models: [agentRunModel], force });
  let queueIndexes;
  try {
    queueIndexes = await agentRunModel.collection.indexes();
  } catch {
    throw persistenceUnavailable('PlanReview queue priority index is unavailable.');
  }
  if (!queueIndexes.some(index => sameIndexKey(index.key, { status: 1, priorityRank: 1, queuedAt: 1 }))) {
    throw persistenceUnavailable('Required numeric PlanReview queue priority index is unavailable.');
  }
  let unrankedQueueRecords;
  try {
    unrankedQueueRecords = await agentRunModel.collection.countDocuments({ priorityRank: { $exists: false } });
  } catch {
    throw persistenceUnavailable('PlanReview queue priority migration state is unavailable.');
  }
  if (unrankedQueueRecords !== 0) {
    throw persistenceUnavailable('PlanReview queue priority migration is incomplete.');
  }
  let admissionState;
  try {
    admissionState = await admissionModel.collection.findOne({ _id: 'plan-review' });
  } catch {
    throw persistenceUnavailable('PlanReview queue admission fence is unavailable.', 'AGENT_QUEUE_ADMISSION_UNAVAILABLE');
  }
  if (!admissionState || !Number.isInteger(admissionState.epoch)) {
    throw persistenceUnavailable('PlanReview queue admission fence is unavailable.', 'AGENT_QUEUE_ADMISSION_UNAVAILABLE');
  }
  return { ready: true, verifiedAt: new Date().toISOString() };
}

export async function verifyPlanHealthPersistence({
  eventModel = PlanHealthEvent,
  leaseModel = PlanHealthSchedulerLease,
  fenceModel = PlanHealthInspectionFence,
  force = false,
} = {}) {
  await verifyPersistenceIndexes({ models: [eventModel, fenceModel], force });
  let indexes;
  try {
    indexes = await leaseModel.collection.indexes();
  } catch {
    throw Object.assign(new Error('Plan Health scheduler persistence indexes are unavailable.'), {
      status: 503,
      code: 'PLAN_HEALTH_PERSISTENCE_UNAVAILABLE',
    });
  }
  if (!indexes.some(index => sameIndexKey(index.key, { status: 1, leaseUntil: 1 }))) {
    throw Object.assign(new Error('Required Plan Health scheduler lease index is unavailable.'), {
      status: 503,
      code: 'PLAN_HEALTH_PERSISTENCE_UNAVAILABLE',
    });
  }
  let fenceIndexes;
  try {
    fenceIndexes = await fenceModel.collection.indexes();
  } catch {
    throw persistenceUnavailable('Plan Health inspection publication-fence indexes are unavailable.');
  }
  if (!fenceIndexes.some(index => sameIndexKey(index.key, { expiresAt: 1 }) && index.expireAfterSeconds === 0
      && index.name === 'ttl_plan_health_inspection_fences')) {
    throw persistenceUnavailable('Plan Health inspection publication-fence retention index is unavailable.');
  }
  return { ready: true, verifiedAt: new Date().toISOString() };
}

function eventIdentity(row) {
  const userId = row.userId == null ? null : String(row.userId);
  const profileId = row.profileId == null ? null : String(row.profileId);
  const recommendationId = row.recommendationId == null ? null : String(row.recommendationId);
  const reason = typeof row.reason === 'string' && row.reason.trim() ? row.reason : null;
  const monitorVersion = typeof row.monitorVersion === 'string' && row.monitorVersion.trim() ? row.monitorVersion : null;
  if (!userId || !profileId || !reason || !monitorVersion || !EVENT_STATUSES.has(row.status)) {
    throw persistenceUnavailable(
      'Legacy Plan Health event identity is ambiguous; operator reconciliation is required.',
      'PHASE5_PLAN_HEALTH_DUPLICATE_IDENTITY_AMBIGUOUS',
    );
  }
  return { userId, profileId, recommendationId, reason, monitorVersion };
}

function identityKey(identity) {
  return JSON.stringify(identity);
}

function activeWinner(rows) {
  const rank = { ACKNOWLEDGED: 0, OPEN: 1, READ: 2, UNREAD: 3 };
  return rows.filter(row => ACTIVE_EVENT_STATUSES.includes(row.status)).sort((left, right) => (
    rank[left.status] - rank[right.status]
    || new Date(left.acknowledgedAt || left.detectedAt || left.createdAt || 0).getTime()
      - new Date(right.acknowledgedAt || right.detectedAt || right.createdAt || 0).getTime()
    || String(left._id).localeCompare(String(right._id))
  ))[0] || null;
}

async function reconcileLegacyPlanHealthEvents(eventModel) {
  let indexes;
  try {
    indexes = await eventModel.collection.indexes();
  } catch (error) {
    if (error.code === 26 || error.codeName === 'NamespaceNotFound') indexes = [];
    else throw error;
  }
  for (const index of indexes) {
    const isFingerprintIndex = index.unique === true && sameIndexKey(index.key, { fingerprint: 1 });
    const hasActivePartial = JSON.stringify(index.partialFilterExpression || null)
      === JSON.stringify({ status: { $in: ACTIVE_EVENT_STATUSES } });
    if (isFingerprintIndex && (!hasActivePartial || index.name !== 'uniq_active_plan_health_fingerprint')) {
      await eventModel.collection.dropIndex(index.name);
    }
  }

  const cursor = eventModel.collection.find({}).sort({
    userId: 1,
    profileId: 1,
    recommendationId: 1,
    reason: 1,
    monitorVersion: 1,
    _id: 1,
  });
  let group = [];
  let groupKey = null;
  const migratedAt = new Date();
  const reconcileGroup = async () => {
    if (!group.length) return;
    const identity = eventIdentity(group[0]);
    const fingerprint = planHealthEventFingerprint(identity);
    const winner = group.length > 1 ? activeWinner(group) : null;
    for (const row of group) {
      const set = {};
      if (row.fingerprint !== fingerprint) set.fingerprint = fingerprint;
      if (winner && ACTIVE_EVENT_STATUSES.includes(row.status) && String(row._id) !== String(winner._id)) {
        set.status = 'SUPERSEDED';
        set.supersededAt = row.supersededAt || migratedAt;
      }
      if (Object.keys(set).length) {
        await eventModel.collection.updateOne({ _id: row._id }, { $set: set });
      }
    }
    group = [];
    groupKey = null;
  };

  for await (const row of cursor) {
    const identity = eventIdentity(row);
    const nextKey = identityKey(identity);
    if (groupKey !== null && nextKey !== groupKey) await reconcileGroup();
    groupKey = nextKey;
    group.push(row);
    if (group.length > MAX_DUPLICATE_EVENT_GROUP_SIZE) {
      throw persistenceUnavailable(
        'Legacy Plan Health duplicate group exceeds the safe migration bound; operator reconciliation is required.',
        'PHASE5_PLAN_HEALTH_DUPLICATE_IDENTITY_AMBIGUOUS',
      );
    }
  }
  await reconcileGroup();
}

async function ensureCollection(model) {
  try {
    await model.createCollection();
  } catch (error) {
    if (error.code !== 48 && error.codeName !== 'NamespaceExists') throw error;
  }
}

async function backfillLeaseState(leaseModel) {
  const cursor = leaseModel.collection.find({
    $or: [
      { status: { $exists: false } },
      { executionGeneration: { $exists: false } },
      { mutationFence: { $exists: false } },
      { usersScanned: { $exists: false } },
      { failureCount: { $exists: false } },
    ],
  });
  for await (const row of cursor) {
    const completed = row.completedAt != null;
    const status = completed ? 'COMPLETED' : (row.leaseUntil && row.leaseUntil > new Date() ? 'RUNNING' : 'FAILED');
    await leaseModel.collection.updateOne({ _id: row._id }, {
      $set: {
        status: row.status || status,
        executionGeneration: Number.isInteger(row.executionGeneration) ? row.executionGeneration : 0,
        mutationFence: Number.isInteger(row.mutationFence) ? row.mutationFence : 0,
        cursor: row.cursor || null,
        usersScanned: Number.isFinite(row.usersScanned) ? row.usersScanned : 0,
        eventsCreated: Number.isFinite(row.eventsCreated) ? row.eventsCreated : 0,
        failureCount: Number.isFinite(row.failureCount) ? row.failureCount : 0,
        startedAt: row.startedAt || row.updatedAt || row.createdAt || null,
        lastHeartbeatAt: row.lastHeartbeatAt || row.updatedAt || null,
        leaseUntil: completed ? null : (row.leaseUntil || null),
      },
    });
  }
}

/** Explicit deployment migration. Worker startup only calls the read-only verifier. */
export async function migratePlanHealthPersistence({
  eventModel = PlanHealthEvent,
  leaseModel = PlanHealthSchedulerLease,
  fenceModel = PlanHealthInspectionFence,
  admissionModel = AgentQueueAdmission,
  agentRunModel = AgentRun,
} = {}) {
  await ensureCollection(eventModel);
  await ensureCollection(leaseModel);
  await ensureCollection(fenceModel);
  await ensureCollection(admissionModel);
  await ensureCollection(agentRunModel);
  await backfillLeaseState(leaseModel);
  await agentRunModel.collection.updateMany({ priorityRank: { $exists: false } }, [
    { $set: { priorityRank: { $cond: [{ $eq: ['$priority', 'PLAN_HEALTH_BACKGROUND'] }, 100, 0] } } },
  ]);
  await admissionModel.updateOne({ _id: 'plan-review' }, { $setOnInsert: { epoch: 0 } }, { upsert: true });
  await reconcileLegacyPlanHealthEvents(eventModel);
  await eventModel.createIndexes();
  await leaseModel.createIndexes();
  await fenceModel.createIndexes();
  await agentRunModel.createIndexes();
  const [planHealth, agentRuntime] = await Promise.all([
    verifyPlanHealthPersistence({ eventModel, leaseModel, fenceModel, force: true }),
    verifyAgentRuntimePersistence({ admissionModel, agentRunModel, force: true }),
  ]);
  return { ready: planHealth.ready && agentRuntime.ready, verifiedAt: planHealth.verifiedAt };
}
