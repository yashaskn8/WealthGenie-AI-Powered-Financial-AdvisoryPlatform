import crypto from 'node:crypto';
import { Role, TaskState } from '@a2a-js/sdk';
import ResearchTask from '../models/ResearchTask.js';
import ResearchTaskCapacity from '../models/ResearchTaskCapacity.js';
import { unwrapMongoDocument } from './mongoResult.js';
import { assertVerifiedAgentIdentity } from '../agents/identity/agentIdentityVerifier.js';
import { validateResearchBrief } from '../agents/research/researchSchemas.js';
import {
  DEFAULT_RESEARCH_AGENT_MAX_ACTIVE_TASKS,
  MongoResearchTaskCapacity,
} from './researchTaskCapacity.js';

const TERMINAL_STATES = new Set([
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_COMPLETED,
]);
const MAX_TASK_BYTES = 2_000_000;
const MAX_CAS_ATTEMPTS = 8;
const DEFAULT_EXECUTION_LEASE_MS = 30_000;
const MAX_EXECUTION_LEASE_MS = 120_000;
const CAPACITY_LEASE_SAFETY_MS = 1_000;
export const RESEARCH_SEMANTIC_DEDUPE_TTL_MS = 10 * 60 * 1000;

function taskStoreError(code, message) {
  return Object.assign(new Error(message), { code, status: code === 'A2A_TASK_STORE_UNAVAILABLE' ? 503 : 409 });
}

function ownerKey(context, env) {
  const identity = context?.user?.identity;
  try { assertVerifiedAgentIdentity(identity, { allowDevelopment: true, env }); } catch {
    throw taskStoreError('A2A_TASK_IDENTITY_REQUIRED', 'A verified A2A caller identity is required for task storage.');
  }
  if (identity.agentType !== 'PLAN_REVIEW') {
    throw taskStoreError('A2A_TASK_IDENTITY_DENIED', 'This agent identity cannot access ResearchAgent tasks.');
  }
  return crypto.createHash('sha256')
    .update(JSON.stringify([identity.provider, identity.issuer || '', identity.subject, identity.agentType]))
    .digest('hex');
}

function clone(value) {
  return structuredClone(value);
}

function statusTimestamp(task) {
  const value = task?.status?.timestamp;
  const parsed = value ? new Date(value) : null;
  if (!parsed || !Number.isFinite(parsed.getTime())) {
    throw taskStoreError('A2A_TASK_INVALID', 'Research task must carry a valid status timestamp.');
  }
  return parsed;
}

function chooseStatus(existing, incoming) {
  if (TERMINAL_STATES.has(existing?.state)) return existing;
  if (TERMINAL_STATES.has(incoming?.state)) return incoming;
  const oldTime = Date.parse(existing?.timestamp || '');
  const newTime = Date.parse(incoming?.timestamp || '');
  if (!Number.isFinite(oldTime)) return incoming;
  if (!Number.isFinite(newTime)) return existing;
  return newTime >= oldTime ? incoming : existing;
}

function mergeById(existing = [], incoming = [], key) {
  const merged = new Map();
  for (const item of existing) if (item?.[key]) merged.set(item[key], clone(item));
  for (const item of incoming) if (item?.[key]) merged.set(item[key], clone(item));
  return [...merged.values()];
}

export function mergeResearchTask(existing, incoming) {
  if (existing.id !== incoming.id || existing.contextId !== incoming.contextId) {
    throw taskStoreError('A2A_TASK_IDENTITY_CONFLICT', 'Research task identity cannot change after creation.');
  }
  const status = chooseStatus(existing.status, incoming.status);
  return {
    ...clone(existing),
    ...clone(incoming),
    id: existing.id,
    contextId: existing.contextId,
    status: clone(status),
    history: mergeById(existing.history, incoming.history, 'messageId'),
    artifacts: mergeById(existing.artifacts, incoming.artifacts, 'artifactId'),
  };
}

function duplicateKey(error) {
  return error?.code === 11000 || error?.codeName === 'DuplicateKey';
}

function encodeCursor(task) {
  return Buffer.from(`${task.status?.timestamp || ''}|${task.id}`).toString('base64');
}

