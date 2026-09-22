import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  runId: { type: String, required: true, unique: true, immutable: true, index: true },
  agentType: { type: String, enum: ['PLAN_REVIEW'], required: true, immutable: true },
  status: { type: String, enum: ['DISABLED', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'], required: true },
  baseScaffoldVersion: { type: String, required: true, immutable: true },
  candidateIds: { type: [String], default: [] },
  evaluationVersion: { type: String, required: true, immutable: true },
  datasetHash: { type: String, required: true, immutable: true },
  holdoutHash: { type: String, required: true, immutable: true },
  financialAuthorityDelta: { type: Number, min: 0, max: 0, default: 0, immutable: true },
  optimizerType: { type: String, default: 'DSPY_GEPA', immutable: true },
  optimizerVersion: { type: String, default: null, immutable: true },
  reflectionModel: { type: String, default: null, immutable: true },
  taskModel: { type: String, default: null, immutable: true },
  trainDatasetHash: { type: String, default: null, immutable: true },
  validationDatasetHash: { type: String, default: null, immutable: true },
  reliabilitySuiteHash: { type: String, default: null, immutable: true },
  sandboxProvider: { type: String, default: 'fixture', immutable: true },
  candidateCount: { type: Number, min: 0, default: 0, immutable: true },
  paretoCandidateIds: { type: [String], default: [], immutable: true },
  championCandidateId: { type: String, default: null, immutable: true },
  rolloutCount: { type: Number, min: 0, default: 0, immutable: true },
  metricCalls: { type: Number, min: 0, default: 0, immutable: true },
  totalTokens: { type: Number, min: 0, default: 0, immutable: true },
  totalSandboxSeconds: { type: Number, min: 0, default: 0, immutable: true },
  promotion: { type: mongoose.Schema.Types.Mixed, default: null },
  failure: { type: mongoose.Schema.Types.Mixed, default: null },
}, { strict: 'throw', timestamps: true });

export default mongoose.model('EvolutionRun', schema);
