import { evaluateHoldoutCandidateAsync } from './evaluationV2.js';

/**
 * The optimizer never imports or receives holdout rows. Deployment/CI may
 * provide a sealed loader here, but the loader remains outside the optimizer
 * process and is responsible for returning only holdout partition cases.
 */
export async function verifyCandidateAgainstSealedHoldout({ candidateId, runner, loadHoldoutCases } = {}) {
  if (typeof runner !== 'function' || typeof loadHoldoutCases !== 'function') {
    const error = new Error('A sealed holdout loader and real candidate runner are required.');
    error.code = 'SEALED_HOLDOUT_VERIFIER_UNAVAILABLE';
    throw error;
  }
  const cases = await loadHoldoutCases();
  if (!Array.isArray(cases) || cases.length === 0 || cases.some(item => item?.partition !== 'holdout')) {
    const error = new Error('Sealed holdout data is invalid or unavailable.');
    error.code = 'SEALED_HOLDOUT_INVALID';
    throw error;
  }
  return evaluateHoldoutCandidateAsync({
    candidateId,
    cases,
    evaluator: item => runner({ caseDefinition: item }),
  });
}