function decodeCursor(token) {
  if (!token) return null;
  if (typeof token !== 'string' || token.length > 512 || !/^[A-Za-z0-9+/]+={0,2}$/.test(token)) {
    throw taskStoreError('A2A_TASK_PAGE_TOKEN_INVALID', 'Research task page token is invalid.');
  }
  let decoded;
  try { decoded = Buffer.from(token, 'base64').toString('utf8'); } catch {
    throw taskStoreError('A2A_TASK_PAGE_TOKEN_INVALID', 'Research task page token is invalid.');
  }
  if (Buffer.from(decoded).toString('base64').replace(/=+$/, '') !== token.replace(/=+$/, '')) {
    throw taskStoreError('A2A_TASK_PAGE_TOKEN_INVALID', 'Research task page token is invalid.');
  }
  const separator = decoded.indexOf('|');
  if (separator < 0 || !decoded.slice(separator + 1)) {
    throw taskStoreError('A2A_TASK_PAGE_TOKEN_INVALID', 'Research task page token is invalid.');
  }
  return { timestamp: decoded.slice(0, separator), taskId: decoded.slice(separator + 1) };
}

function firstUserMessageId(task) {
  return task?.history?.find(message => message?.role === Role.ROLE_USER && typeof message.messageId === 'string')?.messageId || null;
}

function firstResearchBrief(task) {
  const message = task?.history?.find(item => item?.role === Role.ROLE_USER);
  const part = message?.parts?.find(item => ['data', 'json'].includes(item?.content?.$case));
  return part?.content?.value || null;
}

function normalizeBriefText(value) {
  return String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function canonicalResearchValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalResearchValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalResearchValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function researchRequestFingerprint(value) {
  const validation = validateResearchBrief(value);
  if (validation.error) throw taskStoreError('A2A_TASK_INVALID', 'Research task request is not a valid ResearchBrief.');
  const brief = validation.value;
  const canonical = {
    fingerprintVersion: 'research-brief-semantic-v1',
    topic: normalizeBriefText(brief.topic),
    question: normalizeBriefText(brief.question),
    jurisdiction: brief.jurisdiction.trim().toUpperCase(),
    // Keep the semantic UTC day but discard transport-generated time precision.
    // Distinct historical dates must not alias; repeated current requests on
    // the same day should not differ just because createResearchBrief ran later.
    asOf: new Date(brief.asOf).toISOString().slice(0, 10),
    requestedFactTypes: [...brief.requestedFactTypes].map(normalizeBriefText).sort(),
    instrumentCategories: [...brief.instrumentCategories].map(normalizeBriefText).sort(),
    regulatoryContext: {
      policyVersion: brief.regulatoryContext.policyVersion,
      sourcePolicyVersion: brief.regulatoryContext.sourcePolicyVersion,
      notes: normalizeBriefText(brief.regulatoryContext.notes),
    },
    knownEvidenceIds: [...brief.knownEvidenceIds].sort(),
    knownSourceDates: [...brief.knownSourceDates]
      .map(({ sourceId, date }) => ({ sourceId, date }))
      .sort((left, right) => `${left.sourceId}:${left.date}`.localeCompare(`${right.sourceId}:${right.date}`)),
    freshnessRequirement: brief.freshnessRequirement,
    maxResearchDepth: brief.maxResearchDepth,
  };
  return crypto.createHash('sha256').update(canonicalResearchValue(canonical)).digest('hex');
}

function includesUnseenUserMessage(existingTask, incomingTask) {
  const existingIds = new Set((existingTask?.history || []).map(message => message?.messageId).filter(Boolean));
  return (incomingTask?.history || []).some(message => (
    message?.role === Role.ROLE_USER && message.messageId && !existingIds.has(message.messageId)
  ));
}

function validateTask(task) {
  if (!task?.id || typeof task.id !== 'string' || task.id.length > 160
      || !task.contextId || typeof task.contextId !== 'string' || task.contextId.length > 160
      || !Number.isInteger(task.status?.state)) {
    throw taskStoreError('A2A_TASK_INVALID', 'Research task identity or state is invalid.');
  }
  const serialized = JSON.stringify(task);
  if (Buffer.byteLength(serialized) > MAX_TASK_BYTES) {
    throw taskStoreError('A2A_TASK_TOO_LARGE', 'Research task exceeds the durable storage limit.');
  }
  return statusTimestamp(task);
}

function validateLeaseMs(leaseMs) {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > MAX_EXECUTION_LEASE_MS) {
    throw taskStoreError('A2A_TASK_LEASE_CONFIGURATION_INVALID', 'Research task execution lease duration is invalid.');
  }
  return leaseMs;
}

function leaseClaimUpdate(leaseToken, leaseExpiresAt, messageId) {
  const set = {
    executionLeaseToken: { $literal: leaseToken },
    executionCapacityToken: { $literal: leaseToken },
    executionLeaseExpiresAt: { $literal: leaseExpiresAt },
    executionFence: { $add: [{ $ifNull: ['$executionFence', 0] }, 1] },
    revision: { $add: [{ $ifNull: ['$revision', 0] }, 1] },
  };
  const firstUserMessageIdExpression = {
    $arrayElemAt: [{
      $map: {
        input: {
          $filter: {
            input: { $ifNull: ['$task.history', []] },
            as: 'message',
            cond: { $eq: ['$$message.role', Role.ROLE_USER] },
          },
        },
        as: 'message',
        in: '$$message.messageId',
      },
    }, 0],
  };
  set.executionMessageId = { $ifNull: ['$executionMessageId', messageId ? { $literal: messageId } : firstUserMessageIdExpression] };
  return [{ $set: set }];
}

