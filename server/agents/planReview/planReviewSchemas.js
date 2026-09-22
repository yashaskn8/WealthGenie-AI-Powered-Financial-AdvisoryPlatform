import Joi from 'joi';

export const PLAN_REVIEW_VERSION = 'plan-review-1.0.0';
export const PLAN_REVIEW_PLANNER_VERSION = 'plan-review-planner-1.0.0';
export const PLAN_REVIEW_POLICY_VERSION = 'plan-review-policy-1.0.0';

export const MAX_AGENT_STEPS = 6;
export const MAX_TOOL_CALLS = 8;
export const MAX_TOOL_CALLS_PER_TOOL = 2;

export const SAFE_PLAN_REVIEW_TOOLS = Object.freeze([
  'get_current_profile_context',
  'get_current_recommendation_summary',
  'check_recommendation_freshness',
  'get_plan_evidence_snapshot',
  'get_goal_status_summary',
]);

export const PLAN_REVIEW_ACTIONS = Object.freeze([
  'NONE',
  'REVIEW_PROFILE',
  'RECOMPUTE_PLAN',
  'REVIEW_GOALS',
  'INSUFFICIENT_EVIDENCE',
]);

const objectId = Joi.string().pattern(/^[0-9a-fA-F]{24}$/).message('Invalid ID format');

export const planReviewRequestSchema = Joi.object({
  profileId: objectId.required(),
}).unknown(false);

export const planReviewActionSchema = Joi.object({
  action: Joi.string().valid('APPROVE_RECOMPUTE', 'REJECT_RECOMPUTE', 'OPEN_PROFILE', 'OPEN_GOALS').required(),
}).unknown(false);

const plannerCheckSchema = Joi.string().valid(...SAFE_PLAN_REVIEW_TOOLS);
export const plannerPlanSchema = Joi.object({
  checks: Joi.array().items(plannerCheckSchema).min(1).max(SAFE_PLAN_REVIEW_TOOLS.length).unique().required(),
}).unknown(false);

const findingSchema = Joi.object({
  code: Joi.string().pattern(/^[A-Z0-9_]{2,80}$/).required(),
  severity: Joi.string().valid('INFO', 'ATTENTION', 'BLOCKED').required(),
  title: Joi.string().trim().min(1).max(160).required(),
  detail: Joi.string().trim().min(1).max(500).required(),
  evidenceIds: Joi.array().items(Joi.string().pattern(/^E_[A-Z0-9_:-]+$/)).max(20).default([]),
}).unknown(false);

export const planReviewResponseSchema = Joi.object({
  version: Joi.string().valid(PLAN_REVIEW_VERSION).required(),
  runId: Joi.string().guid({ version: ['uuidv4'] }).required(),
  status: Joi.string().valid('COMPLETED', 'FAILED', 'FEATURE_UNAVAILABLE').required(),
  recommendedAction: Joi.string().valid(...PLAN_REVIEW_ACTIONS).required(),
  summary: Joi.string().trim().min(1).max(2000).required(),
  findings: Joi.array().items(findingSchema).max(12).required(),
  freshness: Joi.object({
    fresh: Joi.boolean().required(),
    reasonCodes: Joi.array().items(Joi.string().pattern(/^[A-Z0-9_]{2,100}$/)).max(20).required(),
  }).unknown(false).required(),
  goals: Joi.object({
    status: Joi.string().valid('AVAILABLE', 'NONE', 'UNAVAILABLE').required(),
    items: Joi.array().max(20).required(),
  }).unknown(false).required(),
  evidence: Joi.object({
    status: Joi.string().valid('AVAILABLE', 'UNAVAILABLE').required(),
    entries: Joi.array().max(40).required(),
    unavailableFacts: Joi.array().items(Joi.string().max(120)).max(20).required(),
  }).unknown(false).required(),
  provider: Joi.object({
    name: Joi.string().max(80).required(),
    model: Joi.string().max(160).allow(null).required(),
    fallback: Joi.boolean().required(),
  }).unknown(false).required(),
  execution: Joi.object({
    stepCount: Joi.number().integer().min(0).max(MAX_AGENT_STEPS).required(),
    toolCallCount: Joi.number().integer().min(0).max(MAX_TOOL_CALLS).required(),
  }).unknown(false).required(),
  policyReasonCodes: Joi.array().items(Joi.string().max(120)).max(20).optional(),
}).unknown(false);

export function validatePlannerPlan(value) {
  return plannerPlanSchema.validate(value, { abortEarly: false, convert: false });
}

export function validatePlanReviewResponse(value) {
  return planReviewResponseSchema.validate(value, { abortEarly: false, convert: false });
}
