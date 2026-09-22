import crypto from 'node:crypto';

const ALLOWED_EVENT_TYPES = new Set([
  'NODE_ENTERED', 'TOOL_SUCCEEDED', 'TOOL_FAILED', 'EVIDENCE_VALIDATED',
  'FALLBACK_USED', 'POLICY_REJECTED', 'RUN_COMPLETED',
]);

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function sanitizeTrajectory(trajectory = []) {
  return trajectory.filter(event => ALLOWED_EVENT_TYPES.has(event?.type)).slice(-100).map(event => ({
    type: event.type,
    node: typeof event.node === 'string' ? event.node.slice(0, 80) : null,
    tool: typeof event.tool === 'string' ? event.tool.slice(0, 80) : null,
    code: typeof event.code === 'string' ? event.code.slice(0, 120) : null,
  }));
}

export function mineFailureClusters({ trajectories = [], agentType = 'PLAN_REVIEW' } = {}) {
  const clusters = new Map();
  for (const trajectory of trajectories) {
    const events = sanitizeTrajectory(trajectory);
    for (const event of events.filter(item => item.type === 'TOOL_FAILED' || item.type === 'POLICY_REJECTED')) {
      const keyData = { agentType, type: event.type, node: event.node, code: event.code };
      const clusterKey = digest(keyData);
      const current = clusters.get(clusterKey) || {
        clusterKey,
        agentType,
        failureCode: event.code || event.type,
        node: event.node,
        eventTypes: [],
        occurrenceCount: 0,
        sanitizedExamples: [],
      };
      current.occurrenceCount += 1;
      current.eventTypes = [...new Set([...current.eventTypes, event.type])];
      if (current.sanitizedExamples.length < 3) current.sanitizedExamples.push(event);
      clusters.set(clusterKey, current);
    }
  }
  return [...clusters.values()];
}