function activeLeaseExpression(operator) {
  return { $expr: { [operator]: ['$executionLeaseExpiresAt', '$$NOW'] } };
}

async function atomicFindOneAndUpdate(model, filter, update, options = {}) {
  if (typeof model.collection?.findOneAndUpdate === 'function') {
    const result = await model.collection.findOneAndUpdate(filter, update, {
      returnDocument: 'after',
      ...options,
    });
    return unwrapMongoDocument(result);
  }
  let query = model.findOneAndUpdate(filter, update, { new: true, lean: true, ...options });
  if (typeof query.lean === 'function') query = query.lean();
  return query;
}

export class MongoResearchTaskStore {
  constructor({
    model = ResearchTask,
    capacityModel = ResearchTaskCapacity,
    env = process.env,
    maxCasAttempts = MAX_CAS_ATTEMPTS,
    leaseMs = DEFAULT_EXECUTION_LEASE_MS,
    maxActiveTasks = DEFAULT_RESEARCH_AGENT_MAX_ACTIVE_TASKS,
  } = {}) {
    this.model = model;
    this.env = env;
    this.maxCasAttempts = Math.max(1, Math.min(16, Number(maxCasAttempts) || MAX_CAS_ATTEMPTS));
    this.leaseMs = validateLeaseMs(Number(leaseMs));
    this.capacity = new MongoResearchTaskCapacity({ model: capacityModel, maxActiveTasks });
    this.activeLeases = new Map();
    this.durable = true;
  }

  async findSemanticDuplicate(owner, fingerprint) {
    if (!fingerprint) return null;
    let existing;
    try {
      existing = await this.model.findOne({ ownerKey: owner, requestFingerprint: fingerprint, activeDedupe: true }).lean();
    } catch {
      throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task deduplication state is unavailable.');
    }
    if (!existing) return null;
    if (!TERMINAL_STATES.has(existing.statusState)) return existing;
    if (existing.statusState === TaskState.TASK_STATE_COMPLETED) {
      try {
        const stillReusable = await this.model.findOne({
          _id: existing._id,
          activeDedupe: true,
          $expr: { $gt: ['$dedupeExpiresAt', '$$NOW'] },
        }).lean();
        if (stillReusable) return existing;
      } catch {
        throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task deduplication state is unavailable.');
      }
    }
    try {
      await atomicFindOneAndUpdate(this.model, {
        _id: existing._id,
        revision: existing.revision,
        activeDedupe: true,
        requestFingerprint: fingerprint,
      }, { $set: { activeDedupe: false }, $inc: { revision: 1 } });
    } catch {
      throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Expired research task deduplication state could not be retired.');
    }
    return null;
  }

  async prepareAndClaim(task, context, { messageId, leaseMs = this.leaseMs, allowSemanticDeduplication = true } = {}) {
    const owner = ownerKey(context, this.env);
    const timestamp = validateTask(task);
    validateLeaseMs(leaseMs);
    if (TERMINAL_STATES.has(task.status.state)) {
      throw taskStoreError('A2A_TASK_TERMINAL', 'A terminal ResearchAgent task cannot be executed again.');
    }
    const requestFingerprint = allowSemanticDeduplication ? researchRequestFingerprint(firstResearchBrief(task)) : null;
    let existing;
    try { existing = await this.model.findOne({ taskId: task.id }).lean(); } catch {
      throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task storage is unavailable.');
    }
    if (!existing && requestFingerprint) {
      const duplicate = await this.findSemanticDuplicate(owner, requestFingerprint);
      if (duplicate) return { semanticDuplicateTaskId: duplicate.taskId, requestFingerprint };
    }
    if (!existing) {
      try {
        await this.model.create({
          taskId: task.id,
          ownerKey: owner,
          agentType: 'PLAN_REVIEW',
          contextId: task.contextId,
          statusState: task.status.state,
          statusTimestamp: timestamp,
          revision: 0,
          executionFence: 0,
          executionMessageId: firstUserMessageId(task) || messageId || undefined,
          ...(requestFingerprint ? { requestFingerprint, activeDedupe: true } : {}),
          task: clone(task),
        });
      } catch (error) {
        if (!duplicateKey(error)) throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task storage is unavailable.');
        try { existing = await this.model.findOne({ taskId: task.id }).lean(); } catch {
          throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task storage is unavailable.');
        }
        if (!existing && requestFingerprint) {
          const duplicate = await this.findSemanticDuplicate(owner, requestFingerprint);
          if (duplicate) return { semanticDuplicateTaskId: duplicate.taskId, requestFingerprint };
        }
        if (!existing) throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task could not be created or deduplicated.');
      }
    }
    try { existing = await this.model.findOne({ taskId: task.id }).lean(); } catch {
      throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task storage is unavailable.');
    }
    if (!existing) throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task was not visible after creation.');
    if (existing.ownerKey !== owner) throw taskStoreError('A2A_TASK_OWNER_CONFLICT', 'Research task is owned by another authenticated agent.');
    if (existing.contextId !== task.contextId) throw taskStoreError('A2A_TASK_IDENTITY_CONFLICT', 'Research task context cannot change after creation.');
    const persistedMessageId = existing.executionMessageId || firstUserMessageId(existing.task);
    if (persistedMessageId && messageId && persistedMessageId !== messageId) {
      throw taskStoreError('A2A_TASK_MESSAGE_CONFLICT', 'A ResearchAgent task is bound to its original input message.');
    }
    return this.claimExecution(task.id, context, { messageId, leaseMs });
  }

