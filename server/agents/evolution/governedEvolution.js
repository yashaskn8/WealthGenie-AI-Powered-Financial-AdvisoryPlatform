import crypto from 'node:crypto';
import { createOptimizerEvaluationManifest, evaluateCandidateAsync, assertHoldoutIsolation } from '../evals/evaluationV2.js';
import { evaluateCandidateOnHoldout, hashHoldoutCases } from '../evals/holdoutVerifier.js';
import { runCandidateReliabilitySuite, RELIABILITY_SCENARIOS, CANDIDATE_RELIABILITY_SCENARIOS, buildReliabilityPromotionEvaluation } from '../reliability/index.js';
import { createPlanReviewScaffoldRunner } from './scaffoldEvolution.js';
import { createScaffoldSpec, assertScaffoldSpecSafe } from './scaffoldSpec.js';
import { createEvolutionSandboxManifest } from './sandboxManifest.js';
import { createEvolutionSandboxProvider, sandboxExecutionPassed } from './sandboxProvider.js';
import { buildGepaFeedback, assertGepaFeedbackSafe } from './feedback.js';
import { validateCandidateSurfaces, scanPromptBundleSecurity } from './candidateSecurity.js';
import { buildCandidateLineage, selectParetoFrontier } from './pareto.js';
import { createEvolutionBudget } from './evolutionBudget.js';
import { canonicalSha256 } from '../../utils/canonicalJson.js';
import { PrometheusMetrics } from '../../services/metricsCollector.js';

export const GOVERNED_EVOLUTION_VERSION = 'governed-self-evolution-1.0.0';

const ALL_RELIABILITY_SCENARIOS = Object.freeze([...RELIABILITY_SCENARIOS, ...CANDIDATE_RELIABILITY_SCENARIOS]);

function candidateVersion(base, index) {
  return `${base.version}-candidate-${index + 1}-${crypto.randomUUID().slice(0, 8)}`;
}

function buildCandidate({ baseSpec, proposal, index }) {
  const promptBundle = proposal.promptBundle || baseSpec.promptBundle;
  scanPromptBundleSecurity(promptBundle);
  const candidate = createScaffoldSpec({
    ...baseSpec,
    version: candidateVersion(baseSpec, index),
    parentVersion: baseSpec.version,
    promptBundle,
    promptBundleId: promptBundle.bundleId,
    promptBundleHash: promptBundle.contentHash,
    evidenceOrderingPolicy: proposal.evidenceOrderingPolicy || baseSpec.evidenceOrderingPolicy,
    contextCompressionPolicy: proposal.contextCompressionPolicy || baseSpec.contextCompressionPolicy,
    safeModelRoleRouting: proposal.safeModelRoleRouting || baseSpec.safeModelRoleRouting,
  });
  validateCandidateSurfaces({ mutationSurface: proposal.mutationSurface || ['promptBundle.plannerInstruction'], scaffoldSpec: candidate, parentScaffoldSpec: baseSpec });
  assertScaffoldSpecSafe(candidate);
  return candidate;
}

export function measureExecution(observations = []) {
  const results = observations.map(item => item.result || {});
  const latencies = observations.map(item => Number(item.durationMs)).filter(Number.isFinite);
  const executionFor = item => item.result?.review?.execution || item.result?.execution || item.execution || {};
  const modelCalls = results.reduce((sum, item) => sum + Number(
    executionFor(item).modelCallCount ?? item.result?.modelCallCount ?? item.modelCallCount ?? 0,
  ), 0);
  const explicitTokenValues = results.map(item => {
    const execution = executionFor(item);
    const value = execution.tokenUsage ?? item.result?.tokenUsage ?? item.result?.usage?.totalTokens ?? item.tokenUsage;
    return value === null || value === undefined ? null : Number(value);
  });
  const tokenUsage = modelCalls === 0 && explicitTokenValues.every(value => value === null)
    ? 0
    : (explicitTokenValues.length === results.length && explicitTokenValues.every(Number.isFinite)
      ? explicitTokenValues.reduce((sum, value) => sum + value, 0)
      : null);
  const toolCalls = results.reduce((sum, item) => sum + Number(
    executionFor(item).toolCallCount ?? item.result?.toolCallCount ?? item.toolCallCount ?? 0,
  ), 0)
    || observations.reduce((sum, item) => sum + (Array.isArray(item.result?.trajectory)
      ? item.result.trajectory.filter(event => event?.type === 'TOOL_SUCCEEDED' || event?.kind === 'TOOL_SUCCEEDED').length
      : 0), 0);
  const researchQueries = observations.reduce((sum, item) => sum + (Array.isArray(item.result?.trajectory)
    ? item.result.trajectory.filter(event => /RESEARCH_(?:SEARCH_ROUND|QUERY|SOURCES_FOUND)/.test(String(event?.type || event?.kind || ''))).length
    : 0), 0);
  return Object.freeze({
    runs: observations.length,
    meanLatencyMs: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null,
    modelCalls,
    tokenUsage,
    toolCalls,
    researchQueries,
  });
}

