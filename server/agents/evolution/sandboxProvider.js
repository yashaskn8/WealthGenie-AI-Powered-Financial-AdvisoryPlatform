import path from 'node:path';

export function createSandboxProvider({ enabled = false, allowedRoots = [], production = false } = {}) {
  const roots = allowedRoots.map(root => path.resolve(root));
  return Object.freeze({
    enabled: Boolean(enabled) && !production,
    async run() {
      const error = new Error('Evolution sandbox execution is disabled by default.');
      error.code = 'SANDBOX_DISABLED';
      throw error;
    },
    isPathAllowed(candidate) {
      if (!candidate || !roots.length) return false;
      const resolved = path.resolve(candidate);
      return roots.some(root => resolved === root || resolved.startsWith(`${root}${path.sep}`));
    },
  });
}
