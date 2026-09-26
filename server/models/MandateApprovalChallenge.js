import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  mandateId: { type: String, required: true, unique: true, immutable: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true, index: true },
  challenge: { type: String, required: true, maxlength: 256 },
  mandateHash: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
}, { strict: 'throw', timestamps: true });

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('MandateApprovalChallenge', schema);