  async createSemanticReplay({ task, context, sourceTaskId, requestFingerprint }) {
    const owner = ownerKey(context, this.env);
    const timestamp = validateTask(task);
    if (task.status.state !== TaskState.TASK_STATE_COMPLETED
        || researchRequestFingerprint(firstResearchBrief(task)) !== requestFingerprint
        || !(task.artifacts || []).length) {
      throw taskStoreError('A2A_TASK_SEMANTIC_REPLAY_INVALID', 'A semantic ResearchAgent replay is not correctly bound.');
    }
    let session;
    try { session = await this.model.db.startSession(); } catch {
      throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task replay persistence requires Mongo transactions.');
    }
    try {
      let created = false;
      await session.withTransaction(async () => {
        const source = await this.model.findOne({
          taskId: sourceTaskId,
          ownerKey: owner,
          requestFingerprint,
          activeDedupe: true,
          statusState: TaskState.TASK_STATE_COMPLETED,
          $expr: { $gt: ['$dedupeExpiresAt', '$$NOW'] },
        }).session(session).lean();
        if (!source) return;
        await this.model.create([{
          taskId: task.id,
          ownerKey: owner,
          agentType: 'PLAN_REVIEW',
          contextId: task.contextId,
          statusState: task.status.state,
          statusTimestamp: timestamp,
          revision: 0,
          executionFence: 0,
          executionMessageId: firstUserMessageId(task) || undefined,
          deduplicatedFromTaskId: sourceTaskId,
          task: clone(task),
        }], { session });
        created = true;
      });
      if (!created) return null;
      return clone(task);
    } catch (error) {
      if (duplicateKey(error)) {
        const existing = await this.model.findOne({ taskId: task.id, ownerKey: owner, deduplicatedFromTaskId: sourceTaskId }).lean();
        if (existing?.task) return clone(existing.task);
      }
      throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Semantic ResearchAgent replay could not be persisted.');
    } finally {
      await session.endSession();
    }
  }

  async retireSemanticDeduplication(sourceTaskId, context, requestFingerprint) {
    const owner = ownerKey(context, this.env);
    try {
      await atomicFindOneAndUpdate(this.model, {
        taskId: sourceTaskId,
        ownerKey: owner,
        requestFingerprint,
        activeDedupe: true,
      }, { $set: { activeDedupe: false }, $unset: { dedupeExpiresAt: 1 }, $inc: { revision: 1 } });
    } catch {
      throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task deduplication state could not be retired.');
    }
  }

  async claimExecution(taskId, context, { messageId, leaseMs = this.leaseMs } = {}) {
    const owner = ownerKey(context, this.env);
    validateLeaseMs(leaseMs);
    let candidate;
    try { candidate = await this.model.findOne({ taskId, ownerKey: owner }).lean(); } catch {
      throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task execution claim is unavailable.');
    }
    if (!candidate) return null;
    return this.claimTaskRecord(candidate, { messageId, leaseMs });
  }

