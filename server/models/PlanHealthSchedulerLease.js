import mongoose from 'mongoose';

const planHealthSchedulerLeaseSchema = new mongoose.Schema({
  _id: { type: String },
  periodKey: { type: String, required: true },
  owner: { type: String, required: true },
  executionGeneration: { type: Number, min: 0, default: 0 },
  mutationFence: { type: Number, min: 0, default: 0 },
  status: { type: String, enum: ['PENDING', 'RUNNING', 'FAILED', 'COMPLETED', 'COMPLETED_WITH_ERRORS'], default: 'PENDING', required: true },
  cursor: { type: mongoose.Schema.Types.ObjectId, default: null },
  leaseUntil: { type: Date, default: null },
  startedAt: { type: Date, default: null },
  lastHeartbeatAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  usersScanned: { type: Number, min: 0, default: 0 },
  eventsCreated: { type: Number, min: 0, default: 0 },
  failureCount: { type: Number, min: 0, default: 0 },
  failureCode: { type: String, maxlength: 80, default: null },
}, { strict: 'throw', timestamps: true, _id: false });

planHealthSchedulerLeaseSchema.index({ status: 1, leaseUntil: 1 });

export default mongoose.model('PlanHealthSchedulerLease', planHealthSchedulerLeaseSchema);
