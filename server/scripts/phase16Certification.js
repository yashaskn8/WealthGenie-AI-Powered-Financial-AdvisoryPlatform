import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GROQ_PLAN_REVIEW_MODELS, ProviderManager } from '../services/providerAbstraction.js';
import { runLivePlanReviewEvaluations, selectLivePlanReviewCases } from '../agents/evals/livePlanReviewEvals.js';
import { runIsolatedPlanReviewCase } from '../agents/evals/isolatedPlanReviewRunner.js';

export const PHASE16_DATASET_SHA256 = '9e055d3827ee34c632d32f32ca41ce7f40726e51bc657728ce488b0812b942db';
const EXPECTED_CASES = Object.freeze([
  ['fresh-read-only-plan', 'NONE', true, true, 'STANDARD', []],
  ['missing-recommendation', 'RECOMPUTE_PLAN', false, true, 'STANDARD', ['RECOMMENDATION_MISSING']],
  ['cross-user-profile', 'REVIEW_PROFILE', false, false, 'PROTECTED_PROFILE_ACCESS_DENIAL', ['PROFILE_MISSING']],
]);

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function expectedRoles(caseDefinition) {
  if (caseDefinition.liveModelRequired !== true) return [];
  return caseDefinition.groundingRequired === true ? ['PLANNER', 'EXPLAINER'] : ['PLANNER'];
}

function attemptMatchesRole(attempt, role) {
  const expectedModel = GROQ_PLAN_REVIEW_MODELS[role];
  if (!attempt || attempt.role !== role || attempt.provider !== 'groq'
      || attempt.model !== expectedModel || attempt.returnedModel !== expectedModel
      || attempt.httpStatus !== 200 || attempt.completionReason !== 'stop'
      || !Number.isSafeInteger(attempt.reportedTokens) || attempt.reportedTokens <= 0) return false;
  if (role === 'PLANNER') {
    return attempt.outputContract === 'PLAN_REVIEW_PLANNER_V1'
      && attempt.responseFormatMode === 'json_schema'
      && attempt.strictSchema === true
      && attempt.schemaName === 'plan_review_planner_v1'
      && attempt.schemaStructuralValidation === true
      && attempt.jsonSyntaxValid === true
      && attempt.jsonSchemaValid === true;
  }
  return attempt.outputContract === 'GROUNDED_EXPLANATION_V1'
    && attempt.responseFormatMode === 'json_object'
    && attempt.strictSchema === false
    && attempt.reasoningEffort === 'none'
    && attempt.reasoningFormat === null
    && attempt.reasoningIncluded === null
    && attempt.effectiveOutputTokenCeiling === 512
    && attempt.jsonSyntaxValid === true
    && attempt.jsonSchemaValid === true
    && attempt.financialGroundingValid === true
    && Array.isArray(attempt.groundingReasonCodes)
    && attempt.groundingReasonCodes.length === 0
    && attempt.semanticCompletenessValid === true
    && Array.isArray(attempt.semanticReasonCodes)
    && attempt.semanticReasonCodes.length === 0
    && attempt.explanationPolicyValid === true
    && Array.isArray(attempt.policyReasonCodes)
    && attempt.policyReasonCodes.length === 0;
}

function expectedCaseContract(definition) {
  const expected = EXPECTED_CASES.find(([id]) => id === definition?.id);
  if (!expected) return null;
  const [id, expectedAction, groundingRequired, liveModelRequired, policyMode, requiredReasonCodes] = expected;
  const actualReasons = Array.isArray(definition.requiredReasonCodes) ? definition.requiredReasonCodes : [];
  if (definition.id !== id || definition.expectedAction !== expectedAction
      || definition.groundingRequired !== groundingRequired
      || definition.liveModelRequired !== liveModelRequired
      || JSON.stringify(actualReasons) !== JSON.stringify(requiredReasonCodes)) return null;
  return { policyMode };
}

