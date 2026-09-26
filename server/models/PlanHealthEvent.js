import mongoose from 'mongoose';

const planHealthEventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialProfile', required: true, index: true },
  recommendationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recommendation', default: null },
  reason: { type: String, required: true, maxlength: 120 },
  severity: { type: String, enum: ['INFO', 'ATTENTION', 'BLOCKED'], required: true },
  recommendation: { type: String, required: true, maxlength: 500 },
  detectedAt: { type: Date, required: true },
  status: { type: String, enum: ['UNREAD', 'READ', 'ACKNOWLEDGED', 'SUPERSEDED', 'RESOLVED', 'OPEN'], default: 'UNREAD' },
  fingerprint: { type: String, required: true },
  monitorVersion: { type: String, required: true },
  acknowledgedAt: { type: Date, default: null },
  readAt: { type: Date, default: null },
  resolvedAt: { type: Date, default: null },
  supersededAt: { type: Date, default: null },
}, { strict: 'throw', timestamps: true });

planHealthEventSchema.index({ userId: 1, detectedAt: -1 });
planHealthEventSchema.index(
  { fingerprint: 1 },
  {
    unique: true,
    name: 'uniq_active_plan_health_fingerprint',
    partialFilterExpression: { status: { $in: ['UNREAD', 'READ', 'OPEN', 'ACKNOWLEDGED'] } },
  },
);

export default mongoose.model('PlanHealthEvent', planHealthEventSchema);
