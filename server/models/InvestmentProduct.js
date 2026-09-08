import mongoose from 'mongoose';

const externalIdSchema = new mongoose.Schema({
  source: { type: String, required: true, trim: true },
  value: { type: String, required: true, trim: true },
}, { _id: false, strict: 'throw' });

const investmentProductSchema = new mongoose.Schema({
  schemaVersion: { type: String, required: true },
  canonicalProductId: { type: String, required: true, unique: true, index: true },
  productType: { type: String, enum: ['MUTUAL_FUND', 'MARKET_INSTRUMENT'], required: true },
  name: { type: String, required: true, trim: true },
  providerName: { type: String, default: null, trim: true },
  schemeCategory: { type: String, default: null, trim: true },
  plan: { type: String, default: null, trim: true },
  option: { type: String, default: null, trim: true },
  externalIds: { type: [externalIdSchema], default: [] },
  source: {
    provider: { type: String, enum: ['AMFI', 'NSE', 'UPSTOX'], required: true },
    url: { type: String, required: true },
  },
  sourceUpdatedAt: { type: Date, default: null },
  lastVerifiedAt: { type: Date, required: true },
}, { strict: 'throw', timestamps: true });

investmentProductSchema.index({ 'externalIds.source': 1, 'externalIds.value': 1 });
investmentProductSchema.index({ productType: 1, providerName: 1 });

export default mongoose.model('InvestmentProduct', investmentProductSchema);