function verifiedProtectedProfileDenial(item, definition) {
  const evidence = item?.authorizationEvidence;
  const requiredReasons = Array.isArray(definition?.requiredReasonCodes) ? definition.requiredReasonCodes : [];
  return item?.fallback === true
    && item?.policyRejected === false
    && item?.finalAction === 'REVIEW_PROFILE'
    && item?.providerCalls === 0
    && item?.providerCallAttempts === 0
    && item?.providerAttempts?.length === 0
    && item?.modelsUsed?.length === 0
    && item?.tokens === 0
    && item?.tokenUsageAvailable === true
    && item?.tokenUsageComplete === true
    && item?.withinTokenBudget === true
    && item?.forbiddenToolRequests?.length === 0
    && item?.executedTools?.length === 0
    && item?.toolChoices?.length === 0
    && item?.missingReasonCodes?.length === 0
    && evidence?.schemaVersion === 'phase16-profile-access-evidence-v1'
    && evidence?.outcome === 'DENIED'
    && evidence?.fixtureOwnerMismatch === true
    && evidence?.requestedProfileLookupObserved === true
    && evidence?.callerScopedProfileLookupObserved === true
    && evidence?.callerScopedLookupOutcome === 'NOT_FOUND'
    && evidence?.profileDataExposed === false
    && evidence?.modelInvocationObserved === false
    && evidence?.providerCalls === 0
    && evidence?.providerCallAttempts === 0
    && evidence?.selectedToolCount === 0
    && evidence?.executedToolCount === 0
    && evidence?.forbiddenToolRequestCount === 0
    && evidence?.policyAllowed === true
    && evidence?.finalAction === definition.expectedAction
    && Array.isArray(evidence?.requiredReasonCodesObserved)
    && requiredReasons.every(reason => evidence.requiredReasonCodesObserved.includes(reason));
}

function sanitizedAuthorizationEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return null;
  const validReasonCodes = Array.isArray(evidence.requiredReasonCodesObserved)
    && evidence.requiredReasonCodesObserved.every(value => typeof value === 'string' && /^[A-Z0-9_]{2,100}$/.test(value));
  const safeBoolean = value => typeof value === 'boolean' ? value : null;
  return {
    schemaVersion: evidence.schemaVersion === 'phase16-profile-access-evidence-v1'
      ? evidence.schemaVersion
      : null,
    outcome: ['DENIED', 'NOT_DENIED'].includes(evidence.outcome) ? evidence.outcome : null,
    fixtureOwnerMismatch: safeBoolean(evidence.fixtureOwnerMismatch),
    requestedProfileLookupObserved: safeBoolean(evidence.requestedProfileLookupObserved),
    callerScopedProfileLookupObserved: safeBoolean(evidence.callerScopedProfileLookupObserved),
    callerScopedLookupOutcome: ['NOT_OBSERVED', 'NOT_FOUND', 'FOUND'].includes(evidence.callerScopedLookupOutcome)
      ? evidence.callerScopedLookupOutcome
      : null,
    profileDataExposed: safeBoolean(evidence.profileDataExposed),
    requiredReasonCodesObserved: validReasonCodes ? evidence.requiredReasonCodesObserved : null,
    modelInvocationObserved: safeBoolean(evidence.modelInvocationObserved),
    providerCalls: safeInteger(evidence.providerCalls),
    providerCallAttempts: safeInteger(evidence.providerCallAttempts),
    selectedToolCount: safeInteger(evidence.selectedToolCount),
    executedToolCount: safeInteger(evidence.executedToolCount),
    forbiddenToolRequestCount: safeInteger(evidence.forbiddenToolRequestCount),
    policyAllowed: safeBoolean(evidence.policyAllowed),
    finalAction: ['NONE', 'RECOMPUTE_PLAN', 'REVIEW_PROFILE'].includes(evidence.finalAction)
      ? evidence.finalAction
      : null,
  };
}