  async claimTaskRecord(candidate, { messageId, leaseMs = this.leaseMs } = {}) {
    validateLeaseMs(leaseMs);
    if (!candidate || TERMINAL_STATES.has(candidate.statusState)) return null;
    const token = crypto.randomUUID();
    const fence = Number(candidate.executionFence || 0) + 1;
    let capacityAcquired;
    try {
      capacityAcquired = await this.capacity.acquire({
        taskId: candidate.taskId,
        ownerKey: candidate.ownerKey,
        token,
        fence,
        leaseMs: leaseMs + CAPACITY_LEASE_SAFETY_MS,
      });
    } catch (error) {
      if (error.code === 'RESEARCH_TASK_CAPACITY_UNAVAILABLE') throw error;
      throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task distributed capacity is unavailable.');
    }
    if (!capacityAcquired.acquired) {
      if (capacityAcquired.sameTaskHeld) return null;
      return { capacityUnavailable: true, task: clone(candidate.task) };
    }
    const capacityExpiresAt = new Date(capacityAcquired.expiresAt);
    const taskLeaseExpiresAt = new Date(capacityExpiresAt.getTime() - CAPACITY_LEASE_SAFETY_MS);
    if (!Number.isFinite(capacityExpiresAt.getTime())) {
      await this.capacity.release({ taskId: candidate.taskId, ownerKey: candidate.ownerKey, token, fence }).catch(() => {});
      throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task capacity lease expiry is invalid.');
    }
    let claimed;
    try {
      claimed = await atomicFindOneAndUpdate(this.model, {
        _id: candidate._id,
        taskId: candidate.taskId,
        ownerKey: candidate.ownerKey,
        revision: candidate.revision,
        executionFence: Number(candidate.executionFence || 0),
        statusState: { $in: [TaskState.TASK_STATE_SUBMITTED, TaskState.TASK_STATE_WORKING] },
        $expr: { $and: [
          { $lte: [{ $ifNull: ['$executionLeaseExpiresAt', new Date(0)] }, '$$NOW'] },
          { $gt: [{ $literal: taskLeaseExpiresAt }, '$$NOW'] },
        ] },
      }, leaseClaimUpdate(token, taskLeaseExpiresAt, messageId));
    } catch {
      await this.capacity.release({ taskId: candidate.taskId, ownerKey: candidate.ownerKey, token, fence }).catch(() => {});
      throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task execution claim is unavailable.');
    }
    if (!claimed) {
      await this.capacity.release({ taskId: candidate.taskId, ownerKey: candidate.ownerKey, token, fence }).catch(() => {});
      return null;
    }
    const lease = {
      token,
      fence: claimed.executionFence,
      ownerKey: claimed.ownerKey,
      messageId: claimed.executionMessageId || firstUserMessageId(claimed.task),
    };
    if (!Number.isSafeInteger(lease.fence) || lease.fence < 1 || !lease.messageId) {
      await atomicFindOneAndUpdate(this.model, {
        _id: candidate._id,
        taskId: candidate.taskId,
        ownerKey: candidate.ownerKey,
        executionLeaseToken: token,
        executionFence: lease.fence,
      }, {
        $unset: { executionLeaseToken: 1, executionLeaseExpiresAt: 1, executionCapacityToken: 1 },
        $inc: { executionFence: 1, revision: 1 },
      }).catch(() => null);
      await this.capacity.release({ taskId: candidate.taskId, ownerKey: candidate.ownerKey, token, fence: lease.fence }).catch(() => {});
      throw taskStoreError('A2A_TASK_RECOVERY_INPUT_UNAVAILABLE', 'Research task execution input is unavailable.');
    }
    this.activeLeases.set(candidate.taskId, lease);
    return { task: clone(claimed.task), lease };
  }

  forgetExecutionLease(taskId, lease) {
    if (this.activeLeases.get(taskId)?.token === lease?.token
        && this.activeLeases.get(taskId)?.fence === lease?.fence) this.activeLeases.delete(taskId);
  }

  async claimNextRecoverable({ leaseMs = this.leaseMs } = {}) {
    validateLeaseMs(leaseMs);
    const now = new Date();
    let candidates;
    try {
      candidates = await this.model.find({
        statusState: { $in: [TaskState.TASK_STATE_SUBMITTED, TaskState.TASK_STATE_WORKING] },
        $or: [
          { executionLeaseExpiresAt: { $exists: false } },
          { executionLeaseExpiresAt: null },
          { executionLeaseExpiresAt: { $lte: now } },
        ],
      }).sort({ statusState: 1, executionLeaseExpiresAt: 1, createdAt: 1, taskId: 1 }).limit(16).lean();
    } catch {
      throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task recovery claim is unavailable.');
    }
    for (const candidate of candidates) {
      const claim = await this.claimTaskRecord(candidate, { leaseMs });
      if (!claim || claim.capacityUnavailable) continue;
      const { task, lease } = claim;
      if (!Number.isSafeInteger(lease.fence) || lease.fence < 1 || !lease.messageId) {
        const failedTask = clone(task);
        failedTask.status = {
          state: TaskState.TASK_STATE_FAILED,
          timestamp: new Date().toISOString(),
          message: { role: Role.ROLE_AGENT, messageId: crypto.randomUUID(), taskId: failedTask.id, contextId: failedTask.contextId, parts: [{ content: { $case: 'text', value: 'Research recovery failed closed: A2A_TASK_RECOVERY_INPUT_UNAVAILABLE.' }, mediaType: 'text/plain', filename: '', metadata: {} }], metadata: {}, extensions: [], referenceTaskIds: [] },
        };
        await this.saveClaimed(failedTask, lease);
        continue;
      }
      return { task, taskId: candidate.taskId, lease };
    }
    return null;
  }

