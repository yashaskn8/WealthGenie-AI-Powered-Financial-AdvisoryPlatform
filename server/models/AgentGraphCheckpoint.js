import mongoose from 'mongoose';
import { protectImmutableIdentity } from './immutableIdentity.js';

const agentGraphCheckpointSchema = new mongoose.Schema({
  threadId: { type: String, required: true, immutable: true },
  checkpointId: { type: String, required: true, immutable: true },
  parentCheckpointId: { type: String, default: null },
  runId: { type: String, required: true, immutable: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true, index: true },
  executionGeneration: { type: Number, required: true, min: 1, immutable: true },
  workerId: { type: String, default: null },
  checkpointType: { type: String, required: true },
  checkpoint: { type: String, required: true },
  metadataType: { type: String, required: true },
  metadata: { type: String, required: true },
  pendingWrites: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
    validate: {
      validator(writes) {
        if (!Array.isArray(writes) || writes.length > 100) return false;
        const totalBytes = writes.reduce((total, item) => {
          if (!Array.isArray(item) || item.length !== 4 || item.some(value => typeof value !== 'string')) return Infinity;
          return total + item.reduce((bytes, value) => bytes + Buffer.byteLength(value), 0);
        }, 0);
        return totalBytes <= 256 * 1024;
      },
      message: 'PlanReview graph checkpoint pending writes exceed the bounded recovery limit.',
    },
  },
  createdAt: { type: Date, default: Date.now, immutable: true },
  expiresAt: { type: Date, default: null },
}, { strict: 'throw' });

agentGraphCheckpointSchema.index({ threadId: 1, checkpointId: 1 }, { unique: true });
agentGraphCheckpointSchema.index({ runId: 1, userId: 1, executionGeneration: 1, threadId: 1, checkpointId: 1 }, { unique: true });
agentGraphCheckpointSchema.index({ threadId: 1, createdAt: -1 });
agentGraphCheckpointSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_terminal_agent_graph_checkpoints' });
protectImmutableIdentity(agentGraphCheckpointSchema, ['threadId', 'checkpointId', 'runId', 'userId', 'executionGeneration'], {
  code: 'AGENT_GRAPH_CHECKPOINT_IDENTITY_IMMUTABLE',
  label: 'Agent graph checkpoint identity',
});

export default mongoose.model('AgentGraphCheckpoint', agentGraphCheckpointSchema);
