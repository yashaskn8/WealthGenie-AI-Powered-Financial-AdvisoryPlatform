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
  pendingWrites: { type: [mongoose.Schema.Types.Mixed], default: [] },
  createdAt: { type: Date, default: Date.now, immutable: true },
}, { strict: 'throw' });

agentGraphCheckpointSchema.index({ threadId: 1, checkpointId: 1 }, { unique: true });
agentGraphCheckpointSchema.index({ runId: 1, userId: 1, executionGeneration: 1, threadId: 1, checkpointId: 1 }, { unique: true });
agentGraphCheckpointSchema.index({ threadId: 1, createdAt: -1 });
protectImmutableIdentity(agentGraphCheckpointSchema, ['threadId', 'checkpointId', 'runId', 'userId', 'executionGeneration'], {
  code: 'AGENT_GRAPH_CHECKPOINT_IDENTITY_IMMUTABLE',
  label: 'Agent graph checkpoint identity',
});

export default mongoose.model('AgentGraphCheckpoint', agentGraphCheckpointSchema);
