import { redactLogValue } from './logger.js';

const MAX_TELEMETRY_STRING_LENGTH = 120;

export const SAFE_TELEMETRY_ATTRIBUTE_NAMES = Object.freeze([
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

const SAFE_TELEMETRY_ATTRIBUTE_SET = new Set(SAFE_TELEMETRY_ATTRIBUTE_NAMES);
const SENSITIVE_ATTRIBUTE_NAME = /(user|profile|income|salary|tax|email|phone|address|prompt|content|input|output|secret|token|password|cookie|authorization|raw|payload|value)/i;

export function sanitizeTelemetryValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;

  try {
    const redacted = redactLogValue(value);
    return typeof redacted === 'string' ? redacted.slice(0, MAX_TELEMETRY_STRING_LENGTH) : undefined;
  } catch {
    return undefined;
  }
}

export function sanitizeTelemetryAttributes(attributes = {}) {
  const safe = {};
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(attributes || {});
  } catch {
    return safe;
  }

  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) continue;
    if (!SAFE_TELEMETRY_ATTRIBUTE_SET.has(name) || SENSITIVE_ATTRIBUTE_NAME.test(name)) continue;
    const scalar = sanitizeTelemetryValue(descriptor.value);
    if (scalar !== undefined) safe[name] = scalar;
  }
  return safe;
}

export function sanitizeTelemetryException(error) {
  let redacted;
  try {
    redacted = redactLogValue(error);
  } catch {
    redacted = undefined;
  }

  const message = typeof redacted === 'string'
    ? sanitizeTelemetryValue(redacted)
    : sanitizeTelemetryValue(redacted?.message);
  const name = sanitizeTelemetryValue(redacted?.name);
  const stack = sanitizeTelemetryValue(redacted?.stack);
  const errorType = sanitizeTelemetryValue(redacted?.code) || name || 'Error';

  return {
    name: name || 'Error',
    message: message || 'Unspecified error',
    errorType,
    ...(stack ? { stack } : {}),
  };
}
