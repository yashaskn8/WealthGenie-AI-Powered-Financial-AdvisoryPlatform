import { BaseCheckpointSaver } from '@langchain/langgraph';
import AgentGraphCheckpoint from '../../models/AgentGraphCheckpoint.js';

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
    this.model = model;
    this.runId = String(runId);
    this.userId = userId;
    this.workerId = workerId;
    this.executionGeneration = executionGeneration;
    this.assertLease = assertLease;
  }

  async put(config, checkpoint, metadata, newVersions) {
    await this.assertLease?.();
    const threadId = threadIdOf(config);
    const [checkpointType, checkpointBytes] = await this.serde.dumpsTyped({ ...checkpoint, channel_versions: newVersions });
    const [metadataType, metadataBytes] = await this.serde.dumpsTyped(metadata);
    const parentCheckpointId = checkpointIdOf(config);
    await this.model.findOneAndUpdate(
      { threadId, checkpointId: checkpoint.id },
      {
        $set: {
          threadId,
          checkpointId: checkpoint.id,
          parentCheckpointId,
          runId: this.runId,
          userId: this.userId,
          executionGeneration: this.executionGeneration,
          workerId: this.workerId,
          checkpointType,
          checkpoint: encoded(checkpointBytes),
          metadataType,
          metadata: encoded(metadataBytes),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, new: true },
    );
    await this.assertLease?.();
    return { configurable: { ...config.configurable, thread_id: threadId, checkpoint_id: checkpoint.id } };
  }

  async putWrites(config, writes, taskId) {
    await this.assertLease?.();
    const threadId = threadIdOf(config);
    const checkpointId = checkpointIdOf(config);
    if (!checkpointId) return;
    const serialized = [];
    for (const [channel, value] of writes) {
      const [type, bytes] = await this.serde.dumpsTyped(value);
      serialized.push([taskId, channel, type, encoded(bytes)]);
    }
    await this.model.updateOne({ threadId, checkpointId }, { $push: { pendingWrites: { $each: serialized } } });
    await this.assertLease?.();
  }

  async getTuple(config) {
    const threadId = threadIdOf(config);
    const checkpointId = checkpointIdOf(config);
    const document = await (checkpointId
      ? this.model.findOne({ threadId, checkpointId }).lean()
      : this.model.findOne({ threadId }).sort({ createdAt: -1 }).lean());
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
    const filter = { threadId };
    if (options.filter?.runId) filter.runId = options.filter.runId;
    const query = this.model.find(filter).sort({ createdAt: -1 }).limit(options.limit || 20).lean();
    const documents = await query;
    for (const document of documents) {
      yield this.getTuple({ configurable: { thread_id: threadId, checkpoint_id: document.checkpointId } });
    }
  }

  async deleteThread(threadId) {
    await this.model.deleteMany({ threadId: String(threadId) });
  }
}
