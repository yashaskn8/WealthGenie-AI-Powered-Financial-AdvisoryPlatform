import crypto from 'node:crypto';
import { RELIABILITY_LAB_VERSION } from './reliabilityConstants.js';

const PRIVATE_KEYS = /(?:email|phone|income|salary|savings|address|password|token|jwt|secret|profile|userId|account|bank|pan|goal|allocation)/i;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function opaque(value, fallback = 'opaque') {
  const text = String(value ?? fallback);
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function safeData(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return Object.fromEntries(Object.entries(data).filter(([key]) => !PRIVATE_KEYS.test(key)).slice(0, 20).map(([key, value]) => [
    key,
    typeof value === 'string' ? value.slice(0, 160) : (typeof value === 'number' || typeof value === 'boolean' || value === null ? value : opaque(JSON.stringify(value))),
  ]));
}

export function createTrajectoryIR({ scenarioId = 'unspecified', events = [], source = 'synthetic' } = {}) {
  const normalized = events.map((event, index) => ({
    sequence: Number(event.sequence || index + 1),
    at: String(event.at || new Date(0).toISOString()),
    actor: String(event.actor || 'SYSTEM'),
    kind: String(event.kind || event.eventType || event.type || 'UNKNOWN'),
    node: event.node ? String(event.node).slice(0, 80) : null,
    taskId: event.taskId ? opaque(event.taskId) : null,
    runId: event.runId ? opaque(event.runId) : null,
    state: event.state ? String(event.state) : null,
    code: event.code ? String(event.code).slice(0, 80) : null,
    data: safeData(event.data || event),
  }));
  const body = { version: RELIABILITY_LAB_VERSION, scenarioId, source, events: normalized };
  return Object.freeze({ ...body, contentHash: crypto.createHash('sha256').update(canonical(body)).digest('hex') });
}

export function normalizeAgentRunEvents(events = [], options = {}) {
  return createTrajectoryIR({ ...options, source: 'AgentRunEvent', events: events.map(event => ({
    ...event,
    kind: event.eventType,
    data: event.data,
  })) });
}

export function normalizeAgentRunSnapshot(run = {}, options = {}) {
  const events = [...(run.trajectory || [])].map((event, index) => ({
    ...event,
    sequence: index + 1,
    runId: run.runId,
    at: event.at,
  }));
  return createTrajectoryIR({ ...options, source: 'AgentRun', events });
}

export function normalizeA2ATask(task = {}, options = {}) {
  return createTrajectoryIR({ ...options, source: 'A2A', events: [
    { kind: 'A2A_TASK', state: task.state || task.status, taskId: task.id || task.taskId, data: { protocolVersion: task.protocolVersion, artifactCount: task.artifacts?.length || 0 } },
  ] });
}

export function normalizeAuthorizationEvents(events = [], options = {}) {
  return createTrajectoryIR({ ...options, source: 'authorization', events: events.map(event => ({
    ...event,
    kind: event.eventType || event.type,
    actor: 'AUTHORIZATION',
  })) });
}

export function normalizePlanHealthEvents(events = [], options = {}) {
  return createTrajectoryIR({ ...options, source: 'plan-health', events: events.map(event => ({
    ...event,
    kind: event.reason || event.status || 'PLAN_HEALTH_EVENT',
    actor: 'PLAN_HEALTH',
  })) });
}

export function mergeTrajectoryIR(...trajectories) {
  const events = trajectories.flatMap(item => item?.events || []).sort((a, b) => a.sequence - b.sequence);
  return createTrajectoryIR({ scenarioId: trajectories.find(item => item?.scenarioId)?.scenarioId || 'merged', source: 'merged', events });
}

export { canonical };
