import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CURRENT_PROMPT_BUNDLE } from '../agents/evolution/promptBundle.js';
import { createScaffoldSpec } from '../agents/evolution/scaffoldSpec.js';
import { createEvolutionSandboxProvider } from '../agents/evolution/sandboxProvider.js';
import { runGepaProposalBridge } from '../agents/evolution/gepaBridge.js';
import { runGovernedEvolution } from '../agents/evolution/governedEvolution.js';
import { createPlanReviewScaffoldRunner } from '../agents/evolution/scaffoldEvolution.js';
import { canonicalSha256 } from '../utils/canonicalJson.js';
import { buildRecommendationProfileHash } from '../services/recommendationProfile.js';

const profileId = '64b000000000000000000001';
const userId = '64b000000000000000000010';
const profile = {
  _id: profileId,
  version: 2,
  monthlyTakeHome: 100000,
  monthlySavings: 30000,
  age: 32,
  riskTolerance: 'Moderate',
  soldPropertyProceeds: null,
  hasLumpSum: false,
  lumpSumAmount: 0,
  liquidSavings: 100000,
  emiBurdenPct: null,
  financialDependents: 1,
  emergencyFundMonths: 6,
  investmentGoals: ['Wealth Growth'],
  investmentHorizonYears: 10,
  finalSuitabilityRisk: 'Moderate',
  suitabilityReasonCodes: ['RISK_TOLERANCE_MATCH'],
};

const recommendation = {
  _id: '64b000000000000000000002',
  profileId,
  userId,
  modelVersion: 'model-1.0.0',
  profileInputHash: buildRecommendationProfileHash(profile, { modelVersion: 'model-1.0.0' }),
  generatedAt: new Date('2026-09-01T00:00:00.000Z'),
  responseSnapshot: { recommendation: { instruments: [] } },
  currentAllocationSource: 'ORIGINAL_RECOMMENDATION',
  instruments: [],
};

const context = {
  profile,
  profileContext: { age: 32, riskTolerance: 'Moderate', investmentHorizonYears: 10 },
  recommendation,
  recommendationSummary: { instruments: [] },
  freshness: { fresh: true, reasonCodes: [] },
};

function parseArgs(argv) {
  const args = { gepaProvider: 'dspy', sandboxMode: 'auto', outputDir: 'evolution-report' };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--gepa-provider') args.gepaProvider = argv[++index];
    else if (flag === '--sandbox-mode') args.sandboxMode = argv[++index];
    else if (flag === '--output-dir') args.outputDir = argv[++index];
    else throw new Error(`Unknown experiment argument: ${flag}`);
  }
  if (!['dspy', 'fixture'].includes(args.gepaProvider)) throw new Error('GEPA provider must be dspy or fixture.');
  if (!['auto', 'fixture', 'e2b'].includes(args.sandboxMode)) throw new Error('Sandbox mode must be auto, fixture, or e2b.');
  if (!args.outputDir || path.isAbsolute(args.outputDir) || args.outputDir.split(/[\\/]/).includes('..')) throw new Error('Experiment output directory must be a relative path without traversal.');
  return args;
}

function assertManualFlags() {
  const required = ['AGENT_SELF_EVOLUTION_ENABLED', 'AGENT_SELF_EVOLUTION_GEPA_ENABLED', 'AGENT_SELF_EVOLUTION_LIVE_ENABLED'];
  for (const name of required) if (process.env[name] !== 'true') {
    const error = new Error(`${name}=true is required for a manual evolution experiment.`);
    error.code = 'EVOLUTION_FEATURE_FLAG_REQUIRED';
    throw error;
  }
  if (process.env.AGENT_SELF_EVOLUTION_AUTO_PROMOTION_ENABLED === 'true') {
    const error = new Error('Automatic self-evolution promotion is permanently disabled.');
    error.code = 'AUTO_PROMOTION_DISABLED';
    throw error;
  }
}

