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

const SAFE_SPAN_NAMES = new Set([
  'agent.operation',
  'internal.operation',
  'http.request',
]);

export function sanitizeTelemetrySpanName(name) {
  if (typeof name !== 'string') return 'internal.operation';
  if (SAFE_SPAN_NAMES.has(name)) return name;
  const method = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/.exec(name)?.[1];
  return method ? `http.request.${method}` : 'internal.operation';
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

export function sanitizeTelemetrySpanEvents(events = []) {
  if (!Array.isArray(events)) return [];
  return events.slice(0, 32).flatMap(event => {
    if (event?.name !== 'exception') return [];
    const attributes = event.attributes || {};
    const safeAttributes = {};
    for (const key of ['exception.type', 'exception.message']) {
      const value = sanitizeTelemetryValue(attributes[key]);
      if (value !== undefined) safeAttributes[key] = value;
    }
    const time = event.time ?? event.timestamp;
    let timestamp = null;
    try {
      if (Array.isArray(time) && time.length === 2) timestamp = new Date(Number(time[0]) * 1000 + Number(time[1]) / 1e6).toISOString();
      else if (Number.isFinite(Number(time))) timestamp = new Date(Number(time) / 1e6).toISOString();
    } catch {
      timestamp = null;
    }
    return [{ name: 'exception', timestamp, attributes: safeAttributes }];
  });
}
