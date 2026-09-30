import mongoose from 'mongoose';

const activeLeaseSchema = new mongoose.Schema({
  taskId: { type: String, required: true, maxlength: 160 },
  ownerKey: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  token: { type: String, required: true, maxlength: 64 },
  fence: { type: Number, required: true, min: 1 },
  expiresAt: { type: Date, required: true },
}, { _id: false, strict: 'throw' });

const researchTaskCapacitySchema = new mongoose.Schema({
  _id: { type: String, default: 'research-agent-global' },
  maxActiveTasks: { type: Number, required: true, min: 1, max: 100 },
  activeLeases: { type: [activeLeaseSchema], required: true, default: [] },
  updatedAt: { type: Date, required: true },
}, { strict: 'throw', versionKey: false });

export default mongoose.models.ResearchTaskCapacity
  || mongoose.model('ResearchTaskCapacity', researchTaskCapacitySchema);
