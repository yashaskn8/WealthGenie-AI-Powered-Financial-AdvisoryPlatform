import { BaseCheckpointSaver } from '@langchain/langgraph';
import AgentGraphCheckpoint from '../../models/AgentGraphCheckpoint.js';
import { planReviewGraphThreadId } from './planReviewRuntime.js';

const MAX_PENDING_WRITE_COUNT = 100;
const MAX_PENDING_WRITE_BYTES = 256 * 1024;

function threadIdOf(config) {
  const value = config?.configurable?.thread_id;
  if (!value) throw new Error('LangGraph checkpoint thread_id is required.');
  return String(value);
}

function checkpointIdOf(config) {
  return config?.configurable?.checkpoint_id || null;
}

function encoded(value) {
  return Buffer.from(value).toString('base64');
}

function decoded(value) {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

export class MongoPlanReviewCheckpointer extends BaseCheckpointSaver {
  constructor({ model = AgentGraphCheckpoint, runId, userId, workerId = null, executionGeneration = 0, assertLease = null } = {}) {
    super();
    if (!runId || !userId || !Number.isInteger(Number(executionGeneration)) || Number(executionGeneration) < 1) {
      throw new TypeError('A run, owner, and positive execution generation are required for PlanReview checkpoints.');
    }
    this.model = model;
    this.runId = String(runId);
    this.userId = userId;
    this.workerId = workerId;
    this.executionGeneration = Number(executionGeneration);
    this.expectedThreadId = planReviewGraphThreadId(this.runId, this.executionGeneration);
    this.assertLease = assertLease;
  }

  scope(threadId) {
    if (String(threadId) !== this.expectedThreadId) {
      const error = new Error('Checkpoint thread does not belong to this PlanReview execution generation.');
      error.code = 'CHECKPOINT_SCOPE_MISMATCH';
      throw error;
    }
    return {
      threadId: this.expectedThreadId,
      runId: this.runId,
      userId: this.userId,
      executionGeneration: this.executionGeneration,
    };
  }

  async put(config, checkpoint, metadata, newVersions) {
    await this.assertLease?.();
    const threadId = threadIdOf(config);
    const scope = this.scope(threadId);
    const [checkpointType, checkpointBytes] = await this.serde.dumpsTyped({ ...checkpoint, channel_versions: newVersions });
    const [metadataType, metadataBytes] = await this.serde.dumpsTyped(metadata);
    const parentCheckpointId = checkpointIdOf(config);
    await this.model.findOneAndUpdate(
      { ...scope, checkpointId: checkpoint.id },
      {
        $set: {
          parentCheckpointId,
          workerId: this.workerId,
          checkpointType,
          checkpoint: encoded(checkpointBytes),
          metadataType,
          metadata: encoded(metadataBytes),
        },
        $setOnInsert: {
          threadId,
          checkpointId: checkpoint.id,
          runId: this.runId,
          userId: this.userId,
          executionGeneration: this.executionGeneration,
          createdAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );
    await this.assertLease?.();
    return { configurable: { ...config.configurable, thread_id: threadId, checkpoint_id: checkpoint.id } };
  }

  async putWrites(config, writes, taskId) {
    await this.assertLease?.();
    const threadId = threadIdOf(config);
    const scope = this.scope(threadId);
    const checkpointId = checkpointIdOf(config);
    if (!checkpointId) return;
    const serialized = [];
    for (const [channel, value] of writes) {
      if (typeof taskId !== 'string' || taskId.length === 0 || taskId.length > 128
          || typeof channel !== 'string' || channel.length === 0 || channel.length > 128) {
        const error = new Error('PlanReview graph checkpoint write identity is invalid.');
        error.code = 'AGENT_GRAPH_CHECKPOINT_BUDGET_EXCEEDED';
        throw error;
      }
      const [type, bytes] = await this.serde.dumpsTyped(value);
      serialized.push([taskId, channel, type, encoded(bytes)]);
    }
    const incomingBytes = serialized.reduce((total, row) => total + row.reduce((sum, value) => sum + Buffer.byteLength(value), 0), 0);
    if (serialized.length > MAX_PENDING_WRITE_COUNT || incomingBytes > MAX_PENDING_WRITE_BYTES) {
      const error = new Error('PlanReview graph checkpoint pending writes exceeded the bounded recovery limit.');
      error.code = 'AGENT_GRAPH_CHECKPOINT_BUDGET_EXCEEDED';
      throw error;
    }
    const currentQuery = this.model.findOne({ ...scope, checkpointId });
    const selectedQuery = currentQuery.select ? currentQuery.select({ pendingWrites: 1 }) : currentQuery;
    const current = await (selectedQuery.lean ? selectedQuery.lean() : selectedQuery);
    if (!current) {
      const error = new Error('PlanReview checkpoint target is unavailable in this execution generation.');
      error.code = 'CHECKPOINT_SCOPE_MISMATCH';
      throw error;
    }
    const existingWrites = current.pendingWrites || [];
    const existingBytes = existingWrites.reduce((total, row) => total + row.reduce((sum, value) => sum + Buffer.byteLength(String(value)), 0), 0);
    if (existingWrites.length + serialized.length > MAX_PENDING_WRITE_COUNT
        || existingBytes + incomingBytes > MAX_PENDING_WRITE_BYTES) {
      const error = new Error('PlanReview graph checkpoint pending writes exceeded the bounded recovery limit.');
      error.code = 'AGENT_GRAPH_CHECKPOINT_BUDGET_EXCEEDED';
      throw error;
    }
    const updated = await this.model.updateOne({
      ...scope,
      checkpointId,
      pendingWrites: existingWrites,
    }, { $push: { pendingWrites: { $each: serialized } } });
    if (!Number(updated?.matchedCount ?? updated?.modifiedCount ?? updated?.n ?? 0)) {
      const error = new Error('PlanReview checkpoint target is unavailable in this execution generation.');
      error.code = 'CHECKPOINT_SCOPE_MISMATCH';
      throw error;
    }
    await this.assertLease?.();
  }

  async getTuple(config) {
    const threadId = threadIdOf(config);
    const scope = this.scope(threadId);
    const checkpointId = checkpointIdOf(config);
    const document = await (checkpointId
      ? this.model.findOne({ ...scope, checkpointId }).lean()
      : this.model.findOne(scope).sort({ createdAt: -1 }).lean());
    if (!document) return undefined;
    const checkpoint = await this.serde.loadsTyped(document.checkpointType, decoded(document.checkpoint));
    const metadata = await this.serde.loadsTyped(document.metadataType, decoded(document.metadata));
    const pendingWrites = [];
    for (const [taskId, channel, type, value] of document.pendingWrites || []) {
      pendingWrites.push([taskId, channel, await this.serde.loadsTyped(type, decoded(value))]);
    }
    return {
      config: { configurable: { thread_id: threadId, checkpoint_id: document.checkpointId } },
      checkpoint,
      metadata,
      parentConfig: document.parentCheckpointId
        ? { configurable: { thread_id: threadId, checkpoint_id: document.parentCheckpointId } }
        : undefined,
      pendingWrites,
    };
  }

  async *list(config, options = {}) {
    const threadId = threadIdOf(config);
    const filter = this.scope(threadId);
    if (options.filter?.runId && String(options.filter.runId) !== this.runId) return;
    const query = this.model.find(filter).sort({ createdAt: -1 }).limit(options.limit || 20).lean();
    const documents = await query;
    for (const document of documents) {
      yield this.getTuple({ configurable: { thread_id: threadId, checkpoint_id: document.checkpointId } });
    }
  }

  async deleteThread(threadId) {
    await this.model.deleteMany(this.scope(threadId));
  }
}
