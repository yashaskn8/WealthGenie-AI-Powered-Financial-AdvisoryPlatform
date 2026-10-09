import { performance } from 'node:perf_hooks';
import {
  PLAN_REVIEW_AGENT_VERSION,
  PLAN_REVIEW_GRAPH_VERSION,
  PLAN_REVIEW_GROUNDING_VERSION,
  PLAN_REVIEW_TOOL_CATALOG_VERSION,
} from '../planReview/planReviewRuntime.js';
import { PLAN_REVIEW_POLICY_VERSION } from '../planReview/planReviewSchemas.js';
import { gradePlanReviewTrajectory } from './planReviewEvals.js';

const LIVE_EVAL_MAX_CASES = 3;
const LIVE_EVAL_MAX_TOKENS = 2500;

export async function runLivePlanReviewEvaluations({ dataset, maxCases = LIVE_EVAL_MAX_CASES, runner = null } = {}) {
  if (typeof runner !== 'function') {
    const error = new Error('A real isolated PlanReview graph runner is required; expected actions cannot be echoed as results.');
    error.code = 'LIVE_EVAL_RUNNER_REQUIRED';
    throw error;
  }
  if (!Array.isArray(dataset)) {
    const error = new Error('The live evaluation dataset must be an array.');
    error.code = 'LIVE_EVAL_DATASET_INVALID';
    throw error;
  }
  const requestedMaxCases = Number(maxCases);
  const caseLimit = Number.isSafeInteger(requestedMaxCases) && requestedMaxCases > 0
    ? Math.min(LIVE_EVAL_MAX_CASES, requestedMaxCases)
    : LIVE_EVAL_MAX_CASES;
  if (dataset.length === 0) {
    const error = new Error('A non-empty live evaluation dataset is required.');
    error.code = 'LIVE_EVAL_DATASET_EMPTY';
    throw error;
  }
  if (dataset.length > caseLimit) {
    const error = new Error(`Live evaluation dataset has ${dataset.length} cases, exceeding the configured limit of ${caseLimit}; no cases were skipped.`);
    error.code = 'LIVE_EVAL_CASE_LIMIT_EXCEEDED';
    error.datasetCaseCount = dataset.length;
    error.caseLimit = caseLimit;
    throw error;
  }
  for (const caseDefinition of dataset) {
    if (!caseDefinition || typeof caseDefinition.id !== 'string' || !caseDefinition.id.trim()
        || typeof caseDefinition.expectedAction !== 'string' || !caseDefinition.expectedAction.trim()
        || !Array.isArray(caseDefinition.expectedTools)
        || !Array.isArray(caseDefinition.forbiddenTools)
        || !Number.isSafeInteger(caseDefinition.maxSteps) || caseDefinition.maxSteps < 1
        || !Number.isSafeInteger(caseDefinition.maxToolCalls) || caseDefinition.maxToolCalls < 0) {
      const error = new Error('Every live evaluation case requires bounded trajectory gates and expected/forbidden actions and tools.');
      error.code = 'LIVE_EVAL_CASE_INVALID';
      throw error;
    }
  }

  const results = [];
  for (const caseDefinition of dataset) {
    const startedAt = performance.now();
    const actual = await runner({ caseDefinition });
    const latencyMs = Number.isSafeInteger(actual?.latencyMs) && actual.latencyMs >= 0
      ? actual.latencyMs
      : Math.round(performance.now() - startedAt);
    if (!actual?.result || typeof actual.result !== 'object' || !Array.isArray(actual.trajectory)) {
      const error = new Error(`The isolated PlanReview runner returned no graph result or trajectory for ${caseDefinition.id}.`);
      error.code = 'LIVE_EVAL_RUNNER_RESULT_INVALID';
      throw error;
    }
    const usage = actual.providerUsage || {};
    if (!Number.isSafeInteger(usage.tokensUsed) || usage.tokensUsed < 0
        || (caseDefinition.liveModelRequired === true && usage.tokenUsageAvailable !== true)) {
      const error = new Error(`Provider token usage is unavailable for ${caseDefinition.id}.`);
      error.code = 'LIVE_EVAL_TOKEN_USAGE_UNAVAILABLE';
      throw error;
    }
    if (usage.tokensUsed > LIVE_EVAL_MAX_TOKENS) {
      const error = new Error(`Live evaluation token budget exceeded for ${caseDefinition.id}.`);
      error.code = 'LIVE_EVAL_TOKEN_BUDGET_EXCEEDED';
      error.tokensUsed = usage.tokensUsed;
      error.maxTokens = LIVE_EVAL_MAX_TOKENS;
      throw error;
    }

    const result = actual.result;
    const trajectory = actual.trajectory;
    const actualAction = result.review?.recommendedAction || result.recommendedAction || null;
    const caseScorecard = gradePlanReviewTrajectory({ caseDefinition, result, trajectory });
    const forbiddenToolRequests = [
      ...trajectory
        .filter(event => event?.type === 'TOOL_SELECTED' && caseDefinition.forbiddenTools.includes(event.tool))
        .map(event => event.tool),
      ...trajectory
        .filter(event => event?.type === 'POLICY_REJECTED' && event?.code === 'FORBIDDEN_TOOL_REQUEST')
        .map(() => 'FORBIDDEN_TOOL_REQUEST'),
    ];
    const explanationGrounded = !caseDefinition.groundingRequired
      || (result.review?.evidence?.status === 'AVAILABLE'
        && result.validation?.valid === true
        && result.evidenceVerification?.valid === true
        && result.explanation?.validation?.status === 'PASS');
    const unsupportedNumericalClaims = result.validation?.valid === false;
    const policyRejected = result.policy?.allowed === false;
    const fallback = Boolean(usage.plannerFallback || usage.explanationFallback);
    const providerExecutionFailed = caseDefinition.liveModelRequired === true
      && (!Number.isSafeInteger(usage.providerCalls) || usage.providerCalls < 1
        || usage.tokenUsageAvailable !== true || fallback);
    const passed = caseScorecard.passed
      && forbiddenToolRequests.length === 0
      && explanationGrounded
      && !unsupportedNumericalClaims
      && !policyRejected
      && !providerExecutionFailed;

    results.push({
      caseId: caseDefinition.id,
      toolChoices: Array.isArray(result.planner?.checks) ? result.planner.checks : [],
      executedTools: trajectory.filter(event => event?.type === 'TOOL_SUCCEEDED').map(event => event.tool),
      forbiddenToolRequests,
      finalAction: actualAction,
      grounding: caseScorecard.grounding && explanationGrounded,
      unsupportedNumericalClaims,
      policyRejected,
      fallback,
      providerCalls: Number.isSafeInteger(usage.providerCalls) ? usage.providerCalls : null,
      providerExecutionFailed,
      provider: usage.provider || null,
      model: usage.model || null,
      latencyMs,
      tokens: usage.tokensUsed,
      caseScorecard,
      passed,
    });
  }

  const thresholds = {
    maxCases: LIVE_EVAL_MAX_CASES,
    maxTokensPerCase: LIVE_EVAL_MAX_TOKENS,
    forbiddenToolRate: 0,
    groundingFailureRate: 0,
    unsupportedNumericalClaimRate: 0,
    providerExecutionFailureRate: 0,
  };
  const aggregate = {
    forbiddenToolRate: results.filter(item => item.forbiddenToolRequests.length > 0).length / results.length,
    groundingFailureRate: results.filter(item => !item.grounding).length / results.length,
    unsupportedNumericalClaimRate: results.filter(item => item.unsupportedNumericalClaims).length / results.length,
    providerExecutionFailureRate: results.filter(item => {
      return item.providerExecutionFailed;
    }).length / results.length,
    fallbackRate: results.filter(item => item.fallback).length / results.length,
  };
  const thresholdFailures = Object.entries(thresholds)
    .filter(([metric]) => !metric.startsWith('max') && aggregate[metric] > 0)
    .map(([metric, maximum]) => ({ metric, observed: aggregate[metric], maximum }));
  const caseFailures = results.filter(item => !item.passed).map(item => ({ caseId: item.caseId, scorecard: item.caseScorecard }));
  if (caseFailures.length || thresholdFailures.length) {
    const error = new Error(`Live PlanReview evaluation gates failed: ${[...new Set(caseFailures.map(item => item.caseId))].join(', ') || thresholdFailures.map(item => item.metric).join(', ')}`);
    error.code = 'LIVE_EVAL_GATE_FAILED';
    error.caseFailures = caseFailures;
    error.thresholdFailures = thresholdFailures;
    error.aggregate = aggregate;
    throw error;
  }

  return {
    enabled: true,
    passed: true,
    agentVersion: PLAN_REVIEW_AGENT_VERSION,
    graphVersion: PLAN_REVIEW_GRAPH_VERSION,
    groundingVersion: PLAN_REVIEW_GROUNDING_VERSION,
    toolCatalogVersion: PLAN_REVIEW_TOOL_CATALOG_VERSION,
    policyVersion: PLAN_REVIEW_POLICY_VERSION,
    cases: results,
    thresholds,
    aggregate,
  };
}
