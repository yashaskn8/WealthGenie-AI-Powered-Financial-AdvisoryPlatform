import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  candidateId: { type: String, required: true, unique: true, immutable: true, index: true },
  parentCandidateId: { type: String, default: null, immutable: true },
  generation: { type: Number, required: true, min: 0, immutable: true },
  promptBundleId: { type: String, required: true, immutable: true },
  promptBundleHash: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  scaffoldHash: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  mutationSurface: { type: [String], required: true, immutable: true },
  mutationReason: { type: String, required: true, maxlength: 1000, immutable: true },
  status: { type: String, enum: ['CREATED', 'SANDBOX_QUEUED', 'SANDBOX_RUNNING', 'TRAIN_EVALUATED', 'VALIDATION_EVALUATED', 'RELIABILITY_EVALUATED', 'HOLDOUT_PENDING', 'HOLDOUT_PASSED', 'SHADOW_READY', 'REJECTED'], required: true },
  trainMetrics: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
  validationMetrics: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
  reliabilityMetrics: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
  holdoutSummary: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
  shadowMetrics: { type: mongoose.Schema.Types.Mixed, default: null, immutable: true },
  financialAuthorityDelta: { type: Number, min: 0, max: 0, default: 0, immutable: true },
}, { strict: 'throw', timestamps: true });

export default mongoose.model('EvolutionCandidate', schema);