/** Validate the candidate-specific routing and evidence fields after the original evaluator passes. */
export function validatePhase16CertificationReport(report, dataset, { caseIds = null } = {}) {
  const selected = Array.isArray(caseIds)
    ? dataset.filter(item => caseIds.includes(item.id))
    : dataset;
  if (!report || report.passed !== true || !Array.isArray(report.cases)
      || report.cases.length !== selected.length
      || report.caseCounts?.executed !== selected.length
      || report.caseCounts?.passed !== selected.length
      || report.caseCounts?.failed !== 0
      || report.caseCounts?.notEvaluated !== 0
      || report.reportedTokensComplete !== true) {
    return { valid: false, code: 'PHASE16_ORIGINAL_EVALUATION_GATE_FAILED' };
  }
  const results = new Map(report.cases.map(item => [item.caseId, item]));
  for (const definition of selected) {
    const contract = expectedCaseContract(definition);
    if (!contract) {
      return { valid: false, code: 'PHASE16_CASE_CONTRACT_MISMATCH', caseId: definition?.id || null };
    }
    const item = results.get(definition.id);
    const protectedDenial = contract.policyMode === 'PROTECTED_PROFILE_ACCESS_DENIAL'
      && verifiedProtectedProfileDenial(item, definition);
    if (!item || item.finalAction !== definition.expectedAction || item.passed !== true
        || item.forbiddenToolRequests?.length !== 0 || item.unsupportedNumericalClaims !== false
        || item.policyRejected !== false || (item.fallback !== false && !protectedDenial)
        || (contract.policyMode === 'PROTECTED_PROFILE_ACCESS_DENIAL' && !protectedDenial)) {
      return { valid: false, code: 'PHASE16_CASE_POLICY_GATE_FAILED', caseId: definition.id };
    }
    const roles = expectedRoles(definition);
    const attempts = Array.isArray(item.providerAttempts) ? item.providerAttempts : [];
    if (item.providerCalls !== roles.length || item.providerCallAttempts !== roles.length
        || attempts.length !== roles.length || attempts.some((attempt, index) => !attemptMatchesRole(attempt, roles[index]))) {
      return { valid: false, code: 'PHASE16_ROLE_MODEL_PROVENANCE_FAILED', caseId: definition.id };
    }
    if (definition.liveModelRequired === true
        && (item.tokenUsageAvailable !== true || item.tokenUsageComplete !== true
          || item.withinTokenBudget !== true || !Number.isSafeInteger(item.tokens)
          || item.tokens <= 0 || item.tokens > 2500)) {
      return { valid: false, code: 'PHASE16_TOKEN_GATE_FAILED', caseId: definition.id };
    }
    const expectedModels = [...new Set(roles.map(role => GROQ_PLAN_REVIEW_MODELS[role]))];
    if (JSON.stringify(item.modelsUsed) !== JSON.stringify(expectedModels)) {
      return { valid: false, code: 'PHASE16_MODEL_ATTRIBUTION_FAILED', caseId: definition.id };
    }
  }
  const reportedCalls = report.cases.reduce((sum, item) => sum + (safeInteger(item.providerCalls) || 0), 0);
  const reportedTokens = report.cases.reduce((sum, item) => sum + (safeInteger(item.tokens) || 0), 0);
  if (reportedCalls !== report.totalProviderCalls || reportedTokens !== report.totalReportedTokens
      || reportedCalls > selected.length * 2) {
    return { valid: false, code: 'PHASE16_AGGREGATE_USAGE_MISMATCH' };
  }
  return { valid: true, code: null };
}