function requireLiveGepaCredentials() {
  const model = process.env.AGENT_EVOLUTION_TASK_MODEL || process.env.DSPY_LM_MODEL || process.env.AGENT_EVOLUTION_REFLECTION_MODEL;
  const reflectionModel = process.env.AGENT_EVOLUTION_REFLECTION_MODEL || process.env.DSPY_LM_MODEL || model;
  const key = process.env.AGENT_EVOLUTION_MODEL_API_KEY || process.env.DSPY_LM_API_KEY;
  if (!model || !reflectionModel || !key) {
    const error = new Error('Live GEPA requires AGENT_EVOLUTION_TASK_MODEL/DSPY_LM_MODEL, AGENT_EVOLUTION_REFLECTION_MODEL, and a model API key.');
    error.code = 'LIVE_GEPA_CREDENTIAL_REQUIRED';
    throw error;
  }
  return { model, reflectionModel };
}

function getSandbox(args) {
  const hasE2bKey = Boolean(process.env.E2B_API_KEY);
  const useE2b = args.sandboxMode === 'e2b' || (args.sandboxMode === 'auto' && hasE2bKey);
  if (useE2b && !hasE2bKey) {
    const error = new Error('E2B_API_KEY is required for explicit live E2B mode.');
    error.code = 'LIVE_E2B_CREDENTIAL_REQUIRED';
    throw error;
  }
  if (useE2b && process.env.AGENT_SELF_EVOLUTION_E2B_ENABLED !== 'true') {
    const error = new Error('AGENT_SELF_EVOLUTION_E2B_ENABLED=true is required for live E2B mode.');
    error.code = 'E2B_FEATURE_FLAG_REQUIRED';
    throw error;
  }
  if (useE2b) return { provider: createEvolutionSandboxProvider({ provider: 'e2b', enabled: true }), liveE2BExecuted: true, sandboxMode: 'e2b', sandboxNotice: null };
  return {
    provider: createEvolutionSandboxProvider({ provider: 'fixture', execute: async () => ({ stdout: 'fixture-candidate-sandbox', testResults: { passed: true } }) }),
    liveE2BExecuted: false,
    sandboxMode: 'fixture',
    sandboxNotice: 'LIVE E2B NOT EXECUTED',
  };
}

function buildCases() {
  return ['train', 'validation', 'holdout'].map(partition => ({
    id: `${partition}-researchmesh-fixture`,
    partition,
    expectedAction: null,
    groundingRequired: false,
    maxTrajectoryEvents: 100,
    fixture: { userId, profileId, context },
  }));
}

function markdownReport(report) {
  return [
    '# Governed Agent Evolution Report',
    '',
    `- Status: ${report.status}`,
    `- GEPA provider: ${report.gepaProvider}`,
    `- Live GEPA executed: ${report.liveGepaExecuted}`,
    `- Sandbox mode: ${report.sandboxMode}`,
    `- Live E2B executed: ${report.liveE2BExecuted}`,
    `- Candidate count: ${report.candidateCount}`,
    `- Financial authority delta: ${report.financialAuthorityDelta}`,
    `- Pareto candidates: ${report.paretoCandidateIds.join(', ') || 'none'}`,
    `- Sandbox notice: ${report.sandboxNotice || 'none'}`,
    '',
    'Candidate statuses:',
    ...report.candidates.map(candidate => `- ${candidate.candidateId}: ${candidate.status}; hardGate=${candidate.hardGatePassed}`),
    '',
    'Automatic promotion: disabled.',
  ].join('\n');
}

