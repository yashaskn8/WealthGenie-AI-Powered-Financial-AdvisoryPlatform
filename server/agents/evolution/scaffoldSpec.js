import crypto from 'node:crypto';
import { SAFE_PLAN_REVIEW_TOOLS } from '../planReview/planReviewSchemas.js';
import { isVerifiedPromotionAuthorization, verifyPromotionAuthorization } from './promotionAuthorization.js';
import { CURRENT_PROMPT_BUNDLE, verifyPromptBundleHash } from './promptBundle.js';

export const SCAFFOLD_SPEC_VERSION = 'scaffold-spec-1.0.0';
const SAFE_EVIDENCE_ORDERING_POLICIES = Object.freeze(['AS_RECEIVED', 'AUTHORITATIVE_FIRST', 'FRESHNESS_FIRST']);
const SAFE_CONTEXT_POLICIES = Object.freeze(['BOUNDED_PROFILE_CONTEXT', 'MINIMAL_PROFILE_CONTEXT']);
const SAFE_MODEL_ROLES = Object.freeze(['PLANNER', 'EXPLAINER']);
export const IMMUTABLE_FINANCIAL_SURFACES = Object.freeze([
  'recommendation_service',
  'suitability_gate',
  'tax_engine',
  'projection_engine',
  'provider_adapters',
  'market_context_policy',
  'authorization_policy',
  'mandate_verifier',
  'trusted_approval_provider',
  'authorized_action_executor',
  'authorization_replay_protection',
  'authorization_receipts',
  'authorization_key_provider',
]);

const FORBIDDEN_KEYS = new Set([
  'code', 'executable', 'script', 'financialAuthority', 'allocationWeights', 'taxRules',
  'recommendationWeights', 'portfolioMutation', 'providerCredentials', 'shellCommand',
  'authorizationPolicy', 'mandateVerifier', 'trustedApprovalProvider', 'webAuthnVerification',
  'authorizedActionExecutor', 'capabilityGrant', 'replayProtection', 'mandateTtlMaximum',
  'auditReceiptValidation', 'authorizationSigningKey', 'verifiableActions',
]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function walk(value, path = []) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      const error = new Error(`Scaffold field is not allowed: ${[...path, key].join('.')}`);
      error.code = 'UNSAFE_SCAFFOLD_FIELD';
      throw error;
    }
    if (typeof child === 'function') {
      const error = new Error('Scaffold specifications cannot contain executable values.');
      error.code = 'EXECUTABLE_SCAFFOLD_REJECTED';
      throw error;
    }
    walk(child, [...path, key]);
  }
}

export function assertScaffoldSpecSafe(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new TypeError('ScaffoldSpec must be an object.');
  walk(spec);
  if (spec.agentType !== 'PLAN_REVIEW') throw new Error('Only the bounded PLAN_REVIEW scaffold is registered.');
  const tools = spec.tools || [];
  if (!tools.every(tool => SAFE_PLAN_REVIEW_TOOLS.includes(tool))) {
    const error = new Error('Scaffold tools must be safe, read-only plan review tools.');
    error.code = 'UNSAFE_SCAFFOLD_TOOL';
    throw error;
  }
  if (spec.immutableSurfaces?.some(surface => !IMMUTABLE_FINANCIAL_SURFACES.includes(surface))) {
    throw new Error('Scaffold immutable surface list contains an unknown surface.');
  }
  if (spec.promptBundleId && (!spec.promptBundleHash || !/^[a-f0-9]{64}$/.test(spec.promptBundleHash))) {
    throw new Error('Scaffold PromptBundle reference must include a valid hash.');
  }
  if (spec.evidenceOrderingPolicy && !SAFE_EVIDENCE_ORDERING_POLICIES.includes(spec.evidenceOrderingPolicy)) {
    throw new Error('Scaffold evidence ordering policy is not allowlisted.');
  }
  if (spec.contextCompressionPolicy && !SAFE_CONTEXT_POLICIES.includes(spec.contextCompressionPolicy)) {
    throw new Error('Scaffold context compression policy is not allowlisted.');
  }
  if (spec.safeModelRoleRouting && Object.values(spec.safeModelRoleRouting).some(role => !SAFE_MODEL_ROLES.includes(role))) {
    throw new Error('Scaffold model role routing contains an unsafe role.');
  }
  return true;
}