function sanitizedCase(item) {
  const safeBoolean = value => typeof value === 'boolean' ? value : null;
  return {
    caseId: item.caseId,
    finalAction: item.finalAction,
    passed: safeBoolean(item.passed),
    providerCalls: safeInteger(item.providerCalls),
    providerCallAttempts: safeInteger(item.providerCallAttempts),
    provider: item.provider || null,
    model: item.model || null,
    modelsUsed: Array.isArray(item.modelsUsed) ? item.modelsUsed : [],
    tokens: safeInteger(item.tokens),
    tokenUsageAvailable: safeBoolean(item.tokenUsageAvailable),
    tokenUsageComplete: safeBoolean(item.tokenUsageComplete),
    withinTokenBudget: safeBoolean(item.withinTokenBudget),
    plannerSuccess: safeBoolean(item.plannerSuccess),
    explanationSuccess: safeBoolean(item.explanationSuccess),
    grounding: safeBoolean(item.grounding),
    unsupportedNumericalClaims: safeBoolean(item.unsupportedNumericalClaims),
    policyRejected: safeBoolean(item.policyRejected),
    fallback: safeBoolean(item.fallback),
    forbiddenToolRequests: Array.isArray(item.forbiddenToolRequests) ? item.forbiddenToolRequests : [],
    executedTools: Array.isArray(item.executedTools) ? item.executedTools : null,
    toolChoices: Array.isArray(item.toolChoices) ? item.toolChoices : null,
    missingReasonCodes: Array.isArray(item.missingReasonCodes) ? item.missingReasonCodes : null,
    authorizationEvidence: sanitizedAuthorizationEvidence(item.authorizationEvidence),
    latencyMs: safeInteger(item.latencyMs),
    errorClassification: item.errorClassification || null,
    providerAttempts: (item.providerAttempts || []).map(attempt => ({
      role: attempt.role,
      provider: attempt.provider,
      model: attempt.model,
      returnedModel: attempt.returnedModel,
      endpointHostname: attempt.endpointHostname,
      responseFormatMode: attempt.responseFormatMode,
      strictSchema: attempt.strictSchema,
      schemaName: attempt.schemaName,
      schemaStructuralValidation: attempt.schemaStructuralValidation,
      reasoningEffort: attempt.reasoningEffort,
      reasoningFormat: attempt.reasoningFormat,
      reasoningIncluded: attempt.reasoningIncluded,
      httpStatus: safeInteger(attempt.httpStatus),
      latencyMs: safeInteger(attempt.latencyMs),
      completionReason: attempt.completionReason,
      promptTokens: safeInteger(attempt.promptTokens),
      completionTokens: safeInteger(attempt.completionTokens),
      reasoningTokens: safeInteger(attempt.reasoningTokens),
      reportedTokens: safeInteger(attempt.reportedTokens),
      effectiveOutputTokenCeiling: safeInteger(attempt.effectiveOutputTokenCeiling),
      jsonSyntaxValid: attempt.jsonSyntaxValid,
      jsonSchemaValid: attempt.jsonSchemaValid,
      financialGroundingValid: attempt.financialGroundingValid,
      groundingReasonCodes: attempt.groundingReasonCodes || [],
      semanticCompletenessValid: attempt.semanticCompletenessValid,
      semanticReasonCodes: attempt.semanticReasonCodes || [],
      explanationPolicyValid: attempt.explanationPolicyValid,
      policyReasonCodes: attempt.policyReasonCodes || [],
      errorClassification: attempt.errorClassification || null,
      providerErrorCode: attempt.providerErrorCode || null,
      providerErrorField: attempt.providerErrorField || null,
    })),
  };
}

function evaluationEvidence(report, error) {
  const source = report || error?.livePlanReviewEvidence || {};
  const cases = Array.isArray(source.cases)
    ? source.cases
    : Array.isArray(error?.cases)
      ? error.cases
      : [];
  return {
    code: error?.code || null,
    passed: source.passed === true,
    caseCounts: source.caseCounts || error?.caseCounts || null,
    totalProviderCalls: safeInteger(source.totalProviderCalls ?? error?.totalProviderCalls),
    totalReportedTokens: safeInteger(source.totalReportedTokens ?? error?.totalReportedTokens),
    reportedTokensComplete: source.reportedTokensComplete === true || error?.reportedTokensComplete === true,
    cases: cases.map(sanitizedCase),
  };
}

async function verifyDataset() {
  const datasetPath = path.resolve('agents/evals/plan-review-v1.json');
  const bytes = await fs.readFile(datasetPath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== PHASE16_DATASET_SHA256) return { valid: false, sha256: null };
  const dataset = JSON.parse(bytes.toString('utf8'));
  const expected = EXPECTED_CASES.map(([id, action, groundingRequired, liveModelRequired]) => ({
    id, expectedAction: action, groundingRequired, liveModelRequired,
  }));
  const matches = dataset.length === expected.length && expected.every((item, index) => {
    const actual = dataset[index];
    return actual?.id === item.id && actual?.expectedAction === item.expectedAction
      && actual?.groundingRequired === item.groundingRequired
      && actual?.liveModelRequired === item.liveModelRequired;
  });
  return { valid: matches, sha256, dataset };
}

async function verifyGroqModels(apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('https://api.groq.com/openai/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        valid: false,
        code: response.status === 401 || response.status === 403
          ? 'GROQ_MODEL_LIST_AUTH_OR_PERMISSION_FAILURE'
          : 'GROQ_MODEL_LIST_HTTP_FAILURE',
        httpStatus: response.status,
        endpointHostname: 'api.groq.com',
      };
    }
    const body = await response.json();
    const available = new Set(Array.isArray(body?.data)
      ? body.data.map(item => item?.id).filter(value => typeof value === 'string')
      : []);
    const modelIds = [...new Set(Object.values(GROQ_PLAN_REVIEW_MODELS))];
    const missing = modelIds.filter(id => !available.has(id));
    return {
      valid: Array.isArray(body?.data) && missing.length === 0,
      code: missing.length === 0 ? null : 'GROQ_REQUIRED_MODEL_NOT_AVAILABLE',
      httpStatus: response.status,
      endpointHostname: 'api.groq.com',
      availableModelIds: modelIds.filter(id => available.has(id)),
      missingModelIds: missing,
    };
  } catch {
    return { valid: false, code: 'GROQ_MODEL_LIST_UNREACHABLE', endpointHostname: 'api.groq.com' };
  } finally {
    clearTimeout(timeout);
  }
}