  async renewExecutionLease(taskId, context, lease, { leaseMs = this.leaseMs } = {}) {
    const owner = ownerKey(context, this.env);
    validateLeaseMs(leaseMs);
    try {
      const capacityExpiresAt = await this.capacity.renew({ taskId, ownerKey: owner, token: lease?.token, fence: lease?.fence, leaseMs: leaseMs + CAPACITY_LEASE_SAFETY_MS });
      if (!capacityExpiresAt) return false;
      const taskLeaseExpiresAt = new Date(new Date(capacityExpiresAt).getTime() - CAPACITY_LEASE_SAFETY_MS);
      const updated = await atomicFindOneAndUpdate(this.model, {
        taskId,
        ownerKey: owner,
        executionCapacityToken: lease?.token,
        executionLeaseToken: lease?.token,
        executionFence: lease?.fence,
        statusState: { $nin: [...TERMINAL_STATES] },
        $expr: { $and: [
          { $gt: ['$executionLeaseExpiresAt', '$$NOW'] },
          { $gt: [{ $literal: taskLeaseExpiresAt }, '$$NOW'] },
        ] },
      }, [{ $set: { executionLeaseExpiresAt: { $literal: taskLeaseExpiresAt } } }]);
      return Boolean(updated);
    } catch {
      throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task execution lease renewal is unavailable.');
    }
  }

  async renewClaimedExecutionLease(taskId, lease, { leaseMs = this.leaseMs } = {}) {
    validateLeaseMs(leaseMs);
    try {
      const capacityExpiresAt = await this.capacity.renew({ taskId, ownerKey: lease?.ownerKey, token: lease?.token, fence: lease?.fence, leaseMs: leaseMs + CAPACITY_LEASE_SAFETY_MS });
      if (!capacityExpiresAt) return false;
      const taskLeaseExpiresAt = new Date(new Date(capacityExpiresAt).getTime() - CAPACITY_LEASE_SAFETY_MS);
      const updated = await atomicFindOneAndUpdate(this.model, {
        taskId,
        ...(lease?.ownerKey ? { ownerKey: lease.ownerKey } : {}),
        executionCapacityToken: lease?.token,
        executionLeaseToken: lease?.token,
        executionFence: lease?.fence,
        statusState: { $nin: [...TERMINAL_STATES] },
        $expr: { $and: [
          { $gt: ['$executionLeaseExpiresAt', '$$NOW'] },
          { $gt: [{ $literal: taskLeaseExpiresAt }, '$$NOW'] },
        ] },
      }, [{ $set: { executionLeaseExpiresAt: { $literal: taskLeaseExpiresAt } } }]);
      return Boolean(updated);
    } catch {
      throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task execution lease renewal is unavailable.');
    }
  }

  async releaseExecutionLease(taskId, context, lease) {
    const owner = ownerKey(context, this.env);
    try {
      const released = await atomicFindOneAndUpdate(this.model, {
        taskId,
        ownerKey: owner,
        executionLeaseToken: lease?.token,
        executionFence: lease?.fence,
        statusState: { $nin: [...TERMINAL_STATES] },
      }, { $unset: { executionLeaseToken: 1, executionLeaseExpiresAt: 1, executionCapacityToken: 1 }, $inc: { executionFence: 1, revision: 1 } });
      if (released) await this.capacity.release({ taskId, ownerKey: owner, token: lease?.token, fence: lease?.fence });
    } catch {
      throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task execution lease release is unavailable.');
    } finally {
      if (this.activeLeases.get(taskId)?.token === lease?.token) this.activeLeases.delete(taskId);
    }
  }

