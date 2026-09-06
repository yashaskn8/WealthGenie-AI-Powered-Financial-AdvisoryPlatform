import mongoose from 'mongoose';

const GoalSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  profileId:  { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialProfile' },
  goal_name:  { type: String, required: true, trim: true, maxlength: 100 },
  target_amount:  { type: Number, required: true, min: 1000 },
  inflation_adjusted_target: { type: Number },
  target_date:    { type: Date,   required: true },
  current_savings:       { type: Number, default: 0, min: 0 },
  recommended_sip:       { type: Number, min: 0 },    // computed field
  recommended_instrument: { type: String },
  probability_of_success: { type: Number, min: 0, max: 1 },  // 0–1 decimal
  gap_amount:             { type: Number, min: 0 },
  priority:               { type: String, enum: ['Critical', 'High', 'Medium', 'Low'], default: 'Medium' },
  status: {
    type: String,
    enum: ['on_track', 'at_risk', 'off_track'],
    default: 'on_track',
  },
  monte_carlo_summary: {
    p10: { type: Number, min: 0 },
    p25: { type: Number, min: 0 },
    p50: { type: Number, min: 0 },
    p75: { type: Number, min: 0 },
    p90: { type: Number, min: 0 },
    simulations_run: { type: Number, min: 0 },
  },
  chart_data: [{
    year: { type: Number },
    p10:  { type: Number },
    p25:  { type: Number },
    p50:  { type: Number },
    p75:  { type: Number },
    p90:  { type: Number }
  }],
  mc_computed_at: { type: Date },
  years_remaining: { type: Number },
  simulation_classification: {
    type: String,
    enum: ['PROFILE_GROUNDED_GOAL_PLAN', 'NON_RECOMMENDATION_GOAL_WHAT_IF'],
  },
  return_basis: { type: String, enum: ['PRE_TAX_NOMINAL'] },
  inflation_assumption: { type: Number, min: 0, max: 1 },
  gemini_advice: { type: String, maxlength: 2000 },
}, { timestamps: true });

GoalSchema.index({ userId: 1, target_date: 1 });
GoalSchema.index({ userId: 1, status: 1 });
GoalSchema.index(
  { userId: 1, goal_name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
);

export default mongoose.model('Goal', GoalSchema);
