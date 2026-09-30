import mongoose from 'mongoose';
import { protectImmutableIdentity } from './immutableIdentity.js';

const researchTaskSchema = new mongoose.Schema({
  taskId: { type: String, required: true, immutable: true, maxlength: 160 },
  ownerKey: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  agentType: { type: String, enum: ['PLAN_REVIEW'], required: true, immutable: true },
  contextId: { type: String, required: true, immutable: true, maxlength: 160 },
  statusState: { type: Number, required: true, min: 0, max: 7 },
  statusTimestamp: { type: Date, required: true },
  revision: { type: Number, required: true, min: 0, default: 0 },
  executionFence: { type: Number, min: 0, default: 0 },
  executionLeaseToken: { type: String, maxlength: 64 },
  executionLeaseExpiresAt: { type: Date },
  executionMessageId: { type: String, immutable: true, maxlength: 160 },
  requestFingerprint: { type: String, immutable: true, match: /^[a-f0-9]{64}$/ },
  activeDedupe: { type: Boolean, default: false },
  dedupeExpiresAt: { type: Date },
  deduplicatedFromTaskId: { type: String, immutable: true, maxlength: 160 },
  executionCapacityToken: { type: String, maxlength: 64 },
  task: { type: mongoose.Schema.Types.Mixed, required: true },
}, { strict: 'throw', timestamps: true });

researchTaskSchema.index({ taskId: 1 }, { unique: true, name: 'uniq_research_task_id' });
researchTaskSchema.index({ ownerKey: 1, statusTimestamp: -1, taskId: -1 }, { name: 'research_task_owner_timeline' });
researchTaskSchema.index({ ownerKey: 1, contextId: 1, statusTimestamp: -1 }, { name: 'research_task_owner_context' });
researchTaskSchema.index({ statusState: 1, executionLeaseExpiresAt: 1, createdAt: 1, taskId: 1 }, { name: 'research_task_recovery_lease' });
researchTaskSchema.index({ ownerKey: 1, requestFingerprint: 1 }, {
  unique: true,
  name: 'uniq_research_task_active_semantic_request',
  partialFilterExpression: { activeDedupe: true, requestFingerprint: { $type: 'string' } },
});
protectImmutableIdentity(researchTaskSchema, [
  'taskId', 'ownerKey', 'agentType', 'contextId', 'executionMessageId',
  'requestFingerprint', 'deduplicatedFromTaskId',
], {
  code: 'RESEARCH_TASK_IDENTITY_IMMUTABLE',
  label: 'Research task identity',
});

export default mongoose.models.ResearchTask || mongoose.model('ResearchTask', researchTaskSchema);
