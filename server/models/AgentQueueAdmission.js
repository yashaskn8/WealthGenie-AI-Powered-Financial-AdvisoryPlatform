import mongoose from 'mongoose';

const agentQueueAdmissionSchema = new mongoose.Schema({
  _id: { type: String },
  epoch: { type: Number, min: 0, required: true, default: 0 },
}, { strict: 'throw', timestamps: true, _id: false });

export default mongoose.model('AgentQueueAdmission', agentQueueAdmissionSchema);
