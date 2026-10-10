import { performance } from 'node:perf_hooks';
import {
  PLAN_REVIEW_AGENT_VERSION,
  PLAN_REVIEW_GRAPH_VERSION,
  PLAN_REVIEW_GROUNDING_VERSION,
  PLAN_REVIEW_TOOL_CATALOG_VERSION,
} from '../planReview/planReviewRuntime.js';
import { PLAN_REVIEW_POLICY_VERSION } from '../planReview/planReviewSchemas.js';
import { gradePlanReviewTrajectory } from './planReviewEvals.js';
import { sanitizeGroundingReasonCodes } from '../../services/groundingValidator.js';

const LIVE_EVAL_MAX_CASES = 3;
const LIVE_EVAL_MAX_TOKENS = 2500;

export function selectLivePlanReviewCases(dataset, requestedCaseId = null) {
  if (!Array.isArray(dataset)) throw new TypeError('A PlanReview evaluation dataset is required.');
  if (requestedCaseId === null || requestedCaseId === undefined || requestedCaseId === '') return dataset;
  if (typeof requestedCaseId !== 'string') throw new TypeError('A PlanReview case identifier must be a string.');
  const matches = dataset.filter(item => item?.id === requestedCaseId);
  if (matches.length !== 1) {
    const error = new Error('The requested live evaluation case is not uniquely present in the dataset.');
    error.code = 'LIVE_EVAL_CASE_NOT_FOUND';
    throw error;
  }
  return matches;
}

function sanitizedClassification(value) {
  return typeof value === 'string' && /^[A-Z0-9_:-]{2,80}$/.test(value)
    ? value
    : null;
}

function sanitizedProviderAttempts(attempts) {
  if (!Array.isArray(attempts)) return [];
  return attempts.slice(0, 2).map(attempt => {
    const item = attempt && typeof attempt === 'object' ? attempt : {};
    const diagnostics = item.diagnostics && typeof item.diagnostics === 'object' ? item.diagnostics : item;
    const safeString = (value, maxLength = 160) => typeof value === 'string' ? value.slice(0, maxLength) : null;
    const endpointHostname = typeof diagnostics.endpointHostname === 'string'
      && /^[A-Za-z0-9.-]{1,120}$/.test(diagnostics.endpointHostname)
      ? diagnostics.endpointHostname
      : null;
    const safeInteger = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
    const safeBoolean = value => typeof value === 'boolean' ? value : null;
    const role = item.role === 'PLANNER' || item.role === 'EXPLAINER' ? item.role : null;
    const completionTokens = safeInteger(diagnostics.providerCompletionTokens ?? diagnostics.completionTokens);
    const reasoningTokens = safeInteger(diagnostics.providerReasoningTokens ?? diagnostics.reasoningTokens);
    return {
      role,
      outputContract: safeString(item.outputContract, 80),
      provider: safeString(diagnostics.provider, 40),
      model: safeString(diagnostics.configuredModel || diagnostics.model, 120),
      returnedModel: safeString(diagnostics.returnedModel, 120),
      endpointHostname,
      responseFormatMode: safeString(diagnostics.responseFormatMode, 40),
      strictSchema: safeBoolean(diagnostics.strictSchema),
      schemaName: safeString(diagnostics.schemaName, 80),
      schemaStructuralValidation: safeBoolean(diagnostics.schemaStructuralValidation),
      reasoningEffort: safeString(diagnostics.reasoningEffort, 20),
      reasoningFormat: safeString(diagnostics.reasoningFormat, 20),
      reasoningIncluded: safeBoolean(diagnostics.reasoningIncluded),
      httpStatus: safeInteger(diagnostics.httpStatus),
      latencyMs: safeInteger(diagnostics.latencyMs),
      completionReason: safeString(diagnostics.completionReason, 80),
      outputBytes: safeInteger(diagnostics.outputBytes),
      providerRequestId: typeof diagnostics.providerRequestId === 'string'
        && /^[A-Za-z0-9._:-]{1,128}$/.test(diagnostics.providerRequestId)
        ? diagnostics.providerRequestId
        : null,
      promptTokens: safeInteger(diagnostics.providerPromptTokens ?? diagnostics.promptTokens),
      completionTokens,
      reasoningTokens: reasoningTokens !== null
        && (completionTokens === null || reasoningTokens <= completionTokens)
        ? reasoningTokens
        : null,
      reportedTokens: safeInteger(diagnostics.providerReportedTokens ?? diagnostics.reportedTokens),
      effectiveOutputTokenCeiling: safeInteger(diagnostics.effectiveOutputTokenCeiling),
      jsonSyntaxValid: safeBoolean(diagnostics.jsonSyntaxValid),
      jsonSchemaValid: safeBoolean(diagnostics.jsonSchemaValid),
      financialGroundingValid: safeBoolean(diagnostics.financialGroundingValid),
      groundingReasonCodes: sanitizeGroundingReasonCodes(diagnostics.groundingReasonCodes),
      semanticCompletenessValid: safeBoolean(diagnostics.semanticCompletenessValid),
      semanticReasonCodes: sanitizeGroundingReasonCodes(diagnostics.semanticReasonCodes),
      explanationPolicyValid: safeBoolean(diagnostics.explanationPolicyValid),
      policyReasonCodes: sanitizeGroundingReasonCodes(diagnostics.policyReasonCodes),
      errorClassification: sanitizedClassification(item.errorClassification || diagnostics.errorClassification),
      providerErrorCode: safeString(diagnostics.providerErrorCode, 80),
      providerErrorField: typeof diagnostics.providerErrorField === 'string'
        && /^[A-Za-z0-9_.\[\]-]{1,120}$/.test(diagnostics.providerErrorField)
        ? diagnostics.providerErrorField
        : null,
    };
  });
}