  async saveClaimed(task, lease) {
    validateTask(task);
    for (let attempt = 0; attempt < this.maxCasAttempts; attempt += 1) {
      let existing;
      try { existing = await this.model.findOne({
        taskId: task.id,
        ...(lease?.ownerKey ? { ownerKey: lease.ownerKey } : {}),
        executionCapacityToken: lease?.token,
        executionLeaseToken: lease?.token,
        executionFence: lease?.fence,
      }).lean(); } catch {
        throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task storage is unavailable.');
      }
      if (!existing) throw taskStoreError('A2A_TASK_EXECUTION_LEASE_LOST', 'Research task execution lease is no longer current.');
      if (TERMINAL_STATES.has(existing.statusState)) return;
      const merged = mergeResearchTask(existing.task, task);
      const update = {
        $set: { task: merged, statusState: merged.status.state, statusTimestamp: statusTimestamp(merged), updatedAt: new Date() },
        $inc: { revision: 1 },
      };
      if (TERMINAL_STATES.has(merged.status.state)) {
        update.$unset = { executionLeaseToken: 1, executionLeaseExpiresAt: 1, executionCapacityToken: 1 };
        if (existing.requestFingerprint) {
          if (merged.status.state === TaskState.TASK_STATE_COMPLETED) {
            update.$set.activeDedupe = true;
            update.$set.dedupeExpiresAt = new Date(Date.now() + RESEARCH_SEMANTIC_DEDUPE_TTL_MS);
          } else {
            update.$set.activeDedupe = false;
            update.$unset.dedupeExpiresAt = 1;
          }
        }
      }
      try {
        const saved = await atomicFindOneAndUpdate(this.model, {
          _id: existing._id,
          ownerKey: existing.ownerKey,
          revision: existing.revision,
          executionCapacityToken: lease.token,
          executionLeaseToken: lease.token,
          executionFence: lease.fence,
          statusState: { $nin: [...TERMINAL_STATES] },
          ...activeLeaseExpression('$gt'),
        }, update);
        if (saved) {
          if (TERMINAL_STATES.has(merged.status.state)) {
            this.activeLeases.delete(task.id);
            await this.capacity.release({ taskId: task.id, ownerKey: lease.ownerKey || existing.ownerKey, token: lease.token, fence: lease.fence }).catch(() => {});
          }
          return;
        }
      } catch {
        throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task storage is unavailable.');
      }
    }
    throw taskStoreError('A2A_TASK_EXECUTION_LEASE_LOST', 'Research task changed before the execution result could be committed.');
  }

  async save(task, context) {
    const owner = ownerKey(context, this.env);
    const timestamp = validateTask(task);
    for (let attempt = 0; attempt < this.maxCasAttempts; attempt += 1) {
      let existing;
      try { existing = await this.model.findOne({ taskId: task.id }).lean(); } catch {
        throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task storage is unavailable.');
      }
      if (!existing) {
        try {
          await this.model.create({
            taskId: task.id,
            ownerKey: owner,
            agentType: 'PLAN_REVIEW',
            contextId: task.contextId,
            statusState: task.status.state,
            statusTimestamp: timestamp,
            revision: 0,
            task: clone(task),
          });
          return;
        } catch (error) {
          if (duplicateKey(error)) continue;
          throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task storage is unavailable.');
        }
      }
      if (existing.ownerKey !== owner) throw taskStoreError('A2A_TASK_OWNER_CONFLICT', 'Research task is owned by another authenticated agent.');
      if (existing.contextId !== task.contextId) throw taskStoreError('A2A_TASK_IDENTITY_CONFLICT', 'Research task context cannot change after creation.');
      if (TERMINAL_STATES.has(existing.statusState)) return;
      const canceled = task.status.state === TaskState.TASK_STATE_CANCELED;
      const localLease = this.activeLeases.get(task.id);
      const rowHasLease = Boolean(existing.executionLeaseToken);
      const existingInputMessageId = existing.executionMessageId || firstUserMessageId(existing.task);
      if (!canceled && existingInputMessageId && includesUnseenUserMessage(existing.task, task)) {
        throw taskStoreError('A2A_TASK_MESSAGE_CONFLICT', 'A ResearchAgent task is bound to its original input message.');
      }
      if (!canceled && rowHasLease && (!localLease
          || localLease.token !== existing.executionLeaseToken
          || localLease.fence !== existing.executionFence)) {
        throw taskStoreError('A2A_TASK_EXECUTION_LEASE_HELD', 'Research task is executing on another worker.');
      }
      if (!canceled && localLease && (!rowHasLease
          || localLease.token !== existing.executionLeaseToken
          || localLease.fence !== existing.executionFence)) {
        throw taskStoreError('A2A_TASK_EXECUTION_LEASE_LOST', 'Research task execution lease is no longer current.');
      }
      if (!canceled && existing.statusState === TaskState.TASK_STATE_WORKING
          && includesUnseenUserMessage(existing.task, task)) {
        throw taskStoreError('A2A_TASK_ALREADY_WORKING', 'A working ResearchAgent task cannot accept another message.');
      }
      const merged = mergeResearchTask(existing.task, task);
      const update = {
        $set: { task: merged, statusState: merged.status.state, statusTimestamp: statusTimestamp(merged), updatedAt: new Date() },
        $inc: { revision: 1 },
      };
      if (canceled) {
        update.$unset = { executionLeaseToken: 1, executionLeaseExpiresAt: 1, executionCapacityToken: 1 };
        update.$inc.executionFence = 1;
        if (existing.requestFingerprint) {
          update.$set.activeDedupe = false;
          update.$unset.dedupeExpiresAt = 1;
        }
      } else if (TERMINAL_STATES.has(merged.status.state)) {
        update.$unset = { executionLeaseToken: 1, executionLeaseExpiresAt: 1, executionCapacityToken: 1 };
        if (existing.requestFingerprint) {
          if (merged.status.state === TaskState.TASK_STATE_COMPLETED) {
            update.$set.activeDedupe = true;
            update.$set.dedupeExpiresAt = new Date(Date.now() + RESEARCH_SEMANTIC_DEDUPE_TTL_MS);
          } else {
            update.$set.activeDedupe = false;
            update.$unset.dedupeExpiresAt = 1;
          }
        }
      }
      const filter = { _id: existing._id, ownerKey: owner, revision: existing.revision, statusState: { $nin: [...TERMINAL_STATES] } };
      if (!canceled && rowHasLease) {
        filter.executionLeaseToken = localLease.token;
        filter.executionFence = localLease.fence;
        filter.$expr = { $gt: ['$executionLeaseExpiresAt', '$$NOW'] };
      }
      try {
        const updated = await atomicFindOneAndUpdate(this.model, filter, update);
        if (updated) {
          if (canceled || TERMINAL_STATES.has(merged.status.state)) {
            this.activeLeases.delete(task.id);
            const token = existing.executionLeaseToken;
            if (token) await this.capacity.release({ taskId: task.id, token, fence: existing.executionFence }).catch(() => {});
          }
          return;
        }
      } catch {
        throw taskStoreError('A2A_TASK_STORE_UNAVAILABLE', 'Research task storage is unavailable.');
      }
    }
    throw taskStoreError('A2A_TASK_STATE_CONFLICT', 'Research task changed concurrently; retry from the latest task state.');
  }

