import mongoose from 'mongoose';
import { protectImmutableIdentity } from './immutableIdentity.js';

const agentCheckpointSchema = new mongoose.Schema({
  runId: { type: String, required: true, immutable: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true, index: true },
  executionGeneration: { type: Number, required: true, min: 1, immutable: true },
  workerId: { type: String, default: null },
  sequence: { type: Number, required: true, min: 1, immutable: true },
  node: { type: String, required: true, maxlength: 80 },
  state: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now, immutable: true },
}, { strict: 'throw' });

agentCheckpointSchema.index({ runId: 1, executionGeneration: 1, sequence: 1 }, { unique: true });
protectImmutableIdentity(agentCheckpointSchema, ['runId', 'userId', 'executionGeneration', 'sequence'], {
  code: 'AGENT_CHECKPOINT_IDENTITY_IMMUTABLE',
  label: 'Agent checkpoint identity',
});

export default mongoose.model('AgentCheckpoint', agentCheckpointSchema);
