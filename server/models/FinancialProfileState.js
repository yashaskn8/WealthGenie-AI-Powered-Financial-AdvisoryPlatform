import mongoose from 'mongoose';
import { protectImmutableIdentity } from './immutableIdentity.js';

const financialProfileStateSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  currentProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialProfile', default: null },
  revision: { type: Number, required: true, min: 0, default: 0, validate: Number.isSafeInteger },
  promotionFence: { type: Number, required: true, min: 0, default: 0, validate: Number.isSafeInteger },
  resolutionStatus: { type: String, enum: ['NO_CURRENT', 'CURRENT', 'LEGACY_AMBIGUOUS'], default: 'NO_CURRENT', required: true },
}, { timestamps: true, strict: 'throw' });

financialProfileStateSchema.index({ userId: 1 }, { unique: true, name: 'uniq_financial_profile_state_user' });
protectImmutableIdentity(financialProfileStateSchema, ['userId'], {
  code: 'FINANCIAL_PROFILE_STATE_IDENTITY_IMMUTABLE',
  label: 'Financial profile state ownership',
});

export default mongoose.model('FinancialProfileState', financialProfileStateSchema);
