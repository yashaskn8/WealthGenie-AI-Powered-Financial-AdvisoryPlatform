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
  task: { type: mongoose.Schema.Types.Mixed, required: true },
}, { strict: 'throw', timestamps: true });

researchTaskSchema.index({ taskId: 1 }, { unique: true, name: 'uniq_research_task_id' });
researchTaskSchema.index({ ownerKey: 1, statusTimestamp: -1, taskId: -1 }, { name: 'research_task_owner_timeline' });
researchTaskSchema.index({ ownerKey: 1, contextId: 1, statusTimestamp: -1 }, { name: 'research_task_owner_context' });
protectImmutableIdentity(researchTaskSchema, ['taskId', 'ownerKey', 'agentType', 'contextId'], {
  code: 'RESEARCH_TASK_IDENTITY_IMMUTABLE',
  label: 'Research task identity',
});

export default mongoose.models.ResearchTask || mongoose.model('ResearchTask', researchTaskSchema);