async function writeReport(outputDir, report) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'evolution-report.json'), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8' });
  await writeFile(path.join(outputDir, 'evolution-report.md'), `${markdownReport(report)}\n`, { encoding: 'utf8' });
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  assertManualFlags();
  const liveModels = args.gepaProvider === 'dspy' ? requireLiveGepaCredentials() : { model: null, reflectionModel: null };
  const sandbox = getSandbox(args);
  const cases = buildCases();
  const baseSpec = createScaffoldSpec({ version: 'experiment-base', promptBundle: CURRENT_PROMPT_BUNDLE });
  const safeOptimizerCases = cases.filter(item => item.partition !== 'holdout').map(item => ({
    id: item.id,
    partition: item.partition,
    expectedAction: item.expectedAction,
    safeSummary: 'Sanitized bounded PlanReview fixture for offline optimizer evaluation.',
  }));
  const proposals = await runGepaProposalBridge({
    basePromptBundle: CURRENT_PROMPT_BUNDLE,
    allowedMutationSurfaces: ['promptBundle.plannerInstruction'],
    trainCases: safeOptimizerCases.filter(item => item.partition === 'train'),
    validationCases: safeOptimizerCases.filter(item => item.partition === 'validation'),
    failureFeedback: ['grounding passed', 'candidate must preserve financial authority delta zero', 'use the minimum safe read-only checks'],
    budget: { maxCandidates: Math.min(12, Math.max(1, Number(process.env.EVOLUTION_MAX_CANDIDATES || 2))), maxMetricCalls: 12 },
    optimizerConfig: { provider: args.gepaProvider, taskModel: liveModels.model, reflectionModel: liveModels.reflectionModel },
    pythonWorkingDirectory: path.resolve('ml-service'),
  });
  const runner = createPlanReviewScaffoldRunner({ dependencies: {
    captureFinancialAuthority: async () => ({ allocation: [{ id: 'fixture-asset', weight: 1 }], suitability: 'Moderate' }),
    plannerProvider: { generate: async () => ({ text: '{"checks":["get_current_profile_context"]}' }) },
    loadPlanReviewContext: async () => context,
    explanationProviders: [],
    persistAgentRun: async () => undefined,
    timeoutMs: 2000,
    toolTimeoutMs: 100,
  } });
  const result = await runGovernedEvolution({
    baseSpec,
    cases,
    enabled: true,
    proposals,
    runner,
    sandboxProvider: sandbox.provider,
    candidateCaseFactory: async () => ({ fixture: { userId, profileId, context } }),
    loadHoldoutCases: async () => [cases.find(item => item.partition === 'holdout')],
    budget: { maxCandidates: proposals.length || 1, maxMetricCalls: 12, maxSandboxRuns: 20 },
  });
  const report = {
    status: result.status,
    generatedAt: new Date().toISOString(),
    experimentHash: canonicalSha256({ candidates: result.candidateRecords.map(item => item.candidateId), paretoCandidateIds: result.paretoCandidateIds }),
    gepaProvider: args.gepaProvider,
    liveGepaExecuted: args.gepaProvider === 'dspy',
    sandboxMode: sandbox.sandboxMode,
    liveE2BExecuted: sandbox.liveE2BExecuted,
    sandboxNotice: sandbox.sandboxNotice,
    candidateCount: result.candidateRecords.length,
    paretoCandidateIds: result.paretoCandidateIds,
    financialAuthorityDelta: result.financialAuthorityDelta,
    candidates: result.candidateRecords.map(item => ({
      candidateId: item.candidateId,
      status: item.status,
      hardGatePassed: item.hardGatePassed,
      financialAuthorityDelta: item.financialAuthorityDelta,
      evaluationPassed: item.evaluation.passed,
      reliabilityPassed: item.reliability.passed,
      candidateReliabilityCoverageComplete: item.reliability.candidateReliabilityCoverageComplete,
      reliabilityFailures: item.reliability.criticalFailures,
      holdoutPassed: item.holdout?.passed === true,
      evaluationCards: item.evaluation.scoreCards.map(card => ({ partition: card.partition, passed: card.passed, scores: card.scores, hardGates: card.hardGates })),
      evaluationHash: item.lineage.evaluationHash,
    })),
  };
  await writeReport(args.outputDir, report);
  return report;
}

try {
  const report = await run();
  console.log(JSON.stringify({ status: report.status, candidateCount: report.candidateCount, liveGepaExecuted: report.liveGepaExecuted, liveE2BExecuted: report.liveE2BExecuted }));
} catch (error) {
  const safeCode = error?.code || 'EVOLUTION_EXPERIMENT_FAILED';
  console.error(`${safeCode}: ${error?.message || 'Evolution experiment failed.'}`);
  process.exitCode = 1;
}
