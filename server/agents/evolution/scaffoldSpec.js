import crypto from 'node:crypto';
import { SAFE_PLAN_REVIEW_TOOLS } from '../planReview/planReviewSchemas.js';

export const SCAFFOLD_SPEC_VERSION = 'scaffold-spec-1.0.0';
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
  return true;
}

export function createScaffoldSpec(input = {}) {
  walk(input);
  const spec = {
    specVersion: SCAFFOLD_SPEC_VERSION,
    scaffoldId: String(input.scaffoldId || 'plan-review'),
    version: String(input.version || '1.0.0'),
    parentVersion: input.parentVersion ? String(input.parentVersion) : null,
    agentType: 'PLAN_REVIEW',
    graphVersion: String(input.graphVersion || 'plan-review-graph-1.1.0'),
    tools: [...new Set(input.tools || SAFE_PLAN_REVIEW_TOOLS)],
    promptTemplateVersion: String(input.promptTemplateVersion || 'plan-review-prompts-1.0.0'),
    immutableSurfaces: [...IMMUTABLE_FINANCIAL_SURFACES],
    featureFlag: String(input.featureFlag || 'AGENT_EVOLUTION_ENABLED'),
    metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {},
  };
  assertScaffoldSpecSafe(spec);
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

  promote(scaffoldId, version, { approvedBy, approvalId, evaluation } = {}) {
    if (!approvedBy || !approvalId) throw new Error('Human approval is required to promote a scaffold.');
    if (!evaluation?.passed || Number(evaluation?.hardGates?.financialAuthorityDelta || 0) !== 0) {
      throw new Error('Only a passed, financially inert evaluation can be promoted.');
    }
    const record = this.get(scaffoldId, version);
    if (!record) throw new Error('Scaffold version is not registered.');
    this.champion = record;
    this.history.push({ action: 'PROMOTE', scaffoldId, version, approvedBy, approvalId, at: new Date().toISOString() });
    return record;
  }

  rollback({ approvedBy, approvalId } = {}) {
    if (!approvedBy || !approvalId) throw new Error('Human approval is required to rollback a scaffold.');
    const previous = [...this.versions.values()].filter(item => item !== this.champion).at(-1);
    if (!previous) throw new Error('No previous scaffold version is available for rollback.');
    this.champion = previous;
    this.history.push({ action: 'ROLLBACK', version: previous.spec.version, approvedBy, approvalId, at: new Date().toISOString() });
    return previous;
  }
}

export const CURRENT_PLAN_REVIEW_SCAFFOLD = createScaffoldSpec({ scaffoldId: 'plan-review', version: '2.0.0' });

export function createDefaultScaffoldRegistry() {
  const registry = new ScaffoldRegistry();
  registry.register(CURRENT_PLAN_REVIEW_SCAFFOLD, { source: 'repository', lifecycle: 'CHAMPION' });
  return registry;
}
