import crypto from 'node:crypto';
import { SAFE_PLAN_REVIEW_TOOLS } from '../planReview/planReviewSchemas.js';

const ALLOWED_EVENT_TYPES = new Set([
  'NODE_ENTERED', 'TOOL_SUCCEEDED', 'TOOL_FAILED', 'EVIDENCE_VALIDATED',
  'FALLBACK_USED', 'POLICY_REJECTED', 'RUN_COMPLETED',
]);
const ALLOWED_AGENT_TYPES = new Set(['PLAN_REVIEW']);
const ALLOWED_NODES = new Set([
  'load_context', 'check_recommendation_freshness', 'determine_required_checks',
  'execute_safe_tools', 'validate_evidence', 'research_mesh', 'synthesize_review',
  'validate_agent_output', 'policy_guard', 'persist_agent_run',
]);
const ALLOWED_FAILURE_CODES = new Set([
  'AGENT_BUDGET_EXCEEDED', 'AGENT_BUDGET_PERSISTENCE_UNAVAILABLE',
  'AGENT_GRAPH_CHECKPOINT_BUDGET_EXCEEDED', 'CHECKPOINT_FAILURE',
  'CHECKPOINT_SCOPE_MISMATCH', 'FORBIDDEN_TOOL_REQUEST', 'INVALID_PLANNER_OUTPUT',
  'PLAN_REVIEW_SOURCE_SUPERSEDED', 'PROFILE_NOT_FOUND', 'TOOL_CAPABILITY_POLICY_INVALID',
  'TOOL_EVIDENCE_PERSISTENCE_UNAVAILABLE', 'TOOL_FAILED', 'TOOL_TIMEOUT',
  'TRANSACTION_REQUIRED', 'UNKNOWN_TOOL',
]);
const MAX_TRAJECTORY_EVENTS = 100;
const MAX_TRAJECTORIES_PER_BATCH = 100;
const MAX_CLUSTERED_EVENTS_PER_BATCH = 1_000;

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function sanitizeTrajectory(trajectory = []) {
  if (!Array.isArray(trajectory)) return [];
  const sanitized = [];
  for (const event of trajectory.slice(-MAX_TRAJECTORY_EVENTS)) {
    if (!event || typeof event !== 'object' || Array.isArray(event)
        || !ALLOWED_EVENT_TYPES.has(event.type)) continue;
    sanitized.push({
      type: event.type,
      node: typeof event.node === 'string' && ALLOWED_NODES.has(event.node) ? event.node : null,
      tool: typeof event.tool === 'string' && SAFE_PLAN_REVIEW_TOOLS.includes(event.tool) ? event.tool : null,
      code: typeof event.code === 'string' && ALLOWED_FAILURE_CODES.has(event.code) ? event.code : null,
    });
  }
  return sanitized;
}

export function mineFailureClusters({ trajectories = [], agentType = 'PLAN_REVIEW' } = {}) {
  if (!ALLOWED_AGENT_TYPES.has(agentType)) throw new TypeError('Unsupported trajectory agent type.');
  if (!Array.isArray(trajectories)) throw new TypeError('Trajectory batches must be arrays.');
  const clusters = new Map();
  let remainingEvents = MAX_CLUSTERED_EVENTS_PER_BATCH;
  for (const trajectory of trajectories.slice(-MAX_TRAJECTORIES_PER_BATCH)) {
    const events = sanitizeTrajectory(trajectory).slice(0, remainingEvents);
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
    remainingEvents -= events.length;
    if (remainingEvents <= 0) break;
  }
  return [...clusters.values()];
}
