import mongoose from 'mongoose';

const planHealthSchedulerLeaseSchema = new mongoose.Schema({
  _id: { type: String },
  periodKey: { type: String, required: true },
  owner: { type: String, required: true },
  leaseUntil: { type: Date, required: true },
  completedAt: { type: Date, default: null },
  usersScanned: { type: Number, min: 0, default: 0 },
}, { strict: 'throw', timestamps: true, _id: false });

export default mongoose.model('PlanHealthSchedulerLease', planHealthSchedulerLeaseSchema);
