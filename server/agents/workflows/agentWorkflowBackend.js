export const AGENT_WORKFLOW_BACKENDS = Object.freeze(['mongo', 'temporal']);

export function createAgentWorkflowBackend({ backend = 'mongo', runner = null } = {}) {
  if (!AGENT_WORKFLOW_BACKENDS.includes(backend)) throw new Error('Unsupported agent workflow backend.');
  if (backend === 'temporal' && typeof runner !== 'object') {
    return Object.freeze({ name: 'temporal', available: false, async start() { throw new Error('Temporal adapter is not configured.'); } });
  }
  return Object.freeze({
    name: backend,
    available: backend === 'mongo' || Boolean(runner),
    async start(input) { return backend === 'mongo' ? { backend: 'mongo', input } : runner.start(input); },
    async resume(input) { return backend === 'mongo' ? { backend: 'mongo', input } : runner.resume(input); },
    async cancel(input) { return backend === 'mongo' ? { backend: 'mongo', input } : runner.cancel(input); },
  });
}
