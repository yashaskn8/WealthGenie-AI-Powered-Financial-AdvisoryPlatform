import crypto from 'node:crypto';
import { createOptimizerEvaluationManifest, evaluateCandidate, AGENT_EVALUATION_VERSION } from '../evals/evaluationV2.js';
import { createScaffoldSpec, assertScaffoldSpecSafe } from './scaffoldSpec.js';
import { invokePlanReviewGraph } from '../planReview/planReviewGraph.js';

export const EVOLUTION_VERSION = 'scaffold-evolution-1.0.0';

export function createPlanReviewScaffoldRunner({ dependencies = {} } = {}) {
  return async ({ candidate, caseDefinition } = {}) => {
    if (typeof dependencies.captureFinancialAuthority !== 'function') {
      const error = new Error('Closed-loop evaluation requires an authority snapshot provider.');
      error.code = 'AUTHORITY_MEASUREMENT_REQUIRED';
      throw error;
    }
    const fixture = caseDefinition?.fixture;
    if (!fixture?.context || !fixture.context.profile) {
      const error = new Error('Closed-loop evaluation requires a sanitized profile fixture.');
      error.code = 'EVALUATION_FIXTURE_REQUIRED';
      throw error;
    }
    const before = await dependencies.captureFinancialAuthority({ caseDefinition, phase: 'before' });
    const review = await invokePlanReviewGraph({
      userId: String(fixture.userId || 'evaluation-user'),
      profileId: String(fixture.profileId || fixture.context.profile.profileId || 'evaluation-profile'),
      runId: `evaluation-${crypto.randomUUID()}`,
      dependencies: {
        ...dependencies,
        scaffoldSpec: candidate,
        loadPlanReviewContext: async () => fixture.context,
        persistAgentRun: undefined,
        modelPlannerEnabled: false,
      },
    });
    const after = await dependencies.captureFinancialAuthority({ caseDefinition, phase: 'after' });
    const financialAuthorityDelta = before === after ? 0 : 1;
    return {
      result: review,
      trajectory: review.trajectory || [],
      financialAuthorityDelta,
      authorityMeasurementState: 'MEASURED',
    };
  };
}

export function createOfflineEvolutionRun({ baseSpec, cases = [], enabled = false, candidateFactory = null, runner = null } = {}) {
  if (!enabled) return { status: 'DISABLED', reason: 'AGENT_EVOLUTION_ENABLED is false.' };
  assertScaffoldSpecSafe(baseSpec);
  const manifest = createOptimizerEvaluationManifest({ cases, datasetVersion: EVOLUTION_VERSION, source: 'offline-sanitized' });
  const trainValidation = [...manifest.partitions.train, ...manifest.partitions.validation];
  const candidate = typeof candidateFactory === 'function'
    ? candidateFactory(baseSpec)
    : createScaffoldSpec({ ...baseSpec, version: `${baseSpec.version}-candidate-${crypto.randomUUID().slice(0, 8)}`, parentVersion: baseSpec.version });
  assertScaffoldSpecSafe(candidate);
  const hasFixtureResults = trainValidation.every(item => item && item.result);
  if (typeof runner !== 'function' && !hasFixtureResults) {
    const error = new Error('A real closed-loop evolution runner is required; expected outputs cannot be substituted.');
    error.code = 'EVOLUTION_RUNNER_REQUIRED';
    throw error;
  }
  const evaluation = evaluateCandidate({
    candidateId: candidate.contentHash,
    cases: trainValidation,
    evaluator: item => typeof runner === 'function'
      ? runner({ candidate, caseDefinition: item })
      : { result: item.result, trajectory: item.trajectory || [] },
  });
  return {
    status: 'COMPLETED',
    evolutionVersion: EVOLUTION_VERSION,
    evaluationVersion: AGENT_EVALUATION_VERSION,
    baseScaffoldVersion: baseSpec.version,
    candidate,
    evaluation,
    holdoutSealed: true,
    datasetHash: manifest.datasetHash,
    holdoutHash: manifest.holdoutHash,
  };
}
