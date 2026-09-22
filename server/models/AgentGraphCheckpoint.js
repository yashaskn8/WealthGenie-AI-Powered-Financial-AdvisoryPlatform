import mongoose from 'mongoose';

const agentGraphCheckpointSchema = new mongoose.Schema({
  threadId: { type: String, required: true },
  checkpointId: { type: String, required: true },
  parentCheckpointId: { type: String, default: null },
  runId: { type: String, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  executionGeneration: { type: Number, min: 0, default: 0 },
  workerId: { type: String, default: null },
  checkpointType: { type: String, required: true },
  checkpoint: { type: String, required: true },
  metadataType: { type: String, required: true },
  metadata: { type: String, required: true },
  pendingWrites: { type: [mongoose.Schema.Types.Mixed], default: [] },
  createdAt: { type: Date, default: Date.now, immutable: true },
}, { strict: 'throw' });

agentGraphCheckpointSchema.index({ threadId: 1, checkpointId: 1 }, { unique: true });
agentGraphCheckpointSchema.index({ threadId: 1, createdAt: -1 });

export default mongoose.model('AgentGraphCheckpoint', agentGraphCheckpointSchema);
