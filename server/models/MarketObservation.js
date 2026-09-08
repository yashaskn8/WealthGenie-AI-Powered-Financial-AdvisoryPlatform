import mongoose from 'mongoose';

const freshnessSchema = new mongoose.Schema({
  status: { type: String, enum: ['FRESH', 'STALE', 'UNKNOWN'], required: true },
  ageSeconds: { type: Number, default: null, min: 0 },
  maxAgeSeconds: { type: Number, default: null, min: 0 },
}, { _id: false, strict: 'throw' });

const metricsSchema = new mongoose.Schema({
  open: { type: Number, default: null },
  high: { type: Number, default: null },
  low: { type: Number, default: null },
  close: { type: Number, default: null },
  previousClose: { type: Number, default: null },
  volume: { type: Number, default: null },
  openInterest: { type: Number, default: null },
}, { _id: false, strict: 'throw' });

const marketObservationSchema = new mongoose.Schema({
  schemaVersion: { type: String, required: true },
  kind: { type: String, enum: ['MUTUAL_FUND_NAV', 'MARKET_QUOTE'], required: true },
  canonicalProductId: { type: String, required: true, index: true },
  value: { type: Number, required: true },
  currency: { type: String, default: null },
  unit: { type: String, required: true },
  observedAt: { type: Date, required: true },
  providerTimestamp: { type: Date, default: null },
  effectiveTradingDate: { type: String, default: null },
  firstFetchedAt: { type: Date, required: true },
  lastFetchedAt: { type: Date, required: true },
  dataClass: { type: String, enum: ['LIVE', 'DELAYED', 'DAILY'], default: null },
  availabilityStatus: { type: String, enum: ['AVAILABLE'], required: true },
  freshness: { type: freshnessSchema, required: true },
  source: {
    provider: { type: String, enum: ['AMFI', 'NSE', 'UPSTOX'], required: true },
    instrumentId: { type: String, required: true },
    url: { type: String, required: true },
  },
  metrics: { type: metricsSchema, default: () => ({}) },
}, { strict: 'throw', timestamps: true });

marketObservationSchema.index(
  { kind: 1, 'source.provider': 1, 'source.instrumentId': 1, observedAt: 1 },
  { unique: true, name: 'unique_verified_market_observation' },
);
marketObservationSchema.index({ kind: 1, observedAt: -1 });

export default mongoose.model('MarketObservation', marketObservationSchema);
