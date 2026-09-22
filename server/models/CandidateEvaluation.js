import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  candidateId: { type: String, required: true, immutable: true, index: true },
  scaffoldId: { type: String, required: true, immutable: true },
  scaffoldVersion: { type: String, required: true, immutable: true },
  evaluationVersion: { type: String, required: true, immutable: true },
  partition: { type: String, enum: ['train', 'validation', 'holdout'], required: true, immutable: true },
  datasetHash: { type: String, required: true, immutable: true },
  scoreCard: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  passed: { type: Boolean, required: true, immutable: true },
}, { strict: 'throw', timestamps: true });

schema.index({ candidateId: 1, partition: 1 }, { unique: true });

export default mongoose.model('CandidateEvaluation', schema);
