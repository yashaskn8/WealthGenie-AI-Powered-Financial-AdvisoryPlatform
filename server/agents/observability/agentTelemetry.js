import { AsyncLocalStorage } from 'node:async_hooks';
import { trace } from '../../config/tracing.js';
import {
  SAFE_TELEMETRY_ATTRIBUTE_NAMES,
  sanitizeTelemetryAttributes,
  sanitizeTelemetryException,
  sanitizeTelemetryValue,
} from '../../utils/telemetrySanitizer.js';

export function sanitizeAgentAttributes(attributes = {}) {
  return sanitizeTelemetryAttributes(attributes);
}

const telemetrySuppression = new AsyncLocalStorage();
const NOOP_AGENT_SPAN = Object.freeze({
  setAttribute() { return this; },
  recordException() {},
  setStatus() {},
  end() {},
});

export function withAgentTelemetrySuppressed(callback) {
  if (typeof callback !== 'function') throw new TypeError('A telemetry suppression callback is required.');
  return telemetrySuppression.run(true, callback);
}

export function startAgentSpan(name, attributes = {}, callback) {
  if (telemetrySuppression.getStore()) return callback(NOOP_AGENT_SPAN);
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
  const safeException = sanitizeTelemetryException(error);
  const { errorType, ...exception } = safeException;
  span.recordException(exception);
  span.setAttribute('error.type', sanitizeTelemetryValue(errorType) || 'Error');
  span.setStatus({ code: 2 });
}

export const AGENT_TELEMETRY_ATTRIBUTE_NAMES = SAFE_TELEMETRY_ATTRIBUTE_NAMES;
