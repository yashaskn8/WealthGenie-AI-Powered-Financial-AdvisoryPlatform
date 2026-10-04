import { assertPromptBundleSafe } from './promptBundle.js';
import { assertEvolutionSurfaceAllowed } from './evolutionSurfaceRegistry.js';

const UNSAFE_PROMPT_PATTERNS = Object.freeze([
  /ignore\s+(?:all|any|the)\s+previous/i,
  /disable\s+(?:the\s+)?(?:policy|guard|verifier|holdout|authority)/i,
  /bypass\s+(?:the\s+)?(?:policy|guard|verifier|approval)/i,
  /reveal\s+(?:secrets?|tokens?|credentials?|jwt)/i,
  /(?:rm\s+-rf|curl\s+https?:|wget\s+https?:|git\s+(?:push|commit))/i,
  /(?:process\.env|child_process|exec\s*\()/i,
  /(?:promote\s+yourself|self[- ]promot)/i,
]);

export function scanPromptBundleSecurity(bundle) {
  assertPromptBundleSafe(bundle);
  const findings = [];
  for (const [field, value] of Object.entries(bundle)) {
    if (typeof value !== 'string') continue;
    for (const pattern of UNSAFE_PROMPT_PATTERNS) {
      if (pattern.test(value)) findings.push({ field, reason: pattern.source });
    }
  }
  if (findings.length) {
    const error = new Error('PromptBundle security scan rejected the candidate.');
    error.code = 'UNSAFE_PROMPT_BUNDLE';
    error.findings = findings;
    throw error;
  }
  return Object.freeze({ passed: true, findings: [] });
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateCandidateSurfaces({ mutationSurface = [], scaffoldSpec = {}, parentScaffoldSpec = null } = {}) {
  const surfaces = Array.isArray(mutationSurface) ? mutationSurface : [mutationSurface];
  surfaces.forEach(assertEvolutionSurfaceAllowed);
  if (parentScaffoldSpec) {
    const checks = [
      ['promptBundle.plannerInstruction', scaffoldSpec.promptBundle?.plannerInstruction, parentScaffoldSpec.promptBundle?.plannerInstruction],
      ['promptBundle.synthesisInstruction', scaffoldSpec.promptBundle?.synthesisInstruction, parentScaffoldSpec.promptBundle?.synthesisInstruction],
      ['evidenceOrderingPolicy', scaffoldSpec.evidenceOrderingPolicy, parentScaffoldSpec.evidenceOrderingPolicy],
      ['contextCompressionPolicy', scaffoldSpec.contextCompressionPolicy, parentScaffoldSpec.contextCompressionPolicy],
      ['safeModelRoleRouting', scaffoldSpec.safeModelRoleRouting, parentScaffoldSpec.safeModelRoleRouting],
    ];
    const actualChanges = checks.filter(([, candidate, parent]) => !sameValue(candidate, parent)).map(([surface]) => surface);
    if (actualChanges.some(surface => !surfaces.includes(surface)) || surfaces.some(surface => !actualChanges.includes(surface))) {
      const error = new Error('Candidate mutationSurface must exactly match the scaffold fields changed from its parent.');
      error.code = 'EVOLUTION_SURFACE_DELTA_MISMATCH';
      throw error;
    }
  }
  const forbiddenKeys = ['code', 'script', 'executable', 'financialAuthority', 'taxRules', 'allocationWeights', 'authorizationPolicy', 'holdoutLoader', 'promotionPolicy'];
  const serialized = JSON.stringify(scaffoldSpec);
  if (forbiddenKeys.some(key => serialized.includes(`"${key}"`))) {
    const error = new Error('Candidate contains a forbidden evolution surface.');
    error.code = 'FORBIDDEN_CANDIDATE_SURFACE';
    throw error;
  }
  return true;
}
