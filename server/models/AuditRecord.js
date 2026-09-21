import mongoose from 'mongoose';
import { optionalUniqueIndex } from '../config/mongoCompatibility.js';

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

// Regulatory composite audit indexes
auditRecordSchema.index({ userId: 1, timestamp: -1 });
const chainSequenceIndex = optionalUniqueIndex('chain_sequence', 'unique_user_audit_chain_sequence');
auditRecordSchema.index(
  { userId: 1, ...chainSequenceIndex.key },
  chainSequenceIndex.options,
);

export default mongoose.model('AuditRecord', auditRecordSchema);
