import mongoose from 'mongoose';
import { AUTHORIZATION_VERSION, ALLOWED_ACTIONS, MANDATE_STATUSES } from '../agents/authorization/authorizationConstants.js';

const identitySchema = new mongoose.Schema({
  agentType: { type: String, enum: ['PLAN_REVIEW', 'EVIDENCE_VERIFIER', 'SCAFFOLD_EVOLUTION'], required: true },
  provider: { type: String, enum: ['development', 'oidc', 'spiffe'], required: true },
  subject: { type: String, required: true, maxlength: 240 },
  issuer: { type: String, default: null, maxlength: 240 },
  audience: { type: String, default: null, maxlength: 240 },
  capabilities: { type: [String], default: [] },
  authenticated: { type: Boolean, required: true },
  verifiedAt: { type: Date, required: true },
}, { _id: false, strict: 'throw' });

const constraintsSchema = new mongoose.Schema({
  maxAgeSeconds: { type: Number, min: 1, max: 900, required: true },
  allowedAgentType: { type: String, enum: ['PLAN_REVIEW'], required: true },
  resourceVersion: { type: Number, min: 1, required: true },
  noFinancialMutationByAgent: { type: Boolean, enum: [true], required: true },
}, { _id: false, strict: 'throw' });

const approvalSchema = new mongoose.Schema({
  method: { type: String, enum: ['DEVELOPMENT', 'WEBAUTHN'], default: null },
  verifiedAt: { type: Date, default: null },
  credentialId: { type: String, default: null, maxlength: 512 },
  challengeHash: { type: String, default: null, match: /^[a-f0-9]{64}$/ },
  authenticatorCounter: { type: Number, min: 0, default: null },
  credentialDeviceType: { type: String, enum: ['singleDevice', 'multiDevice'], default: null },
  credentialBackedUp: { type: Boolean, default: null },
}, { _id: false, strict: 'throw' });

const signatureSchema = new mongoose.Schema({
  algorithm: { type: String, enum: ['Ed25519'], required: true },
  keyId: { type: String, required: true, maxlength: 120 },
  signature: { type: String, required: true, maxlength: 512 },
  environment: { type: String, enum: ['development', 'configured'], required: true },
}, { _id: false, strict: 'throw' });

const schema = new mongoose.Schema({
  mandateId: { type: String, required: true, unique: true, immutable: true, match: /^[0-9a-f-]{36}$/i },
  version: { type: String, enum: [AUTHORIZATION_VERSION], required: true, immutable: true },
  issuer: { type: String, required: true, immutable: true, maxlength: 120 },
  subject: { type: String, required: true, immutable: true, maxlength: 120 },
  audience: { type: String, required: true, immutable: true, maxlength: 120 },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true, index: true },
  agentIdentity: { type: identitySchema, required: true, immutable: true },
  agentType: { type: String, enum: ['PLAN_REVIEW'], required: true, immutable: true },
  agentVersion: { type: String, required: true, immutable: true, maxlength: 120 },
  runId: { type: String, required: true, immutable: true, maxlength: 80 },
  correlationId: { type: String, default: null, immutable: true, maxlength: 120 },
  action: { type: String, enum: ALLOWED_ACTIONS, required: true, immutable: true },
  resourceType: { type: String, enum: ['FinancialProfile'], required: true, immutable: true },
  resourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialProfile', required: true, immutable: true },
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialProfile', required: true, immutable: true },
  recommendationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recommendation', default: null, immutable: true },
  financialSnapshotHash: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  recommendationFingerprint: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  planReviewSnapshotHash: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  policyVersion: { type: String, required: true, immutable: true, maxlength: 120 },
  actionPayloadHash: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  constraints: { type: constraintsSchema, required: true, immutable: true },
  issuedAt: { type: Date, required: true, immutable: true },
  notBefore: { type: Date, required: true, immutable: true },
  expiresAt: { type: Date, required: true, immutable: true, index: true },
  nonce: { type: String, required: true, unique: true, immutable: true, maxlength: 64 },
  singleUse: { type: Boolean, enum: [true], required: true, immutable: true },
  parentGrantId: { type: String, default: null, immutable: true, maxlength: 120 },
  delegationDepth: { type: Number, min: 0, max: 2, required: true, immutable: true },
  approvalMethod: { type: String, enum: ['DEVELOPMENT', 'WEBAUTHN'], required: true, immutable: true },
  status: { type: String, enum: MANDATE_STATUSES, required: true, index: true },
  mandateHash: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  signatureMetadata: { type: signatureSchema, default: null },
  approval: { type: approvalSchema, default: null },
  executionStartedAt: { type: Date, default: null },
  executedAt: { type: Date, default: null },
  receiptId: { type: String, default: null, immutable: true, maxlength: 80 },
  failureCode: { type: String, default: null, maxlength: 120 },
  revokedAt: { type: Date, default: null },
  revocationReason: { type: String, default: null, maxlength: 240 },
}, { strict: 'throw', timestamps: true });

schema.index({ userId: 1, createdAt: -1 });
schema.index({ userId: 1, profileId: 1, status: 1 });

export default mongoose.model('UserIntentMandate', schema);