  async load(taskId, context) {
    const owner = ownerKey(context, this.env);
    if (typeof taskId !== 'string' || !taskId || taskId.length > 160) return undefined;
    const stored = await this.model.findOne({ taskId, ownerKey: owner }).lean();
    return stored?.task ? clone(stored.task) : undefined;
  }

  async isCanceled(taskId, context) {
    const owner = ownerKey(context, this.env);
    const stored = await this.model.findOne({ taskId, ownerKey: owner }).select('statusState').lean();
    return stored?.statusState === TaskState.TASK_STATE_CANCELED;
  }

  async list(params = {}, context) {
    const owner = ownerKey(context, this.env);
    const pageSize = params.pageSize ?? 50;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw taskStoreError('A2A_TASK_PAGE_SIZE_INVALID', 'Research task page size must be between 1 and 100.');
    }
    const filter = { ownerKey: owner };
    if (params.contextId) filter.contextId = params.contextId;
    if (params.status !== undefined && params.status !== TaskState.TASK_STATE_UNSPECIFIED) filter.statusState = params.status;
    if (params.statusTimestampAfter) {
      const after = new Date(params.statusTimestampAfter);
      if (!Number.isFinite(after.getTime())) throw taskStoreError('A2A_TASK_FILTER_INVALID', 'Research task timestamp filter is invalid.');
      filter.statusTimestamp = { $gt: after };
    }
    const cursor = decodeCursor(params.pageToken);
    if (cursor) {
      const timestamp = cursor.timestamp ? new Date(cursor.timestamp) : null;
      if (cursor.timestamp && !Number.isFinite(timestamp.getTime())) throw taskStoreError('A2A_TASK_PAGE_TOKEN_INVALID', 'Research task page token is invalid.');
      filter.$or = timestamp ? [
        { statusTimestamp: { $lt: timestamp } },
        { statusTimestamp: timestamp, taskId: { $lt: cursor.taskId } },
      ] : [{ statusTimestamp: null, taskId: { $lt: cursor.taskId } }];
    }
    const records = await this.model.find(filter).sort({ statusTimestamp: -1, taskId: -1 }).limit(pageSize + 1).lean();
    const hasMore = records.length > pageSize;
    const tasks = records.slice(0, pageSize).map(record => {
      const task = clone(record.task);
      if (!params.includeArtifacts) task.artifacts = [];
      return task;
    });
    return { tasks, nextPageToken: hasMore && tasks.length ? encodeCursor(tasks.at(-1)) : '' };
  }
}

export { ownerKey as researchTaskOwnerKey, TERMINAL_STATES as RESEARCH_TASK_TERMINAL_STATES };