function failedScorecard(caseId) {
  return {
    caseId,
    toolSelection: false,
    trajectory: false,
    grounding: false,
    policy: false,
    action: false,
    robustness: false,
    forbiddenTools: [],
    unsupportedTools: [],
    missingExpectedTools: [],
    missingReasonCodes: [],
    passed: false,
  };
}

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
    let actual = null;
    let runnerError = null;
    try {
      actual = await runner({ caseDefinition });
    } catch (error) {
      runnerError = error;
    }
    const failedEvidence = runnerError?.livePlanReviewEvidence || {};
    const latencyMs = Number.isSafeInteger(actual?.latencyMs) && actual.latencyMs >= 0
      ? actual.latencyMs
      : Number.isSafeInteger(failedEvidence.latencyMs) && failedEvidence.latencyMs >= 0
        ? failedEvidence.latencyMs
      : Math.round(performance.now() - startedAt);
    const usage = actual?.providerUsage || failedEvidence.providerUsage || {};
    const hasGraphResult = !runnerError && actual?.result && typeof actual.result === 'object'
      && Array.isArray(actual.trajectory);
    const result = hasGraphResult ? actual.result : null;
    const trajectory = hasGraphResult ? actual.trajectory : [];
    const tokensKnown = Number.isSafeInteger(usage.tokensUsed) && usage.tokensUsed >= 0
      && (usage.tokenUsageAvailable === true || usage.tokensUsed > 0);
    const tokenUsageComplete = tokensKnown
      && (caseDefinition.liveModelRequired !== true || usage.tokenUsageAvailable === true);
    const withinTokenBudget = tokenUsageComplete && usage.tokensUsed <= LIVE_EVAL_MAX_TOKENS;
    const providerCalls = Number.isSafeInteger(usage.providerCalls) && usage.providerCalls >= 0
      ? usage.providerCalls
      : null;
    const providerCallAttempts = Number.isSafeInteger(usage.providerCallAttempts) && usage.providerCallAttempts >= 0
      ? usage.providerCallAttempts
      : providerCalls;
    const providerCallBudgetCompliant = providerCalls !== null && providerCalls <= 2
      && providerCallAttempts !== null && providerCallAttempts <= 2
      && (caseDefinition.liveModelRequired !== true || providerCalls >= 1)
      && (caseDefinition.liveModelRequired === true || providerCalls === 0);
    const caseScorecard = hasGraphResult
      ? gradePlanReviewTrajectory({ caseDefinition, result, trajectory })
      : failedScorecard(caseDefinition.id);
    const actualAction = result?.review?.recommendedAction || result?.recommendedAction || null;
    const forbiddenToolRequests = [
      ...trajectory
        .filter(event => event?.type === 'TOOL_SELECTED' && caseDefinition.forbiddenTools.includes(event.tool))
        .map(event => event.tool),
      ...trajectory
        .filter(event => event?.type === 'POLICY_REJECTED' && event?.code === 'FORBIDDEN_TOOL_REQUEST')
        .map(() => 'FORBIDDEN_TOOL_REQUEST'),
    ];
    const explanationGrounded = !caseDefinition.groundingRequired
      || (result?.review?.evidence?.status === 'AVAILABLE'
        && result?.validation?.valid === true
        && result?.evidenceVerification?.valid === true
        && result?.explanation?.validation?.status === 'PASS');
    const unsupportedNumericalClaims = result?.validation?.valid === false;
    const policyRejected = result?.policy?.allowed === false;
    const fallback = Boolean(usage.plannerFallback || usage.explanationFallback);
    const providerExecutionFailed = caseDefinition.liveModelRequired === true
      && (!hasGraphResult || !providerCallBudgetCompliant || usage.tokenUsageAvailable !== true
        || usage.plannerFallback !== false || usage.explanationFallback !== false);
    const unexpectedProviderExecution = caseDefinition.liveModelRequired !== true && providerCalls !== 0;
    const passed = hasGraphResult && tokenUsageComplete && withinTokenBudget && providerCallBudgetCompliant && caseScorecard.passed
      && forbiddenToolRequests.length === 0
      && explanationGrounded
      && !unsupportedNumericalClaims
      && !policyRejected
      && !providerExecutionFailed
      && !unexpectedProviderExecution;

    results.push({
      caseId: caseDefinition.id,
      toolChoices: Array.isArray(result?.planner?.checks) ? result.planner.checks : [],
      executedTools: trajectory.filter(event => event?.type === 'TOOL_SUCCEEDED').map(event => event.tool),
      forbiddenToolRequests,
      finalAction: actualAction,
      grounding: caseScorecard.grounding && explanationGrounded,
      unsupportedNumericalClaims,
      policyRejected,
      fallback,
      providerCalls,
      providerCallAttempts,
      providerCallBudgetCompliant,
      unexpectedProviderExecution,
      providerExecutionFailed,
      provider: usage.provider || null,
      model: usage.model || null,
      modelsUsed: Array.isArray(usage.modelsUsed)
        ? [...new Set(usage.modelsUsed.filter(model => typeof model === 'string'
          && /^[A-Za-z0-9._/-]{1,120}$/.test(model)))].slice(0, 2)
        : [],
      latencyMs,
      tokens: tokensKnown ? usage.tokensUsed : null,
      tokenUsageAvailable: usage.tokenUsageAvailable === true,
      tokenUsageComplete,
      withinTokenBudget,
      plannerSuccess: caseDefinition.liveModelRequired === true
        ? hasGraphResult && usage.plannerFallback === false
        : null,
      explanationSuccess: caseDefinition.liveModelRequired === true
        ? hasGraphResult && usage.explanationFallback === false
          && result?.explanation?.validation?.status === 'PASS'
        : null,
      authorizationEvidence: actual?.authorizationEvidence || null,
      missingReasonCodes: Array.isArray(caseScorecard.missingReasonCodes)
        ? caseScorecard.missingReasonCodes
        : [],
      providerAttempts: sanitizedProviderAttempts(usage.attempts),
      errorClassification: sanitizedClassification(runnerError?.code)
        || (!tokenUsageComplete ? 'LIVE_EVAL_TOKEN_USAGE_UNAVAILABLE'
          : (!withinTokenBudget ? 'LIVE_EVAL_TOKEN_BUDGET_EXCEEDED' : null)),
      passed,
      caseScorecard,
      failed: !passed,
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
    error.cases = results;
    error.caseCounts = {
      executed: results.length,
      passed: results.filter(item => item.passed).length,
      failed: caseFailures.length,
      notEvaluated: dataset.length - results.length,
    };
    error.totalProviderCalls = results.reduce((sum, item) => sum + (item.providerCalls || 0), 0);
    error.totalReportedTokens = results.reduce((sum, item) => sum + (item.tokens || 0), 0);
    error.reportedTokensComplete = results.every(item => item.tokenUsageComplete);
    throw error;
  }

  return {
    enabled: true,
    passed: true,
    caseCounts: {
      executed: results.length,
      passed: results.filter(item => item.passed).length,
      failed: 0,
      notEvaluated: dataset.length - results.length,
    },
    totalProviderCalls: results.reduce((sum, item) => sum + (item.providerCalls || 0), 0),
    totalReportedTokens: results.reduce((sum, item) => sum + (item.tokens || 0), 0),
    reportedTokensComplete: results.every(item => item.tokenUsageComplete),
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
