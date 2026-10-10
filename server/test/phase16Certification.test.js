import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePhase16CertificationReport } from '../scripts/phase16Certification.js';

function plannerAttempt(overrides = {}) {
  return {
    role: 'PLANNER',
    outputContract: 'PLAN_REVIEW_PLANNER_V1',
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    returnedModel: 'openai/gpt-oss-120b',
    responseFormatMode: 'json_schema',
    strictSchema: true,
    schemaName: 'plan_review_planner_v1',
    schemaStructuralValidation: true,
    httpStatus: 200,
    completionReason: 'stop',
    reportedTokens: 320,
    jsonSyntaxValid: true,
    jsonSchemaValid: true,
    ...overrides,
  };
}

function explainerAttempt(overrides = {}) {
  return {
    role: 'EXPLAINER',
    outputContract: 'GROUNDED_EXPLANATION_V1',
    provider: 'groq',
    model: 'qwen/qwen3.8-27b',
    returnedModel: 'qwen/qwen3.8-27b',
    responseFormatMode: 'json_object',
    strictSchema: false,
    reasoningEffort: 'none',
    reasoningFormat: null,
    reasoningIncluded: null,
    httpStatus: 200,
    completionReason: 'stop',
    reportedTokens: 680,
    effectiveOutputTokenCeiling: 512,
    jsonSyntaxValid: true,
    jsonSchemaValid: true,
    financialGroundingValid: true,
    groundingReasonCodes: [],
    semanticCompletenessValid: true,
    semanticReasonCodes: [],
    explanationPolicyValid: true,
    policyReasonCodes: [],
    ...overrides,
  };
}

function liveCase(caseId, finalAction, attempts, tokens, overrides = {}) {
  return {
    caseId,
    finalAction,
    passed: true,
    providerCalls: attempts.length,
    providerCallAttempts: attempts.length,
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    modelsUsed: [...new Set(attempts.map(attempt => attempt.returnedModel))],
    tokens,
    tokenUsageAvailable: true,
    tokenUsageComplete: true,
    withinTokenBudget: true,
    forbiddenToolRequests: [],
    unsupportedNumericalClaims: false,
    policyRejected: false,
    fallback: false,
    executedTools: [],
    toolChoices: [],
    missingReasonCodes: [],
    authorizationEvidence: null,
    providerAttempts: attempts,
    ...overrides,
  };
}

function profileDenialEvidence(overrides = {}) {
  return {
    schemaVersion: 'phase16-profile-access-evidence-v1',
    outcome: 'DENIED',
    fixtureOwnerMismatch: true,
    requestedProfileLookupObserved: true,
    callerScopedProfileLookupObserved: true,
    callerScopedLookupOutcome: 'NOT_FOUND',
    profileDataExposed: false,
    requiredReasonCodesObserved: ['PROFILE_MISSING'],
    modelInvocationObserved: false,
    providerCalls: 0,
    providerCallAttempts: 0,
    selectedToolCount: 0,
    executedToolCount: 0,
    forbiddenToolRequestCount: 0,
    policyAllowed: true,
    finalAction: 'REVIEW_PROFILE',
    ...overrides,
  };
}

function validDataset() {
  return [
    { id: 'fresh-read-only-plan', expectedAction: 'NONE', groundingRequired: true, liveModelRequired: true, requiredReasonCodes: [] },
    { id: 'missing-recommendation', expectedAction: 'RECOMPUTE_PLAN', groundingRequired: false, liveModelRequired: true, requiredReasonCodes: ['RECOMMENDATION_MISSING'] },
    { id: 'cross-user-profile', expectedAction: 'REVIEW_PROFILE', groundingRequired: false, liveModelRequired: false, requiredReasonCodes: ['PROFILE_MISSING'] },
  ];
}

function validReport() {
  const cases = [
    liveCase('fresh-read-only-plan', 'NONE', [plannerAttempt(), explainerAttempt()], 1000),
    liveCase('missing-recommendation', 'RECOMPUTE_PLAN', [plannerAttempt()], 400, {
      explanationSuccess: false,
      grounding: null,
    }),
    liveCase('cross-user-profile', 'REVIEW_PROFILE', [], 0, {
      providerCalls: 0,
      providerCallAttempts: 0,
      provider: 'groq',
      modelsUsed: [],
      tokens: 0,
      tokenUsageAvailable: true,
      tokenUsageComplete: true,
      withinTokenBudget: true,
      fallback: true,
      authorizationEvidence: profileDenialEvidence(),
    }),
  ];
  return {
    passed: true,
    caseCounts: { executed: 3, passed: 3, failed: 0, notEvaluated: 0 },
    totalProviderCalls: 3,
    totalReportedTokens: 1400,
    reportedTokensComplete: true,
    cases,
  };
}

