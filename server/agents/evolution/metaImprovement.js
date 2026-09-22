export const META_IMPROVEMENT_VERSION = 'meta-improvement-1.0.0';

export function createMetaImprovementPlanner({ enabled = false } = {}) {
  return Object.freeze({
    enabled: Boolean(enabled),
    version: META_IMPROVEMENT_VERSION,
    async propose() {
      const error = new Error('Meta-improvement research is disabled.');
      error.code = 'META_IMPROVEMENT_DISABLED';
      throw error;
    },
  });
}
