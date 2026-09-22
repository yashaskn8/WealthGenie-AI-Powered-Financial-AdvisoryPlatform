import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  clusterKey: { type: String, required: true, unique: true, immutable: true, index: true },
  agentType: { type: String, enum: ['PLAN_REVIEW'], required: true, immutable: true },
  failureCode: { type: String, required: true, immutable: true },
  node: { type: String, default: null, immutable: true },
  eventTypes: { type: [String], default: [], immutable: true },
  occurrenceCount: { type: Number, min: 1, default: 1 },
  sanitizedExamples: { type: [mongoose.Schema.Types.Mixed], default: [], immutable: true },
  firstSeenAt: { type: Date, required: true, immutable: true },
  lastSeenAt: { type: Date, required: true },
}, { strict: 'throw', timestamps: true });

export default mongoose.model('FailureCluster', schema);