test('certification model-contract gate accepts only role-scoped actual Groq models across the original cases', () => {
  const report = validReport();
  assert.deepEqual(validatePhase16CertificationReport(report, validDataset()), { valid: true, code: null });
  const targetReport = {
    ...report,
    caseCounts: { executed: 1, passed: 1, failed: 0, notEvaluated: 0 },
    totalProviderCalls: 2,
    totalReportedTokens: 1000,
    cases: [report.cases[0]],
  };
  assert.deepEqual(validatePhase16CertificationReport(targetReport, [validDataset()[0]], { caseIds: ['fresh-read-only-plan'] }), {
    valid: true,
    code: null,
  });
});

test('certification accepts only a proof-backed deterministic cross-user profile denial', () => {
  const report = validReport();
  assert.deepEqual(validatePhase16CertificationReport(report, validDataset()), { valid: true, code: null });
});

test('certification fails closed on a substituted model, grounding, semantic or policy failure, fallback, or unexpected cross-user call', () => {
  const cases = [
    report => { report.cases[0].providerAttempts[1].returnedModel = 'openai/gpt-oss-120b'; },
    report => { report.cases[0].providerAttempts[1].financialGroundingValid = false; },
    report => { report.cases[0].providerAttempts[1].semanticCompletenessValid = false; },
    report => { report.cases[0].providerAttempts[1].explanationPolicyValid = false; },
    report => { report.cases[0].fallback = true; },
    report => {
      report.cases[2].providerCalls = 1;
      report.cases[2].providerCallAttempts = 1;
      report.cases[2].providerAttempts = [plannerAttempt()];
      report.cases[2].modelsUsed = ['openai/gpt-oss-120b'];
      report.totalProviderCalls += 1;
      report.totalReportedTokens += 320;
    },
  ];
  for (const corrupt of cases) {
    const report = validReport();
    corrupt(report);
    assert.equal(validatePhase16CertificationReport(report, validDataset()).valid, false);
  }
});

test('protected denial evidence rejects data exposure, model calls, tools, wrong action, and missing or false denial proof', () => {
  const corruptions = [
    report => { report.cases[2].authorizationEvidence.profileDataExposed = true; },
    report => {
      report.cases[2].authorizationEvidence.providerCalls = 1;
      report.cases[2].authorizationEvidence.providerCallAttempts = 1;
      report.cases[2].authorizationEvidence.modelInvocationObserved = true;
    },
    report => {
      report.cases[2].authorizationEvidence.selectedToolCount = 1;
      report.cases[2].toolChoices = ['get_current_profile_context'];
    },
    report => {
      report.cases[2].authorizationEvidence.executedToolCount = 1;
      report.cases[2].executedTools = ['get_current_profile_context'];
    },
    report => { report.cases[2].finalAction = 'NONE'; },
    report => { delete report.cases[2].authorizationEvidence; },
    report => { report.cases[2].authorizationEvidence.callerScopedProfileLookupObserved = false; },
    report => { report.cases[2].authorizationEvidence.callerScopedLookupOutcome = 'FOUND'; },
    report => { report.cases[2].authorizationEvidence.requiredReasonCodesObserved = []; },
    report => { report.cases[2].authorizationEvidence.outcome = 'NOT_DENIED'; },
  ];

  for (const corrupt of corruptions) {
    const report = validReport();
    corrupt(report);
    assert.equal(validatePhase16CertificationReport(report, validDataset()).valid, false);
  }
});

test('provider outage and incomplete token accounting cannot be relabeled as protected denial', () => {
  const outage = validReport();
  outage.cases[2].providerCallAttempts = 1;
  outage.cases[2].providerAttempts = [plannerAttempt({
    httpStatus: 503,
    completionReason: null,
    reportedTokens: 0,
  })];
  outage.cases[2].authorizationEvidence.providerCallAttempts = 1;
  outage.cases[2].authorizationEvidence.modelInvocationObserved = true;
  assert.equal(validatePhase16CertificationReport(outage, validDataset()).valid, false);

  const incomplete = validReport();
  incomplete.cases[2].tokenUsageAvailable = false;
  incomplete.cases[2].tokenUsageComplete = false;
  assert.equal(validatePhase16CertificationReport(incomplete, validDataset()).valid, false);
});

test('fallback remains a hard failure for required model cases and bad explanation grounding', () => {
  const fallback = validReport();
  fallback.cases[0].fallback = true;
  assert.equal(validatePhase16CertificationReport(fallback, validDataset()).valid, false);

  const ungrounded = validReport();
  ungrounded.cases[0].providerAttempts[1].financialGroundingValid = false;
  assert.equal(validatePhase16CertificationReport(ungrounded, validDataset()).valid, false);
});

test('changing the protected case identifier or its contract cannot bypass the denial gate', () => {
  const changedReport = validReport();
  changedReport.cases[2].caseId = 'renamed-cross-user-profile';
  assert.equal(validatePhase16CertificationReport(changedReport, validDataset()).valid, false);

  const changedDataset = validDataset();
  changedDataset[2].id = 'renamed-cross-user-profile';
  assert.deepEqual(validatePhase16CertificationReport(validReport(), changedDataset), {
    valid: false,
    code: 'PHASE16_CASE_CONTRACT_MISMATCH',
    caseId: 'renamed-cross-user-profile',
  });
});
