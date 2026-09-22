import AgentRun from '../../models/AgentRun.js';
import AgentRunEvent from '../../models/AgentRunEvent.js';

const AUTHORIZATION_EVENT_TYPES = new Set([
  'ACTION_PROPOSED',
  'MANDATE_CREATED',
  'USER_VERIFICATION_REQUIRED',
  'MANDATE_AUTHORIZED',
  'MANDATE_REJECTED',
  'MANDATE_EXPIRED',
  'MANDATE_REVOKED',
  'ACTION_EXECUTION_STARTED',
  'ACTION_EXECUTION_COMPLETED',
  'ACTION_EXECUTION_FAILED',
]);

function safeData(data = {}) {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => (
    value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  )));
}

/**
 * Durable authorization events are a reconnectable progress surface only.
 * They never carry credentials, challenges, assertions, private keys, or raw
 * financial data, and event persistence cannot change the financial outcome.
 */
export async function appendAuthorizationEvent({ runId, userId, eventType, data = {}, dependencies = {} }) {
  if (!runId || !userId || !AUTHORIZATION_EVENT_TYPES.has(eventType)) return null;
  const models = { runModel: AgentRun, eventModel: AgentRunEvent, ...dependencies };
  try {
    const run = await models.runModel.findOne({ runId, userId }).lean();
    if (!run) return null;
    const latest = await models.eventModel.findOne({ runId, userId }).sort({ sequence: -1 }).lean();
    const sequence = Number(latest?.sequence || 0) + 1;
    return await models.eventModel.create({
      runId,
      userId,
      executionGeneration: Number(run.executionGeneration || 0),
      sequence,
      eventType,
      node: 'authorization',
      data: { type: eventType, ...safeData(data), at: new Date().toISOString() },
    });
  } catch (error) {
    // Authorization events are audit/progress metadata; a transient event
    // write must not turn a valid authorization into a financial failure.
    if (error?.code !== 11000) return null;
    return null;
  }
}

