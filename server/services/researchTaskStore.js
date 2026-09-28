import crypto from 'node:crypto';
import { TaskState } from '@a2a-js/sdk';
import ResearchTask from '../models/ResearchTask.js';
import { assertVerifiedAgentIdentity } from '../agents/identity/agentIdentityVerifier.js';

const TERMINAL_STATES = new Set([
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_COMPLETED,
]);
const MAX_TASK_BYTES = 2_000_000;
const MAX_CAS_ATTEMPTS = 8;

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

export class MongoResearchTaskStore {
  constructor({ model = ResearchTask, env = process.env, maxCasAttempts = MAX_CAS_ATTEMPTS } = {}) {
    this.model = model;
    this.env = env;
    this.maxCasAttempts = Math.max(1, Math.min(16, Number(maxCasAttempts) || MAX_CAS_ATTEMPTS));
    this.durable = true;
  }

  async save(task, context) {
    const owner = ownerKey(context, this.env);
    if (!task?.id || typeof task.id !== 'string' || task.id.length > 160
        || !task.contextId || typeof task.contextId !== 'string' || task.contextId.length > 160
        || !Number.isInteger(task.status?.state)) {
      throw taskStoreError('A2A_TASK_INVALID', 'Research task identity or state is invalid.');
    }
    const serialized = JSON.stringify(task);
    if (Buffer.byteLength(serialized) > MAX_TASK_BYTES) {
      throw taskStoreError('A2A_TASK_TOO_LARGE', 'Research task exceeds the durable storage limit.');
    }
    const timestamp = statusTimestamp(task);
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
      const merged = mergeResearchTask(existing.task, task);
      try {
        const updated = await this.model.findOneAndUpdate(
          { _id: existing._id, ownerKey: owner, revision: existing.revision, statusState: { $nin: [...TERMINAL_STATES] } },
          { $set: { task: merged, statusState: merged.status.state, statusTimestamp: statusTimestamp(merged) }, $inc: { revision: 1 } },
          { new: true, runValidators: true, lean: true },
        ).lean();
        if (updated) return;
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
