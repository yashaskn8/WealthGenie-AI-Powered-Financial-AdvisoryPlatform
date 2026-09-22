import mongoose from 'mongoose';
import { RECEIPT_VERSION } from '../agents/authorization/authorizationConstants.js';

const signatureSchema = new mongoose.Schema({
  algorithm: { type: String, enum: ['Ed25519'], required: true },
  keyId: { type: String, required: true, maxlength: 120 },
  signature: { type: String, required: true, maxlength: 512 },
  environment: { type: String, enum: ['development', 'configured'], required: true },
}, { _id: false, strict: 'throw' });

const resultSchema = new mongoose.Schema({
  recommendationId: { type: String, default: null, maxlength: 80 },
  auditHash: { type: String, default: null, match: /^[a-f0-9]{64}$/ },
  recommendationProfileHash: { type: String, default: null, match: /^[a-f0-9]{64}$/ },
  status: { type: String, enum: ['COMMITTED', 'FAILED'], required: true },
}, { _id: false, strict: 'throw' });

const schema = new mongoose.Schema({
  receiptId: { type: String, required: true, unique: true, immutable: true, match: /^[0-9a-f-]{36}$/i },
  version: { type: String, enum: [RECEIPT_VERSION], required: true, immutable: true },
  mandateId: { type: String, required: true, immutable: true },
  action: { type: String, enum: ['APPROVE_RECOMPUTE'], required: true, immutable: true },
  status: { type: String, enum: ['EXECUTED', 'FAILED'], required: true, immutable: true },
  executedByServiceIdentity: { type: String, required: true, immutable: true, maxlength: 120 },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true, index: true },
  runId: { type: String, required: true, immutable: true, maxlength: 80 },
  correlationId: { type: String, default: null, immutable: true, maxlength: 120 },
  resourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialProfile', required: true, immutable: true },
  beforeSnapshotHash: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  afterSnapshotHash: { type: String, default: null, immutable: true, match: /^[a-f0-9]{64}$/ },
  startedAt: { type: Date, required: true, immutable: true },
  completedAt: { type: Date, required: true, immutable: true },
  policyDecisionId: { type: String, required: true, immutable: true, maxlength: 160 },
  policyVersion: { type: String, required: true, immutable: true, maxlength: 120 },
  mandateHash: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  previousReceiptHash: { type: String, default: null, immutable: true, match: /^[a-f0-9]{64}$/ },
  resultMetadata: { type: resultSchema, required: true, immutable: true },
  receiptHash: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  signatureMetadata: { type: signatureSchema, required: true, immutable: true },
}, { strict: 'throw', timestamps: true });

schema.index({ userId: 1, createdAt: -1 });
schema.index({ mandateId: 1 }, { unique: true });

export default mongoose.model('ExecutionReceipt', schema);