export function createScaffoldSpec(input = {}) {
  walk(input);
  const promptBundle = input.promptBundle || CURRENT_PROMPT_BUNDLE;
  verifyPromptBundleHash(promptBundle);
  const spec = {
    specVersion: SCAFFOLD_SPEC_VERSION,
    scaffoldId: String(input.scaffoldId || 'plan-review'),
    version: String(input.version || '1.0.0'),
    parentVersion: input.parentVersion ? String(input.parentVersion) : null,
    agentType: 'PLAN_REVIEW',
    graphVersion: String(input.graphVersion || 'plan-review-graph-1.1.0'),
    tools: [...new Set(input.tools || SAFE_PLAN_REVIEW_TOOLS)],
    promptTemplateVersion: String(input.promptTemplateVersion || 'plan-review-prompts-1.0.0'),
    promptBundleId: String(input.promptBundleId || promptBundle.bundleId),
    promptBundleHash: String(input.promptBundleHash || promptBundle.contentHash),
    promptBundle,
    evidenceOrderingPolicy: String(input.evidenceOrderingPolicy || 'AS_RECEIVED'),
    contextCompressionPolicy: String(input.contextCompressionPolicy || 'BOUNDED_PROFILE_CONTEXT'),
    safeModelRoleRouting: {
      planner: String(input.safeModelRoleRouting?.planner || 'PLANNER'),
      synthesis: String(input.safeModelRoleRouting?.synthesis || 'EXPLAINER'),
    },
    softBudgets: {
      maxModelCalls: Math.min(2, Math.max(0, Number(input.softBudgets?.maxModelCalls ?? 2))),
      maxToolCalls: Math.min(8, Math.max(1, Number(input.softBudgets?.maxToolCalls ?? 8))),
    },
    immutableSurfaces: [...IMMUTABLE_FINANCIAL_SURFACES],
    featureFlag: String(input.featureFlag || 'AGENT_EVOLUTION_ENABLED'),
    metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {},
  };
  assertScaffoldSpecSafe(spec);
  verifyPromptBundleHash(promptBundle, spec.promptBundleHash);
  spec.contentHash = crypto.createHash('sha256').update(canonical(spec)).digest('hex');
  return deepFreeze(spec);
}

export class ScaffoldRegistry {
  constructor() {
    this.versions = new Map();
    this.champion = null;
    this.history = [];
  }

  register(spec, { source = 'human', evaluation = null, lifecycle = null } = {}) {
    assertScaffoldSpecSafe(spec);
    const key = `${spec.scaffoldId}@${spec.version}`;
    if (this.versions.has(key)) return this.versions.get(key);
    const record = Object.freeze({
      spec,
      source,
      lifecycle: lifecycle || (this.champion ? 'CHALLENGER' : 'CHAMPION'),
      evaluation: evaluation || null,
      registeredAt: new Date().toISOString(),
    });
    this.versions.set(key, record);
    if (!this.champion) this.champion = record;
    return record;
  }

  get(scaffoldId, version) { return this.versions.get(`${scaffoldId}@${version}`) || null; }
  current() { return this.champion; }
  shadowCandidates() { return [...this.versions.values()].filter(item => item !== this.champion); }

  shadowEvaluate(candidate, evaluation) {
    if (!candidate || candidate === this.champion) throw new Error('Shadow evaluation requires a challenger scaffold.');
    return Object.freeze({ candidateVersion: candidate.spec.version, evaluation, appliedToProduction: false });
  }

  promote(scaffoldId, version, { authorization, evaluation } = {}) {
    if (!evaluation?.passed || evaluation?.scoreCards?.some(card => card.hardGatePassed !== true)) {
      throw new Error('Only a passed, financially inert evaluation can be promoted.');
    }
    const record = this.get(scaffoldId, version);
    if (!record) throw new Error('Scaffold version is not registered.');
    verifyPromotionAuthorization({ authorization, candidate: record.spec, evaluation });
    this.champion = record;
    this.history.push({ action: 'PROMOTE', scaffoldId, version, reviewerId: authorization.reviewerId, approvalId: authorization.approvalId, at: new Date().toISOString() });
    return record;
  }

  rollback({ authorization } = {}) {
    if (!isVerifiedPromotionAuthorization(authorization) || !authorization?.verified || authorization.method !== 'WEBAUTHN' || !authorization.approvalId) throw new Error('Cryptographic WebAuthn human approval is required to rollback a scaffold.');
    const previous = [...this.versions.values()].filter(item => item !== this.champion).at(-1);
    if (!previous) throw new Error('No previous scaffold version is available for rollback.');
    this.champion = previous;
    this.history.push({ action: 'ROLLBACK', version: previous.spec.version, reviewerId: authorization.reviewerId, approvalId: authorization.approvalId, at: new Date().toISOString() });
    return previous;
  }
}

export const CURRENT_PLAN_REVIEW_SCAFFOLD = createScaffoldSpec({ scaffoldId: 'plan-review', version: '2.0.0' });

export function createDefaultScaffoldRegistry() {
  const registry = new ScaffoldRegistry();
  registry.register(CURRENT_PLAN_REVIEW_SCAFFOLD, { source: 'repository', lifecycle: 'CHAMPION' });
  return registry;
}
