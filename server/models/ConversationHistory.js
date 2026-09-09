import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'model'],
    required: true,
  },
  content: {
    type: String,
    required: true,
    maxlength: 8000,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  metadata: {
    // Populated only for model messages
    tokens_used: Number,
    latency_ms: Number,
    grounded_on_profile: Boolean,
    disclaimer_appended: Boolean,
    provider: { type: String, enum: ['gemini', 'groq', 'NVIDIA_NIM', 'GEMINI', 'GROQ', 'DETERMINISTIC_TEMPLATE', 'SYSTEM'] },
    model: { type: String, default: null },
    grounding_version: String,
    prompt_version: String,
    evidence_hash: String,
    evidence_ids_used: [String],
    unavailable_facts: [String],
    citations: [mongoose.Schema.Types.Mixed],
    validation_status: String,
    validation_reason_codes: [String],
    fallback_used: Boolean,
    prompt_injection_detected: Boolean,
    generated_at: Date,
  },
});

const ConversationHistorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  profileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FinancialProfile',
    required: true,
  },
  session_id: {
    type: String,
    required: true,
    index: true,
  },
  messages: [MessageSchema],
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  message_count: { type: Number, default: 0 },
  cumulative_tokens: { type: Number, default: 0 },
  cumulative_hops: { type: Number, default: 0 },
  is_active: { type: Boolean, default: true },
});

const MAX_MESSAGES_PER_SESSION = 200;

// Auto-update updated_at, message_count, and enforce message cap on save
ConversationHistorySchema.pre('save', function (next) {
  this.updated_at = new Date();
  // Enforce maximum messages per session — trim oldest if exceeded
  if (this.messages.length > MAX_MESSAGES_PER_SESSION) {
    this.messages = this.messages.slice(-MAX_MESSAGES_PER_SESSION);
  }
  this.message_count = this.messages.length;
  next();
});

// Index for efficient session retrieval
ConversationHistorySchema.index({ userId: 1, updated_at: -1 });

export default mongoose.model('ConversationHistory', ConversationHistorySchema);
