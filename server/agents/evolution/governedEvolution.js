import crypto from 'node:crypto';
import { createOptimizerEvaluationManifest, evaluateCandidateAsync, assertHoldoutIsolation, hashEvaluationData } from '../evals/evaluationV2.js';
import { verifyCandidateAgainstSealedHoldout } from '../evals/holdoutVerifier.js';
import { runCandidateReliabilitySuite, RELIABILITY_SCENARIOS, CANDIDATE_RELIABILITY_SCENARIOS, buildReliabilityPromotionEvaluation } from '../reliability/index.js';
import { createPlanReviewScaffoldRunner } from './scaffoldEvolution.js';
import { createScaffoldSpec, assertScaffoldSpecSafe } from './scaffoldSpec.js';
import { createEvolutionSandboxManifest } from './sandboxManifest.js';
import { createEvolutionSandboxProvider } from './sandboxProvider.js';
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
  validateCandidateSurfaces({ mutationSurface: proposal.mutationSurface || ['promptBundle.plannerInstruction'], scaffoldSpec: candidate });
  assertScaffoldSpecSafe(candidate);
  return candidate;
}

function measureExecution(observations = []) {
  const results = observations.map(item => item.result || {});
  const latencies = observations.map(item => Number(item.durationMs)).filter(Number.isFinite);
  const modelCalls = results.reduce((sum, item) => sum + Number(item.result?.modelCallCount || item.modelCallCount || 0), 0);
  const explicitTokenValues = results
    .map(item => item.result?.tokenUsage ?? item.result?.usage?.totalTokens ?? item.tokenUsage)
    .map(Number)
    .filter(Number.isFinite);
  const tokenUsage = explicitTokenValues.length === results.length
    ? explicitTokenValues.reduce((sum, value) => sum + value, 0)
    : (modelCalls === 0 ? 0 : null);
  const toolCalls = results.reduce((sum, item) => sum + Number(item.result?.toolCallCount || item.toolCallCount || 0), 0)
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
  const optimizerCases = [...manifest.partitions.train, ...manifest.partitions.validation];
  assertHoldoutIsolation(optimizerCases);
  const holdoutAvailable = typeof loadHoldoutCases === 'function';
  if (typeof runner !== 'function') {
    const error = new Error('Governed evolution requires a real closed-loop PlanReview runner.');
    error.code = 'EVOLUTION_RUNNER_REQUIRED';
    throw error;
  }
  if (proposals.length > budget.maxCandidates) throw new Error('Candidate count exceeds the evolution budget.');
  const provider = sandboxProvider || createEvolutionSandboxProvider({
    provider: 'fixture',
    execute: async ({ candidate }) => {
      const firstCase = optimizerCases[0];
      const closedLoop = await runner({ candidate, caseDefinition: firstCase });
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
    if (metricCalls + optimizerCases.length > budget.maxMetricCalls) break;
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
    const sandbox = await provider.run({
      manifest: sandboxManifest,
      candidate,
      fixture: optimizerCases[0]?.fixture || null,
      workspaceFiles: buildCandidateSandboxWorkspace({ candidate, sandboxManifest }),
      command: 'node --test candidate-evaluation',
    });
    sandboxRuns += 1;
    const sandboxDurationMs = Math.max(0, new Date(sandbox.completedAt).getTime() - new Date(sandbox.startedAt).getTime());
    if (Number.isFinite(sandboxDurationMs)) sandboxElapsedMs += sandboxDurationMs;
    const executionObservations = [];
    const runCandidateCase = async (caseDefinition) => {
      const startedAt = Date.now();
      const result = await runner({ candidate, caseDefinition });
      executionObservations.push({ result, durationMs: Math.max(0, Date.now() - startedAt) });
      return result;
    };
    const evaluation = await evaluateCandidateAsync({
      candidateId,
      cases: optimizerCases,
      evaluator: runCandidateCase,
    });
    metricCalls += optimizerCases.length;
    const reliability = await runCandidateReliabilitySuite(reliabilityScenarios, {
      candidate,
      runner,
      candidateCaseFactory,
      systemDependencies: reliabilityDependencies,
    });
    const reliabilityEvaluationBase = buildReliabilityPromotionEvaluation({
      scorecards: reliability.scorecards,
      holdout: { sealed: true },
      candidateReliabilityCoverageComplete: reliability.candidateReliabilityCoverageComplete,
    });
    const reliabilityEvaluation = reliability.scorecards.length > 0
      ? reliabilityEvaluationBase
      : Object.freeze({ ...reliabilityEvaluationBase, passed: false, criticalFailures: ['RELIABILITY_SUITE_EMPTY'] });
    let holdout = null;
    if (typeof loadHoldoutCases === 'function' && evaluation.passed && reliabilityEvaluation.passed) {
      holdout = await verifyCandidateAgainstSealedHoldout({
        candidateId,
        runner: item => runCandidateCase(item.caseDefinition || item),
        loadHoldoutCases,
      });
    }
    const authorityDelta = evaluation.scoreCards.reduce((sum, card) => sum + Number(card.hardGates.financialAuthorityDelta || 0), 0);
    const rawExecutionMetrics = measureExecution(executionObservations);
    if (rawExecutionMetrics.tokenUsage !== null) totalTokenUsage += rawExecutionMetrics.tokenUsage;
    const budgetExceeded = totalTokenUsage > budget.maxTotalTokens || sandboxElapsedMs > budget.maxSandboxMinutes * 60 * 1000;
    const hardGatePassed = evaluation.passed
      && reliabilityEvaluation.passed
      && reliabilityEvaluation.candidateReliabilityCoverageComplete === true
      && authorityDelta === 0
      && !budgetExceeded
      && holdoutAvailable
      && holdout?.passed === true;
    const feedback = buildGepaFeedback({
      candidateId,
      evaluation,
      reliability: reliabilityEvaluation,
      authorityDelta,
      failures: [...failureReports, ...(budgetExceeded ? ['EVOLUTION_BUDGET_EXCEEDED'] : [])],
      sandbox,
    });
    assertGepaFeedbackSafe(feedback);
    const evaluationHash = hashEvaluationData({ evaluation, reliability: reliabilityEvaluation, holdout: holdout ? { passed: holdout.passed } : null });
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
      status: hardGatePassed ? 'SHADOW_READY' : (evaluation.passed && reliabilityEvaluation.passed && !budgetExceeded && !holdoutAvailable ? 'HOLDOUT_PENDING' : 'REJECTED'),
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
      holdout: holdout ? { passed: holdout.passed, scoreCards: holdout.scoreCards?.map(card => ({ passed: card.passed })) } : null,
      sandbox,
      feedback,
      hardGatePassed,
      financialAuthorityDelta: authorityDelta,
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
    authorityRejections: records.filter(record => record.financialAuthorityDelta !== 0).length,
  });
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
    financialAuthorityDelta: records.reduce((sum, record) => sum + record.financialAuthorityDelta, 0),
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
      holdoutHash: manifest.holdoutHash,
      financialAuthorityDelta: report.financialAuthorityDelta,
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
