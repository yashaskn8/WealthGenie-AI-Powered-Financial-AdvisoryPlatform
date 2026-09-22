export const EVOLUTION_SURFACE_REGISTRY_VERSION = 'evolution-surface-registry-1.0.0';

export const ALLOWED_EVOLUTION_SURFACES = Object.freeze([
  'promptBundle.plannerInstruction',
  'promptBundle.synthesisInstruction',
  'evidenceOrderingPolicy',
  'contextCompressionPolicy',
  'safeModelRoleRouting',
]);

export const FORBIDDEN_EVOLUTION_SURFACES = Object.freeze([
  'financialEngine',
  'risk',
  'tax',
  'suitability',
  'allocation',
  'eligibility',
  'ranking',
  'authorization',
  'identity',
  'a2aTrust',
  'mcpPermissions',
  'reliabilityHardGates',
  'holdoutLoader',
  'promotionPolicy',
  'sandboxPolicy',
  'deployment',
  'evaluator',
  'sourceCode',
]);

export function assertEvolutionSurfaceAllowed(surface) {
  const normalized = String(surface || '');
  if (!ALLOWED_EVOLUTION_SURFACES.includes(normalized)) {
    const error = new Error(`Evolution surface is not allowlisted: ${normalized || 'unknown'}`);
    error.code = 'EVOLUTION_SURFACE_REJECTED';
    throw error;
  }
  return true;
}

export function validateMutationSurfaces(surfaces = []) {
  if (!Array.isArray(surfaces) || surfaces.length === 0) throw new Error('At least one evolution surface is required.');
  const unique = [...new Set(surfaces.map(String))];
  unique.forEach(assertEvolutionSurfaceAllowed);
  return Object.freeze(unique);
}
