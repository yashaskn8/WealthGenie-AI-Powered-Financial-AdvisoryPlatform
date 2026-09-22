import crypto from 'node:crypto';
import Joi from 'joi';

const id = Joi.string().trim().min(1).max(160);
const isoDate = Joi.string().isoDate();

const knownSourceDateSchema = Joi.object({
  sourceId: id.required(),
  date: isoDate.required(),
}).unknown(false);

const freshnessRequirementSchema = Joi.object({
  maxAgeHours: Joi.number().integer().min(1).max(8760).default(168),
  requiredSourceTier: Joi.string().valid('OFFICIAL_PRIMARY', 'PRIMARY_ISSUER', 'TRUSTED_SECONDARY', 'UNVERIFIED').default('TRUSTED_SECONDARY'),
}).unknown(false).default({ maxAgeHours: 168, requiredSourceTier: 'TRUSTED_SECONDARY' });

export const researchBriefSchema = Joi.object({
  researchBriefId: id.required(),
  topic: Joi.string().trim().min(2).max(180).required(),
  question: Joi.string().trim().min(5).max(800).required(),
  jurisdiction: Joi.string().trim().min(2).max(80).required(),
  asOf: isoDate.required(),
  requestedFactTypes: Joi.array().items(Joi.string().trim().pattern(/^[a-z][a-z0-9_:-]{1,79}$/)).min(1).max(8).unique().required(),
  instrumentCategories: Joi.array().items(Joi.string().trim().max(80)).max(8).unique().default([]),
  regulatoryContext: Joi.object({
    policyVersion: Joi.string().trim().max(120).allow(null).default(null),
    sourcePolicyVersion: Joi.string().trim().max(120).allow(null).default(null),
    notes: Joi.string().trim().max(240).allow(null).default(null),
  }).unknown(false).default({ policyVersion: null, sourcePolicyVersion: null, notes: null }),
  knownEvidenceIds: Joi.array().items(id).max(40).unique().default([]),
  knownSourceDates: Joi.array().items(knownSourceDateSchema).max(40).default([]),
  freshnessRequirement: freshnessRequirementSchema,
  maxResearchDepth: Joi.number().integer().min(0).max(3).required(),
  correlationId: id.allow(null).default(null),
  runId: id.allow(null).default(null),
}).unknown(false);

const sourceSchema = Joi.object({
  sourceId: id.required(),
  canonicalUrl: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
  title: Joi.string().trim().max(240).allow(null).required(),
  publisher: Joi.string().trim().max(160).allow(null).required(),
  publicationDate: isoDate.allow(null).required(),
  retrievedAt: isoDate.required(),
  sourceTrustTier: Joi.string().valid('OFFICIAL_PRIMARY', 'PRIMARY_ISSUER', 'TRUSTED_SECONDARY', 'UNVERIFIED').required(),
  documentHash: Joi.string().hex().length(64).required(),
}).unknown(false);

const evidenceUnitSchema = Joi.object({
  evidenceId: id.required(),
  sourceId: id.required(),
  documentHash: Joi.string().hex().length(64).required(),
  title: Joi.string().trim().max(240).allow(null).required(),
  publisher: Joi.string().trim().max(160).allow(null).required(),
  canonicalUrl: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
  publicationDate: isoDate.allow(null).required(),
  retrievedAt: isoDate.required(),
  section: Joi.string().trim().max(160).allow(null).required(),
  claimCandidate: Joi.string().trim().min(1).max(700).required(),
  supportingExcerptHash: Joi.string().hex().length(64).required(),
  supportingExcerpt: Joi.string().trim().min(1).max(800).required(),
  factType: Joi.string().trim().max(100).required(),
  sourceTrustTier: Joi.string().valid('OFFICIAL_PRIMARY', 'PRIMARY_ISSUER', 'TRUSTED_SECONDARY', 'UNVERIFIED').required(),
  freshnessStatus: Joi.string().valid('FRESH', 'STALE', 'UNKNOWN').required(),
}).unknown(false);

const claimSchema = Joi.object({
  claimId: id.required(),
  text: Joi.string().trim().min(1).max(700).required(),
  claimType: Joi.string().trim().max(100).required(),
  supportingEvidenceIds: Joi.array().items(id).max(12).unique().required(),
  contradictingEvidenceIds: Joi.array().items(id).max(12).unique().required(),
  supportStatus: Joi.string().valid('SUPPORTED', 'PARTIALLY_SUPPORTED', 'CONTRADICTED', 'UNVERIFIED').required(),
  confidenceBand: Joi.string().valid('HIGH', 'MEDIUM', 'LOW', 'NONE').required(),
  freshnessStatus: Joi.string().valid('FRESH', 'STALE', 'UNKNOWN').required(),
  sourceTrustTier: Joi.string().valid('OFFICIAL_PRIMARY', 'PRIMARY_ISSUER', 'TRUSTED_SECONDARY', 'UNVERIFIED').required(),
  asOf: isoDate.allow(null).required(),
}).unknown(false);

