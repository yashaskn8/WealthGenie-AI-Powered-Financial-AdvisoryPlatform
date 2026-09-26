import mongoose from 'mongoose';

const planHealthInspectionFenceSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  periodKey: { type: String, required: true },
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialProfile', required: true },
  owner: { type: String, required: true },
  executionGeneration: { type: Number, min: 1, required: true },
  status: {
    type: String,
    enum: ['RUNNING', 'PUBLISHING', 'PUBLISHED', 'TIMED_OUT', 'CANCELLED', 'STALE', 'FAILED'],
    required: true,
  },
  startedAt: { type: Date, required: true },
  deadlineAt: { type: Date, required: true },
  publicationStartedAt: { type: Date, default: null },
  publishedAt: { type: Date, default: null },
  invalidatedAt: { type: Date, default: null },
  resultStatus: { type: String, enum: ['HEALTHY', 'ATTENTION'], default: null },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlanHealthEvent', default: null },
  expiresAt: { type: Date, required: true },
}, { strict: 'throw', timestamps: true, _id: false });

planHealthInspectionFenceSchema.index({ status: 1, deadlineAt: 1 });
planHealthInspectionFenceSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'ttl_plan_health_inspection_fences' },
);

export default mongoose.model('PlanHealthInspectionFence', planHealthInspectionFenceSchema);
