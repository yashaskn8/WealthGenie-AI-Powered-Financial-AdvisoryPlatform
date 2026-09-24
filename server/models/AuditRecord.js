import mongoose from 'mongoose';
import { optionalUniqueIndex } from '../config/mongoCompatibility.js';

const allocationTransitionSchema = new mongoose.Schema({
  recommendationId: { type: mongoose.Schema.Types.ObjectId, required: true },
  profileId: { type: mongoose.Schema.Types.ObjectId, required: true },
  previousAllocationRevision: { type: Number, required: true, min: 1 },
  previousAllocationRevisionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  newAllocationRevision: { type: Number, required: true, min: 2 },
  newAllocationRevisionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  oldPortfolioFingerprint: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  newPortfolioFingerprint: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  recommendationFingerprint: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  profileInputHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  profileVersion: { type: Number, required: true, min: 1 },
  modelVersion: { type: String, required: true },
  recommendationPolicyVersion: { type: String, required: true },
  regulatoryRuleVersion: { type: String, required: true },
  returnAssumptionVersion: { type: String, required: true },
  returnAssumptionHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  returnAssumptionSource: { type: String, required: true },
  source: { type: String, enum: ['USER_REBALANCED'], required: true },
}, { _id: false, strict: 'throw' });

const auditRecordSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  profileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FinancialProfile',
    required: true,
    index: true,
  },
  recommendationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Recommendation',
    index: true,
  },
  correlationId: {
    type: String,
    required: true,
    index: true,
  },
  traceId: {
    type: String,
    index: true,
  },
  version_id: {
    type: String,
    required: true,
  },
  regulatory_rule_version: {
    type: String,
    required: true,
    index: true,
  },
  input_hash: {
    type: String,
    required: true,
    index: true,
  },
  inputs: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  recommendations: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  allocation_transition: {
    type: allocationTransitionSchema,
    default: undefined,
  },
  cited_rag_chunk_ids: {
    type: [String],
    default: [],
  },
  engine: {
    type: String,
    required: true,
    enum: ['ml_service', 'rule_fallback', 'rule_based'],
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
  previous_hash: {
    type: String,
    required: true,
  },
  record_hash: {
    type: String,
    required: true,
    index: true,
  },
  hash_algorithm: {
    type: String,
    required: true,
    enum: ['sha256'],
    default: 'sha256',
  },
  schema_version: {
    type: String,
    required: true,
    default: '1.0',
  },
  chain_sequence: {
    type: Number,
    required: true,
    min: 1,
  },
}, {
  timestamps: true,
});

function appendOnlyError() {
  const error = new Error('Audit records are append-only.');
  error.code = 'AUDIT_RECORD_APPEND_ONLY';
  return error;
}

auditRecordSchema.pre('save', function rejectAuditRecordMutation() {
  if (!this.isNew) throw appendOnlyError();
});

for (const operation of [
  'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete',
]) {
  auditRecordSchema.pre(operation, function rejectAuditRecordQueryMutation() {
    throw appendOnlyError();
  });
}

auditRecordSchema.static('bulkWrite', function rejectAuditRecordBulkWrite() {
  throw appendOnlyError();
});

// Regulatory composite audit indexes
auditRecordSchema.index({ userId: 1, timestamp: -1 });
const chainSequenceIndex = optionalUniqueIndex('chain_sequence', 'unique_user_audit_chain_sequence');
auditRecordSchema.index(
  { userId: 1, ...chainSequenceIndex.key },
  chainSequenceIndex.options,
);

export default mongoose.model('AuditRecord', auditRecordSchema);
