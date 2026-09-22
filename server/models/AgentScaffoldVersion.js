import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  scaffoldId: { type: String, required: true, immutable: true, index: true },
  version: { type: String, required: true, immutable: true },
  specVersion: { type: String, required: true, immutable: true },
  agentType: { type: String, enum: ['PLAN_REVIEW'], required: true, immutable: true },
  contentHash: { type: String, required: true, immutable: true },
  spec: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  lifecycle: { type: String, enum: ['CANDIDATE', 'CHALLENGER', 'CHAMPION', 'RETIRED'], default: 'CANDIDATE' },
  featureFlag: { type: String, required: true, immutable: true },
  promotedBy: { type: String, default: null },
  promotedAt: { type: Date, default: null },
}, { strict: 'throw', timestamps: true });

schema.index({ scaffoldId: 1, version: 1 }, { unique: true });

export default mongoose.model('AgentScaffoldVersion', schema);
