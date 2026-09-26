import PlanHealthEvent from '../models/PlanHealthEvent.js';
import PlanHealthSchedulerLease from '../models/PlanHealthSchedulerLease.js';
import AgentQueueAdmission from '../models/AgentQueueAdmission.js';
import AgentRun from '../models/AgentRun.js';
import { verifyPersistenceIndexes } from './persistenceIndexReadiness.js';

export const PHASE5_PLAN_HEALTH_INDEX_MODELS = Object.freeze([
  PlanHealthEvent,
  PlanHealthSchedulerLease,
  AgentQueueAdmission,
  AgentRun,
]);

function sameIndexKey(actual, expected) {
  return JSON.stringify(Object.entries(actual || {})) === JSON.stringify(Object.entries(expected));
}

export async function verifyPlanHealthPersistence({
  eventModel = PlanHealthEvent,
  leaseModel = PlanHealthSchedulerLease,
  admissionModel = AgentQueueAdmission,
  agentRunModel = AgentRun,
  force = false,
} = {}) {
  await verifyPersistenceIndexes({ models: [eventModel], force });
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
  let queueIndexes;
  try {
    queueIndexes = await agentRunModel.collection.indexes();
  } catch {
    throw Object.assign(new Error('PlanReview queue priority index is unavailable.'), {
      status: 503,
      code: 'PLAN_HEALTH_PERSISTENCE_UNAVAILABLE',
    });
  }
  if (!queueIndexes.some(index => sameIndexKey(index.key, { status: 1, priorityRank: 1, queuedAt: 1 }))) {
    throw Object.assign(new Error('Required numeric PlanReview queue priority index is unavailable.'), {
      status: 503,
      code: 'PLAN_HEALTH_PERSISTENCE_UNAVAILABLE',
    });
  }
  const unrankedQueueRecords = await agentRunModel.collection.countDocuments({ priorityRank: { $exists: false } }).catch(() => null);
  if (unrankedQueueRecords !== 0) {
    throw Object.assign(new Error('PlanReview queue priority migration is incomplete.'), {
      status: 503,
      code: 'PLAN_HEALTH_PERSISTENCE_UNAVAILABLE',
    });
  }
  const admissionState = await admissionModel.collection.findOne({ _id: 'plan-review' }).catch(() => null);
  if (!admissionState || !Number.isInteger(admissionState.epoch)) {
    throw Object.assign(new Error('PlanReview queue admission fence is unavailable.'), {
      status: 503,
      code: 'AGENT_QUEUE_ADMISSION_UNAVAILABLE',
    });
  }
  return { ready: true, verifiedAt: new Date().toISOString() };
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
  admissionModel = AgentQueueAdmission,
  agentRunModel = AgentRun,
} = {}) {
  await ensureCollection(eventModel);
  await ensureCollection(leaseModel);
  await ensureCollection(admissionModel);
  await ensureCollection(agentRunModel);
  await backfillLeaseState(leaseModel);
  await agentRunModel.collection.updateMany({ priorityRank: { $exists: false } }, [
    { $set: { priorityRank: { $cond: [{ $eq: ['$priority', 'PLAN_HEALTH_BACKGROUND'] }, 100, 0] } } },
  ]);
  await admissionModel.updateOne({ _id: 'plan-review' }, { $setOnInsert: { epoch: 0 } }, { upsert: true });
  await eventModel.createIndexes();
  await leaseModel.createIndexes();
  await agentRunModel.createIndexes();
  return verifyPlanHealthPersistence({ eventModel, leaseModel, admissionModel, agentRunModel, force: true });
}
