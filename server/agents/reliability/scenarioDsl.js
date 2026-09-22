import Joi from 'joi';
import { HARD_LIMITS, SCENARIO_ACTIONS, SCENARIO_FAMILIES } from './reliabilityConstants.js';

const actionSchema = Joi.object({
  atHours: Joi.number().min(0).max(HARD_LIMITS.maxScenarioHours).required(),
  action: Joi.string().valid(...SCENARIO_ACTIONS).required(),
  value: Joi.string().max(160).allow(null).default(null),
  count: Joi.number().integer().min(1).max(10).default(1),
}).unknown(false);

const expectedSchema = Joi.object({
  taskState: Joi.string().valid('SUBMITTED', 'WORKING', 'WAITING_FOR_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELED').allow(null),
  authorityDelta: Joi.number().valid(0).required(),
  noDuplicateCommit: Joi.boolean().default(true),
  safetyContained: Joi.boolean().default(true),
  maxReactionHours: Joi.number().min(0).max(HARD_LIMITS.maxScenarioHours).allow(null),
}).unknown(false);

const scenarioSchema = Joi.object({
  id: Joi.string().pattern(/^[a-z0-9][a-z0-9-]{2,80}$/).required(),
  family: Joi.string().valid(...SCENARIO_FAMILIES).required(),
  description: Joi.string().max(240).required(),
  durationHours: Joi.number().min(0).max(HARD_LIMITS.maxScenarioHours).required(),
  actions: Joi.array().items(actionSchema).min(1).max(HARD_LIMITS.maxActions).required(),
  expected: expectedSchema.required(),
  tags: Joi.array().items(Joi.string().max(40)).max(12).default([]),
  executionMode: Joi.string().valid('SYSTEM_ONLY', 'CANDIDATE_BOUND', 'HYBRID').default('SYSTEM_ONLY'),
  candidateExpectations: Joi.object({
    plannerRole: Joi.string().valid('PLANNER', 'EXPLAINER').allow(null).default(null),
    contextCompressionPolicy: Joi.string().valid('BOUNDED_PROFILE_CONTEXT', 'MINIMAL_PROFILE_CONTEXT').allow(null).default(null),
    requiredTrajectoryKinds: Joi.array().items(Joi.string().max(80)).max(8).default([]),
  }).default({}),
}).unknown(false);

function rejectExecutable(value, path = []) {
  if (!value || typeof value !== 'object') {
    if (typeof value === 'function') throw new Error(`Executable scenario value rejected at ${path.join('.') || 'root'}.`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (/^(code|script|eval|function|command|shell|javascript|expression)$/i.test(key) || typeof child === 'function') {
      const error = new Error(`Executable scenario field rejected at ${[...path, key].join('.')}.`);
      error.code = 'EXECUTABLE_SCENARIO_REJECTED';
      throw error;
    }
    rejectExecutable(child, [...path, key]);
  }
}

export function validateScenario(input) {
  rejectExecutable(input);
  const result = scenarioSchema.validate(input, { abortEarly: false, convert: true });
  if (result.error) {
    const error = new Error(result.error.details.map(item => item.message).join('; '));
    error.code = 'INVALID_RELIABILITY_SCENARIO';
    throw error;
  }
  return Object.freeze(result.value);
}

export function assertScenarioSet(scenarios = []) {
  const validated = scenarios.map(validateScenario);
  const ids = new Set();
  validated.forEach(scenario => {
    if (ids.has(scenario.id)) throw new Error(`Duplicate reliability scenario: ${scenario.id}`);
    ids.add(scenario.id);
  });
  return Object.freeze(validated);
}

export { scenarioSchema };
