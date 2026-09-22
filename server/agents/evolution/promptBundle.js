import { canonicalSha256 } from '../../utils/canonicalJson.js';

export const PROMPT_BUNDLE_VERSION = 'prompt-bundle-1.0.0';
export const MAX_PROMPT_FIELD_LENGTH = 12000;

const PROMPT_FIELDS = Object.freeze(['plannerInstruction', 'synthesisInstruction']);

const DEFAULT_PROMPT_CONTENT = Object.freeze({
  plannerInstruction: 'You are a bounded routing planner for a read-only financial plan review.',
  synthesisInstruction: 'Review the current saved financial plan for evidence alignment. Do not propose new allocations, weights, products, tax results, or changes. State only what the evidence supports and its limitations.',
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function assertSafeText(value, field) {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string.`);
  if (value.length === 0 || value.length > MAX_PROMPT_FIELD_LENGTH) {
    throw new Error(`${field} exceeds the prompt bundle length limit.`);
  }
  if (value.includes('\u0000')) throw new Error(`${field} contains a null byte.`);
  if ([...value].some(character => character.charCodeAt(0) < 9)) {
    throw new Error(`${field} contains unsupported binary control content.`);
  }
  if (/(?:sk-|AIza|Bearer\s+[A-Za-z0-9._-]+|BEGIN\s+(?:RSA|EC|OPENSSH)\s+PRIVATE KEY)/i.test(value)) {
    throw new Error(`${field} appears to contain a credential or private key.`);
  }
  return value;
}

function assertSafeMetadata(value, path = 'metadata') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be a plain object.`);
  }
  if (JSON.stringify(value).length > 4000) throw new Error('PromptBundle metadata exceeds the length limit.');
  for (const [key, child] of Object.entries(value)) {
    if (/email|phone|income|salary|password|token|jwt|secret|profile|userId|account|bank/i.test(key)) {
      throw new Error(`${path}.${key} is not allowed in a PromptBundle.`);
    }
    if (typeof child === 'string') assertSafeText(child, `${path}.${key}`);
    else if (child && typeof child === 'object' && !Array.isArray(child)) assertSafeMetadata(child, `${path}.${key}`);
    else if (Array.isArray(child) || typeof child === 'function') throw new Error(`${path}.${key} contains unsupported content.`);
  }
}

function bundlePayload({ bundleId, version, plannerInstruction, synthesisInstruction, metadata }) {
  return {
    bundleId,
    version,
    plannerInstruction,
    synthesisInstruction,
    metadata,
  };
}

export function assertPromptBundleSafe(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) throw new TypeError('PromptBundle must be an object.');
  for (const field of PROMPT_FIELDS) assertSafeText(bundle[field], field);
  if (bundle.metadata !== undefined && (!bundle.metadata || typeof bundle.metadata !== 'object' || Array.isArray(bundle.metadata))) {
    throw new TypeError('PromptBundle metadata must be a plain object.');
  }
  if (bundle.metadata !== undefined) assertSafeMetadata(bundle.metadata);
  if (bundle.contentHash && !/^[a-f0-9]{64}$/.test(bundle.contentHash)) throw new Error('PromptBundle contentHash is invalid.');
  return true;
}

export function createPromptBundle(input = {}) {
  const bundleId = String(input.bundleId || 'plan-review-champion');
  const version = String(input.version || PROMPT_BUNDLE_VERSION);
  const plannerInstruction = input.plannerInstruction ?? DEFAULT_PROMPT_CONTENT.plannerInstruction;
  const synthesisInstruction = input.synthesisInstruction ?? DEFAULT_PROMPT_CONTENT.synthesisInstruction;
  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? { ...input.metadata }
    : {};
  assertPromptBundleSafe({ plannerInstruction, synthesisInstruction, metadata });
  const payload = bundlePayload({ bundleId, version, plannerInstruction, synthesisInstruction, metadata });
  return deepFreeze({ ...payload, contentHash: canonicalSha256(payload) });
}

export const CURRENT_PROMPT_BUNDLE = createPromptBundle({
  bundleId: 'plan-review-champion',
  version: 'plan-review-prompts-1.0.0',
  metadata: { source: 'repository', authority: 'read-only-plan-review' },
});

export function verifyPromptBundleHash(bundle, expectedHash) {
  assertPromptBundleSafe(bundle);
  const payload = bundlePayload(bundle);
  const actual = canonicalSha256(payload);
  if (actual !== bundle.contentHash || (expectedHash && actual !== expectedHash)) {
    const error = new Error('PromptBundle content hash mismatch.');
    error.code = 'PROMPT_BUNDLE_HASH_MISMATCH';
    throw error;
  }
  return actual;
}

export function createPromptBundleRegistry(initialBundles = [CURRENT_PROMPT_BUNDLE]) {
  const bundles = new Map();
  for (const bundle of initialBundles) {
    verifyPromptBundleHash(bundle);
    bundles.set(bundle.bundleId, bundle);
  }
  return Object.freeze({
    get(bundleId, contentHash) {
      const bundle = bundles.get(String(bundleId || ''));
      if (!bundle) return null;
      verifyPromptBundleHash(bundle, contentHash);
      return bundle;
    },
    register(bundle) {
      verifyPromptBundleHash(bundle);
      if (bundles.has(bundle.bundleId)) {
        const existing = bundles.get(bundle.bundleId);
        if (existing.contentHash !== bundle.contentHash) throw new Error('PromptBundle IDs are immutable.');
        return existing;
      }
      bundles.set(bundle.bundleId, bundle);
      return bundle;
    },
  });
}

export function resolvePromptBundle({ dependencies = {}, scaffoldSpec = null } = {}) {
  const direct = dependencies.promptBundle || scaffoldSpec?.promptBundle;
  if (direct) {
    verifyPromptBundleHash(direct, scaffoldSpec?.promptBundleHash);
    return direct;
  }
  const registry = dependencies.promptBundleRegistry;
  if (registry && typeof registry.get === 'function' && scaffoldSpec?.promptBundleId) {
    const resolved = registry.get(scaffoldSpec.promptBundleId, scaffoldSpec.promptBundleHash);
    if (!resolved) throw new Error('Referenced PromptBundle is not registered.');
    return resolved;
  }
  return CURRENT_PROMPT_BUNDLE;
}

export { DEFAULT_PROMPT_CONTENT, PROMPT_FIELDS };
