import mongoose from 'mongoose';

const agentCheckpointSchema = new mongoose.Schema({
  runId: { type: String, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  executionGeneration: { type: Number, min: 0, default: 0 },
  workerId: { type: String, default: null },
  sequence: { type: Number, required: true, min: 1 },
  node: { type: String, required: true, maxlength: 80 },
  state: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now, immutable: true },
}, { strict: 'throw' });

agentCheckpointSchema.index({ runId: 1, sequence: -1 }, { unique: true });

export default mongoose.model('AgentCheckpoint', agentCheckpointSchema);
