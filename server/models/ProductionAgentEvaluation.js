import mongoose from 'mongoose';
import { protectImmutableIdentity } from './immutableIdentity.js';

export const PRODUCTION_EVALUATION_CLASSIFICATIONS = Object.freeze([
  'PASS', 'QUALITY_WARNING', 'REGRESSION', 'SAFETY_FAILURE',
  'AUTHORITY_VIOLATION', 'INSUFFICIENT_EVIDENCE',
]);

const schema = new mongoose.Schema({
  evaluationId: { type: String, required: true, unique: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  runId: { type: String, required: true, immutable: true, index: true },
  executionGeneration: { type: Number, required: true, min: 1, immutable: true },
  runtimeEvidenceHash: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  evaluationHash: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  evidenceManifest: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  evaluationPolicyVersion: { type: String, required: true, immutable: true },
  evaluatorVersion: { type: String, required: true, immutable: true },
  baselineVersion: { type: String, default: null, immutable: true },
  hardGateResults: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  qualitySignals: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  classification: { type: String, enum: PRODUCTION_EVALUATION_CLASSIFICATIONS, required: true, immutable: true },
  evaluatedAt: { type: Date, required: true, immutable: true },
}, { strict: 'throw', versionKey: false });

protectImmutableIdentity(schema, Object.keys(schema.paths).filter(path => path !== '_id'), {
  code: 'PRODUCTION_AGENT_EVALUATION_IMMUTABLE',
  label: 'Production agent evaluation',
});

export default mongoose.model('ProductionAgentEvaluation', schema);
