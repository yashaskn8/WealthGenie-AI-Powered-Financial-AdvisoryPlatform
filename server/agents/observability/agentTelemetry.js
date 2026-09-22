import { trace } from '../../config/tracing.js';

const MAX_STRING_LENGTH = 120;
const SAFE_ATTRIBUTE_NAMES = new Set([
  'agent.type',
  'agent.name',
  'agent.version',
  'agent.graph_version',
  'agent.scaffold_version',
  'agent.run_id',
  'agent.status',
  'agent.step_count',
  'agent.tool_call_count',
  'agent.model_call_count',
  'agent.tool_name',
  'agent.tool_outcome',
  'agent.policy_result',
  'agent.evidence_status',
  'agent.fallback_used',
  'agent.candidate_id',
  'agent.evaluation_partition',
  'agent.evaluation_version',
  'gen_ai.system',
  'gen_ai.request.model',
  'gen_ai.response.model',
  'gen_ai.operation.name',
  'gen_ai.response.finish_reasons',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
  'gen_ai.usage.total_tokens',
  'error.type',
]);

const SENSITIVE_NAME = /(user|profile|income|salary|tax|email|phone|address|prompt|content|input|output|secret|token|password|cookie|authorization|raw|payload|value)/i;

function safeScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH);
  return undefined;
}

export function sanitizeAgentAttributes(attributes = {}) {
  const safe = {};
  for (const [name, value] of Object.entries(attributes || {})) {
    if (!SAFE_ATTRIBUTE_NAMES.has(name) || SENSITIVE_NAME.test(name)) continue;
    const scalar = safeScalar(value);
    if (scalar !== undefined) safe[name] = scalar;
  }
  return safe;
}

export function startAgentSpan(name, attributes = {}, callback) {
  const tracer = trace.getTracer('wealthgenie.agent');
  return tracer.startActiveSpan(name, { attributes: sanitizeAgentAttributes(attributes) }, callback);
}

export function withAgentSpan(name, attributes = {}, callback) {
  return startAgentSpan(name, attributes, async span => {
    try {
      return await callback(span);
    } catch (error) {
      recordAgentError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

export function recordAgentError(span, error) {
  if (!span || !error) return;
  span.recordException(error);
  span.setAttribute('error.type', String(error.code || error.name || 'ERROR').slice(0, MAX_STRING_LENGTH));
  span.setStatus({ code: 2 });
}

export const AGENT_TELEMETRY_ATTRIBUTE_NAMES = Object.freeze([...SAFE_ATTRIBUTE_NAMES]);
