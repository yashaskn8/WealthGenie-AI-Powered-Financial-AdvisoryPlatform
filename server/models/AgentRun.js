import mongoose from 'mongoose';
import {
  PLAN_REVIEW_AGENT_VERSION,
  PLAN_REVIEW_GRAPH_VERSION,
  PLAN_REVIEW_RUN_STATES,
} from '../agents/planReview/planReviewRuntime.js';

const agentRunSchema = new mongoose.Schema({
  runId: { type: String, required: true, unique: true, immutable: true, index: true },
  agentType: { type: String, enum: ['PLAN_REVIEW'], required: true, immutable: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true, index: true },
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialProfile', default: null, immutable: true },
  recommendationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Recommendation', default: null, immutable: true },
  planReviewSnapshotHash: { type: String, required: true, immutable: true, match: /^[a-f0-9]{64}$/ },
  sourceBinding: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  status: { type: String, enum: PLAN_REVIEW_RUN_STATES, required: true, index: true },
  priority: { type: String, enum: ['INTERACTIVE_PLAN_REVIEW', 'PLAN_HEALTH_BACKGROUND'], default: 'INTERACTIVE_PLAN_REVIEW', index: true },
  recommendedAction: { type: String, default: 'INSUFFICIENT_EVIDENCE' },
  findingCodes: { type: [String], default: [] },
  evidenceIds: { type: [String], default: [] },
  provider: { type: String, default: 'DETERMINISTIC_FALLBACK' },
  model: { type: String, default: null },
  plannerVersion: { type: String, default: 'plan-review-planner-1.0.0' },
  policyVersion: { type: String, default: 'plan-review-policy-1.0.0' },
  groundingVersion: { type: String, default: null },
  agentVersion: { type: String, default: PLAN_REVIEW_AGENT_VERSION, immutable: true },
  graphVersion: { type: String, default: PLAN_REVIEW_GRAPH_VERSION, immutable: true },
  toolCatalogVersion: { type: String, default: 'plan-review-tools-1.0.0', immutable: true },
  traceId: { type: String, default: null },
  correlationId: { type: String, default: null },
  stepCount: { type: Number, min: 0, max: 6, default: 0 },
  toolCallCount: { type: Number, min: 0, max: 8, default: 0 },
  modelCallCount: { type: Number, min: 0, max: 2, default: 0 },
  tokenUsage: { type: Number, min: 0, max: 5200, default: 0 },
  result: { type: mongoose.Schema.Types.Mixed, default: null },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  queuedAt: { type: Date, default: Date.now, immutable: true },
  lastHeartbeatAt: { type: Date, default: null },
  leaseUntil: { type: Date, default: null },
  retryAt: { type: Date, default: null },
  workerId: { type: String, default: null },
  executionGeneration: { type: Number, min: 0, default: 0 },
  attempt: { type: Number, min: 0, max: 2, default: 0 },
  maxAttempts: { type: Number, min: 1, max: 2, default: 2, immutable: true },
  dedupeKey: { type: String, default: null },
  activeDedupeKey: { type: String, default: null },
  currentNode: { type: String, default: null },
  progress: {
    completedNodes: { type: [String], default: [] },
    percent: { type: Number, min: 0, max: 100, default: 0 },
    label: { type: String, default: null },
  },
  checkpoint: { type: mongoose.Schema.Types.Mixed, default: null },
  checkpointSequence: { type: Number, min: 0, default: 0 },
  eventSequence: { type: Number, min: 0, default: 0 },
  trajectory: { type: [mongoose.Schema.Types.Mixed], default: [] },
  toolExecutionLedger: { type: [mongoose.Schema.Types.Mixed], default: [] },
  cancellationRequested: { type: Boolean, default: false },
  approval: { type: mongoose.Schema.Types.Mixed, default: null },
  failure: { type: mongoose.Schema.Types.Mixed, default: null },
  deadLetter: { type: mongoose.Schema.Types.Mixed, default: null },
}, {
  strict: 'throw',
  timestamps: true,
});

agentRunSchema.index({ userId: 1, createdAt: -1 });
agentRunSchema.index({ activeDedupeKey: 1 }, {
  unique: true,
  partialFilterExpression: { activeDedupeKey: { $exists: true } },
});
agentRunSchema.index({ status: 1, priority: 1, queuedAt: 1 });

export default mongoose.model('AgentRun', agentRunSchema);