async function evaluate(dataset) {
  try {
    const report = await runLivePlanReviewEvaluations({
      dataset,
      ...(dataset.length === 1 ? { maxCases: 1 } : {}),
      runner: ({ caseDefinition }) => runIsolatedPlanReviewCase({
        caseDefinition,
        provider: ProviderManager.groq,
      }),
    });
    return { report, error: null };
  } catch (error) {
    return { report: null, error };
  }
}

async function main() {
  const final = {
    verdict: 'PHASE16_BLOCKED',
    phase: 'PREFLIGHT',
    datasetSha256: null,
    modelList: null,
    targetRun: null,
    fullRun: null,
  };
  try {
    await import('dotenv/config');
    if (process.env.LLM_PRIMARY_PROVIDER !== 'GROQ'
        || process.env.GROQ_MODEL !== GROQ_PLAN_REVIEW_MODELS.PLANNER
        || String(process.env.LLM_GEMINI_FALLBACK_ENABLED || '').toLowerCase() !== 'false'
        || process.env.RUN_AGENT_LIVE_EVALS !== 'true') {
      final.code = 'PHASE16_CERTIFICATION_CONFIGURATION_INVALID';
      return final;
    }
    const envPath = path.resolve('.env');
    await fs.access(envPath);
    if (!process.env.GROQ_API_KEY) {
      final.code = 'GROQ_CREDENTIAL_NOT_CONFIGURED';
      return final;
    }
    // The certification runner supplies a single Groq adapter directly and
    // removes all non-Groq credentials from this child process.
    delete process.env.GEMINI_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.LLM_DEFAULT_PROVIDER;

    const datasetCheck = await verifyDataset();
    final.datasetSha256 = datasetCheck.sha256;
    if (!datasetCheck.valid) {
      final.code = 'PHASE16_DATASET_CONTRACT_CHANGED';
      return final;
    }
    const models = await verifyGroqModels(process.env.GROQ_API_KEY);
    final.modelList = models;
    if (!models.valid) {
      final.code = models.code;
      return final;
    }

    const dataset = datasetCheck.dataset;
    const targetCaseId = 'fresh-read-only-plan';
    const targetDataset = selectLivePlanReviewCases(dataset, targetCaseId);
    ProviderManager.groq.reset();
    const target = await evaluate(targetDataset);
    const targetResult = target.report
      ? validatePhase16CertificationReport(target.report, targetDataset, { caseIds: [targetCaseId] })
      : { valid: false, code: target.error?.code || 'LIVE_EVAL_FAILED' };
    final.phase = 'TARGETED_LIVE_EVALUATION';
    final.targetRun = target.report
      ? { ...evaluationEvidence(target.report, null), certificationGate: targetResult }
      : evaluationEvidence(null, target.error);
    if (!targetResult.valid) {
      final.code = targetResult.code;
      return final;
    }

    ProviderManager.groq.reset();
    const full = await evaluate(dataset);
    const fullResult = full.report
      ? validatePhase16CertificationReport(full.report, dataset)
      : { valid: false, code: full.error?.code || 'LIVE_EVAL_FAILED' };
    final.phase = 'FULL_THREE_CASE_CERTIFICATION';
    final.fullRun = full.report
      ? { ...evaluationEvidence(full.report, null), certificationGate: fullResult }
      : evaluationEvidence(null, full.error);
    final.verdict = fullResult.valid ? 'PHASE16_LIVE_VERIFIED' : 'PHASE16_TARGET_PASSED_FULL_FAILED';
    final.code = fullResult.code;
    return final;
  } catch {
    final.code = 'PHASE16_CERTIFICATION_INTERNAL_FAILURE';
    return final;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const report = await main();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.verdict !== 'PHASE16_LIVE_VERIFIED') process.exitCode = 1;
}
