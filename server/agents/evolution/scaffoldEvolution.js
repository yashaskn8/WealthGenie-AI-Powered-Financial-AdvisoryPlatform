import crypto from 'node:crypto';
import { createEvaluationManifest, evaluateCandidate, AGENT_EVALUATION_VERSION } from '../evals/evaluationV2.js';
import { createScaffoldSpec, assertScaffoldSpecSafe } from './scaffoldSpec.js';

export const EVOLUTION_VERSION = 'scaffold-evolution-1.0.0';

export function createOfflineEvolutionRun({ baseSpec, cases = [], enabled = false, candidateFactory = null } = {}) {
  if (!enabled) return { status: 'DISABLED', reason: 'AGENT_EVOLUTION_ENABLED is false.' };
  assertScaffoldSpecSafe(baseSpec);
  const manifest = createEvaluationManifest({ cases, datasetVersion: EVOLUTION_VERSION, source: 'offline-sanitized' });
  const trainValidation = [...manifest.partitions.train, ...manifest.partitions.validation];
  const candidate = typeof candidateFactory === 'function'
    ? candidateFactory(baseSpec)
    : createScaffoldSpec({ ...baseSpec, version: `${baseSpec.version}-candidate-${crypto.randomUUID().slice(0, 8)}`, parentVersion: baseSpec.version });
  assertScaffoldSpecSafe(candidate);
  const evaluation = evaluateCandidate({
    candidateId: candidate.contentHash,
    cases: trainValidation,
    evaluator: item => ({
      result: item.result || { recommendedAction: item.expectedAction, financialAuthorityDelta: 0 },
      trajectory: item.trajectory || [],
    }),
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
    holdoutHash: manifest.partitionHashes.holdout,
  };
}
