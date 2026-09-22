import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true, index: true },
  credentialId: { type: String, required: true, unique: true, immutable: true, maxlength: 512 },
  publicKey: { type: Buffer, required: true, immutable: true },
  counter: { type: Number, min: 0, required: true, default: 0 },
  transports: { type: [String], default: [] },
  deviceType: { type: String, default: null, maxlength: 80 },
  backedUp: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now, immutable: true },
  lastUsedAt: { type: Date, default: null },
}, { strict: 'throw', timestamps: false });

schema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('PasskeyCredential', schema);

