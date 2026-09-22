import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  runId: { type: String, required: true, immutable: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true, index: true },
  executionGeneration: { type: Number, required: true, immutable: true },
  sequence: { type: Number, required: true, min: 1, immutable: true },
  eventType: { type: String, required: true, immutable: true, maxlength: 80 },
  node: { type: String, default: null, immutable: true, maxlength: 80 },
  data: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
}, { strict: 'throw', timestamps: { createdAt: true, updatedAt: false } });

schema.index({ runId: 1, sequence: 1 }, { unique: true });
schema.index({ userId: 1, runId: 1, sequence: 1 });

export default mongoose.model('AgentRunEvent', schema);