export const researchArtifactSchema = Joi.object({
  artifactId: id.required(),
  version: Joi.string().valid('1.0.0').required(),
  researchBriefId: id.required(),
  taskId: id.allow(null).required(),
  agentVersion: Joi.string().trim().max(120).required(),
  researchPolicyVersion: Joi.string().trim().max(120).required(),
  createdAt: isoDate.required(),
  asOf: isoDate.required(),
  status: Joi.string().valid('COMPLETED', 'CONFLICTING_EVIDENCE', 'INSUFFICIENT_EVIDENCE', 'BUDGET_EXHAUSTED').required(),
  claims: Joi.array().items(claimSchema).max(80).required(),
  evidenceUnits: Joi.array().items(evidenceUnitSchema).max(160).required(),
  sources: Joi.array().items(sourceSchema).max(80).required(),
  contradictions: Joi.array().max(40).required(),
  unresolvedGaps: Joi.array().max(20).required(),
  researchBudgetUsed: Joi.object().unknown(true).required(),
  queryCount: Joi.number().integer().min(0).required(),
  documentCount: Joi.number().integer().min(0).required(),
  modelCalls: Joi.number().integer().min(0).required(),
  tokenUsage: Joi.number().integer().min(0).required(),
  durationMs: Joi.number().integer().min(0).required(),
  contentHash: Joi.string().hex().length(64).required(),
  parentArtifactId: id.allow(null).required(),
  financialAuthorityDelta: Joi.number().valid(0).required(),
}).unknown(false);

const PRIVATE_KEYS = new Set([
  'email',
  'phone',
  'monthlyTakeHome',
  'monthly_income',
  'monthlyIncome',
  'jwt',
  'token',
  'userId',
  'rawProfile',
  'password',
  'passwordHash',
  'bankDetails',
]);
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const JWT_PATTERN = /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/;

export function assertResearchBriefPrivacy(value, path = 'researchBrief') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertResearchBriefPrivacy(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_KEYS.has(key)) {
      const error = new Error(`ResearchBrief contains a private field: ${path}.${key}`);
      error.code = 'RESEARCH_BRIEF_PRIVACY_VIOLATION';
      throw error;
    }
    if (typeof child === 'string' && (EMAIL_PATTERN.test(child) || JWT_PATTERN.test(child))) {
      const error = new Error(`ResearchBrief contains private credentials or identifiers: ${path}.${key}`);
      error.code = 'RESEARCH_BRIEF_PRIVACY_VIOLATION';
      throw error;
    }
    assertResearchBriefPrivacy(child, `${path}.${key}`);
  }
}

export function validateResearchBrief(value) {
  const result = researchBriefSchema.validate(value, { abortEarly: false, convert: true });
  if (result.error) return result;
  try {
    assertResearchBriefPrivacy(result.value);
  } catch (error) {
    return { value: undefined, error: { message: error.message, details: [{ type: error.code }] } };
  }
  return result;
}

export function validateResearchArtifact(value) {
  return researchArtifactSchema.validate(value, { abortEarly: false, convert: false });
}

export function createResearchBrief({
  researchBriefId = crypto.randomUUID(),
  topic,
  question,
  jurisdiction = 'IN',
  asOf = new Date().toISOString(),
  requestedFactTypes,
  instrumentCategories = [],
  regulatoryContext = {},
  knownEvidenceIds = [],
  knownSourceDates = [],
  freshnessRequirement = {},
  maxResearchDepth = 1,
  correlationId = null,
  runId = null,
} = {}) {
  const result = validateResearchBrief({
    researchBriefId,
    topic,
    question,
    jurisdiction,
    asOf,
    requestedFactTypes,
    instrumentCategories,
    regulatoryContext,
    knownEvidenceIds,
    knownSourceDates,
    freshnessRequirement,
    maxResearchDepth,
    correlationId,
    runId,
  });
  if (result.error) {
    const error = new Error('Invalid ResearchBrief.');
    error.code = 'INVALID_RESEARCH_BRIEF';
    error.details = result.error.details;
    throw error;
  }
  return Object.freeze(result.value);
}
