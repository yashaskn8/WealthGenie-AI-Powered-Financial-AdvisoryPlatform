import mongoose from 'mongoose';

const resultReferenceSchema = new mongoose.Schema({
  recommendationId: { type: String, default: null, maxlength: 80 },
  auditHash: { type: String, default: null, match: /^[a-f0-9]{64}$/ },
  afterSnapshotHash: { type: String, default: null, match: /^[a-f0-9]{64}$/ },
  responseHash: { type: String, default: null, match: /^[a-f0-9]{64}$/ },
  policyDecisionId: { type: String, default: null, maxlength: 160 },
}, { _id: false, strict: 'throw' });

const schema = new mongoose.Schema({
  executionId: { type: String, required: true, unique: true, immutable: true, match: /^[0-9a-f-]{36}$/i },
  mandateId: { type: String, required: true, immutable: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true, index: true },
  action: { type: String, enum: ['APPROVE_RECOMPUTE'], required: true, immutable: true },
  status: { type: String, enum: ['CLAIMED', 'EXECUTING', 'COMMITTED', 'RECEIPT_PENDING', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'REQUIRES_RECONCILIATION'], required: true, index: true },
  executionGeneration: { type: Number, min: 1, required: true },
  workerId: { type: String, required: true, maxlength: 120 },
  leaseUntil: { type: Date, required: true, index: true },
  heartbeatAt: { type: Date, required: true },
  startedAt: { type: Date, required: true },
  completedAt: { type: Date, default: null },
  idempotencyKey: { type: String, required: true, immutable: true, maxlength: 240 },
  financialSnapshotHash: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  resultReference: { type: resultReferenceSchema, default: null },
  receiptId: { type: String, default: null, immutable: true, maxlength: 80 },
  failureCode: { type: String, default: null, maxlength: 120 },
  retryCount: { type: Number, min: 0, max: 10, default: 0 },
}, { strict: 'throw', timestamps: true });

schema.index({ mandateId: 1 }, { unique: true });
schema.index({ userId: 1, status: 1, leaseUntil: 1 });

export default mongoose.model('AuthorizedExecutionAttempt', schema);
