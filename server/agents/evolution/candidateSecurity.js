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

export function validateCandidateSurfaces({ mutationSurface = [], scaffoldSpec = {} } = {}) {
  const surfaces = Array.isArray(mutationSurface) ? mutationSurface : [mutationSurface];
  surfaces.forEach(assertEvolutionSurfaceAllowed);
  const forbiddenKeys = ['code', 'script', 'executable', 'financialAuthority', 'taxRules', 'allocationWeights', 'authorizationPolicy', 'holdoutLoader', 'promotionPolicy'];
  const serialized = JSON.stringify(scaffoldSpec);
  if (forbiddenKeys.some(key => serialized.includes(`"${key}"`))) {
    const error = new Error('Candidate contains a forbidden evolution surface.');
    error.code = 'FORBIDDEN_CANDIDATE_SURFACE';
    throw error;
  }
  return true;
}
