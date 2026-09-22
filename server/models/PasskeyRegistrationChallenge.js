import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true, index: true },
  challenge: { type: String, required: true, immutable: true, maxlength: 256 },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
}, { strict: 'throw', timestamps: true });

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('PasskeyRegistrationChallenge', schema);