function buildCandidateSandboxWorkspace({ candidate, sandboxManifest }) {
  const promptHash = JSON.stringify(candidate.promptBundleHash);
  const scaffoldHash = JSON.stringify(candidate.contentHash);
  const manifestHash = JSON.stringify(sandboxManifest.manifestHash);
  return [{
    path: 'candidate-evaluation',
    content: [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "test('candidate artifact is bound to the sandbox manifest', () => {",
      `  assert.equal(${promptHash}, ${JSON.stringify(sandboxManifest.promptBundleHash)});`,
      `  assert.equal(${scaffoldHash}, ${JSON.stringify(sandboxManifest.scaffoldHash)});`,
      `  assert.equal(${manifestHash}, ${JSON.stringify(sandboxManifest.manifestHash)});`,
      '});',
    ].join('\n'),
  }];
}

export async function runGovernedEvolution({
  baseSpec,
  cases = [],
  enabled = false,
  proposals = [],
  runner = null,
  sandboxProvider = null,
  loadHoldoutCases = null,
  persistCandidate = null,
  persistEvolutionRun = null,
  failureReports = [],
  reliabilityScenarios = ALL_RELIABILITY_SCENARIOS,
  candidateCaseFactory = null,
  reliabilityDependencies = {},
  budget: requestedBudget = {},
} = {}) {
  if (!enabled) return Object.freeze({ status: 'DISABLED', reason: 'AGENT_EVOLUTION_ENABLED is false.' });
  assertScaffoldSpecSafe(baseSpec);
  const budget = createEvolutionBudget(requestedBudget);
  const manifest = createOptimizerEvaluationManifest({ cases, datasetVersion: GOVERNED_EVOLUTION_VERSION, source: 'offline-sanitized' });
  const expectedHoldoutHash = cases.some(item => item?.partition === 'holdout')
    ? hashHoldoutCases(cases.filter(item => item?.partition === 'holdout'))
    : null;
  const optimizerCases = [...manifest.partitions.train, ...manifest.partitions.validation];
  assertHoldoutIsolation(optimizerCases);
  const holdoutAvailable = typeof loadHoldoutCases === 'function';
  const candidateReliabilityCalls = reliabilityScenarios.filter(scenario => scenario.executionMode !== 'SYSTEM_ONLY').length;
  if (typeof runner !== 'function') {
    const error = new Error('Governed evolution requires a real closed-loop PlanReview runner.');
    error.code = 'EVOLUTION_RUNNER_REQUIRED';
    throw error;
  }
  if (proposals.length > budget.maxCandidates) throw new Error('Candidate count exceeds the evolution budget.');
  let activeCandidateRunner = null;
  const fixtureSandboxMetricCalls = sandboxProvider ? 0 : 1;
  const provider = sandboxProvider || createEvolutionSandboxProvider({
    provider: 'fixture',
    execute: async ({ candidate }) => {
      if (typeof activeCandidateRunner !== 'function') {
        const error = new Error('Fixture sandbox execution was not bound to a budgeted candidate runner.');
        error.code = 'EVOLUTION_RUNNER_BUDGET_BINDING_REQUIRED';
        throw error;
      }
      const firstCase = optimizerCases[0];
      const closedLoop = await activeCandidateRunner({ candidate, caseDefinition: firstCase });
      return {
        stdout: 'fixture-plan-review-closed-loop',
        testResults: { passed: true },
        evaluationMetrics: { financialAuthorityDelta: closedLoop.financialAuthorityDelta },
      };
    },
  });
  const records = [];
  let sandboxRuns = 0;
  let metricCalls = 0;
  let sandboxElapsedMs = 0;
  let totalTokenUsage = 0;
  for (let index = 0; index < proposals.length; index += 1) {
    if (sandboxRuns >= budget.maxSandboxRuns || budget.maxSandboxMinutes === 0) break;
    const minimumHoldoutCalls = holdoutAvailable ? 10 : 0;
    if (metricCalls + fixtureSandboxMetricCalls + optimizerCases.length + candidateReliabilityCalls + minimumHoldoutCalls > budget.maxMetricCalls) break;
    const proposal = proposals[index];
    const candidate = buildCandidate({ baseSpec, proposal, index });
    const candidateId = candidate.contentHash;
    const sandboxManifest = createEvolutionSandboxManifest({
      candidateId,
      scaffoldHash: candidate.contentHash,
      promptBundleHash: candidate.promptBundleHash,
      allowedFiles: ['candidate-evaluation'],
      datasetHash: manifest.datasetHash,
      evaluationVersion: manifest.evaluationVersion,
      reliabilityVersion: 'reliability-lab-1.0.0',
    });
    const executionObservations = [];
    const runCandidateInput = async input => {
      const startedAt = Date.now();
      try {
        const result = await runner(input);
        executionObservations.push({ result, durationMs: Math.max(0, Date.now() - startedAt) });
        return result;
      } catch (error) {
        const usage = error?.planReviewUsage;
        const modelCallCount = Number.isInteger(usage?.modelCallCount) && usage.modelCallCount >= 0
          ? usage.modelCallCount
          : 1;
        const tokenUsage = Number.isInteger(usage?.tokenUsage) && usage.tokenUsage >= 0
          ? usage.tokenUsage
          : null;
        executionObservations.push({
          result: { execution: { modelCallCount, tokenUsage } },
          durationMs: Math.max(0, Date.now() - startedAt),
        });
        throw error;
      }
    };
    const runCandidateCase = caseDefinition => runCandidateInput({ candidate, caseDefinition });
    activeCandidateRunner = runCandidateInput;
    let sandbox;
    try {
      sandbox = await provider.run({
        manifest: sandboxManifest,
        candidate,
        fixture: optimizerCases[0]?.fixture || null,
        workspaceFiles: buildCandidateSandboxWorkspace({ candidate, sandboxManifest }),
        command: 'node --test candidate-evaluation',
      });
    } finally {
      activeCandidateRunner = null;
    }
    metricCalls += fixtureSandboxMetricCalls;
    const sandboxTestPassed = sandboxExecutionPassed(sandbox);
    sandboxRuns += 1;
    const sandboxDurationMs = Math.max(0, new Date(sandbox.completedAt).getTime() - new Date(sandbox.startedAt).getTime());
    if (Number.isFinite(sandboxDurationMs)) sandboxElapsedMs += sandboxDurationMs;
    const evaluation = await evaluateCandidateAsync({
      candidateId,
      cases: optimizerCases,
      evaluator: runCandidateCase,
    });
    metricCalls += optimizerCases.length;
    const reliability = await runCandidateReliabilitySuite(reliabilityScenarios, {
      candidate,
      runner: runCandidateInput,
      candidateCaseFactory,
      systemDependencies: reliabilityDependencies,
    });
    const reliabilityEvaluationBase = buildReliabilityPromotionEvaluation({
      scorecards: reliability.scorecards,
      candidateReliabilityCoverageComplete: reliability.candidateReliabilityCoverageComplete,
      expectedScenarioIds: reliabilityScenarios.map(scenario => scenario.id),
    });
    const reliabilityEvaluation = reliability.scorecards.length > 0
      ? reliabilityEvaluationBase
      : Object.freeze({ ...reliabilityEvaluationBase, passed: false, criticalFailures: ['RELIABILITY_SUITE_EMPTY'] });
    metricCalls += candidateReliabilityCalls;
    let holdout = null;
    if (typeof loadHoldoutCases === 'function' && evaluation.passed && reliabilityEvaluation.passed) {
      holdout = await evaluateCandidateOnHoldout({
        candidateId,
        runner: item => runCandidateCase(item.caseDefinition || item),
        loadHoldoutCases,
        expectedDatasetHash: expectedHoldoutHash,
        expectedDatasetVersion: manifest.datasetVersion,
        optimizerCases,
        maxMetricCalls: Math.max(0, budget.maxMetricCalls - metricCalls),
      });
      metricCalls += holdout.scoreCards.length;
    }
    const authorityMeasurementComplete = evaluation.scoreCards.length > 0
      && evaluation.scoreCards.every(card => card.hardGates.authorityMeasurementComplete === true
        && Number.isFinite(card.hardGates.financialAuthorityDelta));
    const authorityDelta = authorityMeasurementComplete
      ? evaluation.scoreCards.reduce((sum, card) => sum + Number(card.hardGates.financialAuthorityDelta), 0)
      : null;
    const rawExecutionMetrics = measureExecution(executionObservations);
    if (rawExecutionMetrics.tokenUsage !== null) totalTokenUsage += rawExecutionMetrics.tokenUsage;
    const tokenAccountingIncomplete = rawExecutionMetrics.modelCalls > 0 && rawExecutionMetrics.tokenUsage === null;
    const budgetExceeded = tokenAccountingIncomplete
      || totalTokenUsage > budget.maxTotalTokens
      || metricCalls > budget.maxMetricCalls
      || sandboxElapsedMs > budget.maxSandboxMinutes * 60 * 1000;
    const hardGatePassed = evaluation.passed
      && reliabilityEvaluation.passed
      && reliabilityEvaluation.candidateReliabilityCoverageComplete === true
      && sandboxTestPassed
      && authorityMeasurementComplete
      && authorityDelta === 0
      && !budgetExceeded
      && holdoutAvailable
      && holdout?.passed === true
      && holdout?.holdoutAttestation === 'VERIFIED';
    const feedback = buildGepaFeedback({
      candidateId,
      evaluation,
      reliability: reliabilityEvaluation,
      authorityDelta,
      failures: [...failureReports,
        ...(budgetExceeded ? ['EVOLUTION_BUDGET_EXCEEDED'] : []),
        ...(!sandboxTestPassed ? ['SANDBOX_TESTS_FAILED'] : [])],
      sandbox,
    });
    assertGepaFeedbackSafe(feedback);
    const holdoutSummary = holdout ? {
      passed: holdout.passed,
      attestation: holdout.holdoutAttestation,
      failureCode: holdout.holdoutFailureCode || null,
    } : null;
    const evaluationHash = canonicalSha256({ evaluation, reliability: reliabilityEvaluation, holdout: holdoutSummary });
    const metrics = {
      correctness: evaluation.scoreCards.filter(card => card.scores.actionCorrect).length / Math.max(1, evaluation.scoreCards.length),
      grounding: evaluation.scoreCards.filter(card => card.scores.grounded).length / Math.max(1, evaluation.scoreCards.length),
      reliability: reliabilityEvaluation.passed ? 1 : 0,
      latency: rawExecutionMetrics.meanLatencyMs === null ? null : 1 / (1 + rawExecutionMetrics.meanLatencyMs),
      tokens: rawExecutionMetrics.tokenUsage === null ? null : 1 / (1 + rawExecutionMetrics.tokenUsage),
      toolCalls: 1 / (1 + rawExecutionMetrics.toolCalls),
      researchQueries: 1 / (1 + rawExecutionMetrics.researchQueries),
      measurements: rawExecutionMetrics,
    };
    records.push(Object.freeze({
      candidateId,
      status: hardGatePassed
        ? 'SHADOW_READY'
        : (evaluation.passed && reliabilityEvaluation.passed && sandboxTestPassed && !budgetExceeded
          ? (holdout?.holdoutAttestation === 'VERIFIED'
            ? 'REJECTED'
            : (holdoutAvailable ? 'HOLDOUT_ATTESTATION_REQUIRED' : 'HOLDOUT_PENDING'))
          : 'REJECTED'),
      candidate,
      lineage: buildCandidateLineage({
        candidateId,
        parentCandidateId: baseSpec.contentHash,
        generation: 1,
        mutationSurface: proposal.mutationSurface || ['promptBundle.plannerInstruction'],
        mutationReason: proposal.mutationReason,
        reflectionFeedbackHash: proposal.reflectionFeedbackHash,
        promptBundleHash: candidate.promptBundleHash,
        scaffoldHash: candidate.contentHash,
        evaluationHash,
      }),
      evaluation,
      reliability: reliabilityEvaluation,
      holdout: holdoutSummary,
      sandbox,
      sandboxTestPassed,
      candidateEvaluationLocation: provider.name === 'e2b'
        ? 'HOST_PROCESS; E2B_ONLY_CHECKS_MANIFEST_BINDING'
        : 'HOST_PROCESS; FIXTURE_SANDBOX_CHECKS_MANIFEST_BINDING',
      feedback,
      hardGatePassed,
      authorityMeasurementComplete,
      financialAuthorityDelta: authorityDelta,
      authorityMeasurementState: authorityMeasurementComplete ? 'MEASURED' : 'INCOMPLETE',
      metrics,
    }));
    if (typeof persistCandidate === 'function') {
      const record = records.at(-1);
      await persistCandidate({
        candidateId: record.candidateId,
        parentCandidateId: record.lineage.parentCandidateId,
        generation: record.lineage.generation,
        promptBundleId: record.candidate.promptBundleId,
        promptBundleHash: record.candidate.promptBundleHash,
        scaffoldHash: record.candidate.contentHash,
        mutationSurface: record.lineage.mutationSurface,
        mutationReason: record.lineage.mutationReason,
        status: record.status,
        trainMetrics: record.evaluation.scoreCards.filter(card => card.partition === 'train'),
        validationMetrics: record.evaluation.scoreCards.filter(card => card.partition === 'validation'),
        reliabilityMetrics: record.reliability,
        holdoutSummary: record.holdout,
        shadowMetrics: null,
        authorityMeasurementComplete: record.authorityMeasurementComplete,
        financialAuthorityDelta: record.financialAuthorityDelta,
      });
    }
  }
  const paretoCandidateIds = selectParetoFrontier(records);
  PrometheusMetrics.recordEvolutionRun({
    candidates: records.length,
    rejected: records.filter(record => record.status === 'REJECTED').length,
    sandboxRuns,
    metricCalls,
    holdoutPassed: records.filter(record => record.holdout?.passed === true).length,
    reliabilityRejections: records.filter(record => record.reliability.passed !== true).length,
    authorityRejections: records.filter(record => record.authorityMeasurementComplete !== true
      || record.financialAuthorityDelta !== 0).length,
  });
  const financialAuthorityMeasurementComplete = records.length > 0
    && records.every(record => record.authorityMeasurementComplete === true
      && Number.isFinite(record.financialAuthorityDelta));
  const report = {
    status: 'COMPLETED',
    version: GOVERNED_EVOLUTION_VERSION,
    budget,
    manifest: Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'partitions')),
    candidateRecords: records,
    paretoCandidateIds,
    championCandidateId: null,
    shadowOnly: true,
    promotionRequired: true,
    financialAuthorityMeasurementComplete,
    financialAuthorityDelta: financialAuthorityMeasurementComplete
      ? records.reduce((sum, record) => sum + record.financialAuthorityDelta, 0)
      : null,
    authorityMeasurementState: records.length > 0 && records.every(record => record.authorityMeasurementState === 'MEASURED')
      ? 'MEASURED'
      : 'INCOMPLETE',
    metrics: {
      metricCalls,
      totalTokens: totalTokenUsage,
      sandboxRuns,
      sandboxElapsedMs,
    },
  };
  if (typeof persistEvolutionRun === 'function') {
    await persistEvolutionRun({
      runId: crypto.randomUUID(),
      agentType: 'PLAN_REVIEW',
      status: 'COMPLETED',
      baseScaffoldVersion: baseSpec.version,
      candidateIds: records.map(record => record.candidateId),
      evaluationVersion: manifest.evaluationVersion,
      datasetHash: manifest.datasetHash,
      financialAuthorityDelta: report.financialAuthorityDelta,
      authorityMeasurementComplete: report.financialAuthorityMeasurementComplete,
      optimizerType: 'DSPY_GEPA',
      optimizerVersion: 'dspy-3.3.1-gepa-0.1.4',
      candidateCount: records.length,
      paretoCandidateIds,
      championCandidateId: null,
      metricCalls,
      totalTokens: totalTokenUsage,
      totalSandboxSeconds: sandboxElapsedMs / 1000,
    });
  }
  return Object.freeze(report);
}

export function createDefaultEvolutionRunner(dependencies = {}) {
  return createPlanReviewScaffoldRunner({ dependencies });
}

export function hashEvolutionReport(report) {
  return canonicalSha256(report);
}
