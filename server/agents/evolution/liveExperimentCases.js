import { canonicalSha256 } from '../../utils/canonicalJson.js';

/**
 * A train case can be built from the local sanitized fixture. Validation must
 * be independently supplied; the same fixture is never relabelled as both.
 * Holdout must arrive as a separately signed external bundle.
 */
export function buildLiveOptimizerCases({ userId, profileId, context, validationContext = null } = {}) {
  if (!userId || !profileId || !context || typeof context !== 'object') {
    throw new TypeError('Live optimizer cases require an isolated sanitized fixture.');
  }
  const cases = [{
    id: 'train-researchmesh-fixture',
    partition: 'train',
    expectedAction: 'NONE',
    groundingRequired: false,
    maxTrajectoryEvents: 100,
    fixture: { userId, profileId, context },
  }];
  if (validationContext && typeof validationContext === 'object'
      && canonicalSha256(validationContext) !== canonicalSha256(context)) {
    cases.push({
      id: 'validation-independent-fixture',
      partition: 'validation',
      expectedAction: 'NONE',
      groundingRequired: false,
      maxTrajectoryEvents: 100,
      fixture: { userId, profileId, context: validationContext },
    });
  }
  return cases;
}
/**
 * Build only optimizer-visible training/validation bridge inputs. Feedback is
 * intentionally empty until governed evaluations exist; caller-authored text
 * must never masquerade as evaluation output.
 */
export function buildLiveGepaProposalOptions({ cases = [], maxCandidates = 2, optimizerConfig = {}, pythonWorkingDirectory = null } = {}) {
  const safeCases = cases.filter(item => item?.partition === 'train' || item?.partition === 'validation').map(item => ({
    id: item.id,
    partition: item.partition,
    expectedAction: item.expectedAction,
    safeSummary: 'Sanitized bounded PlanReview fixture for optimizer evaluation.',
  }));
  const trainCases = safeCases.filter(item => item.partition === 'train');
  const validationCases = safeCases.filter(item => item.partition === 'validation');
  const originalTrainCases = cases.filter(item => item?.partition === 'train');
  const originalValidationCases = cases.filter(item => item?.partition === 'validation');
  const trainFixtures = new Set(originalTrainCases.map(item => canonicalSha256(item.fixture?.context ?? item.fixture ?? item)));
  const validationFixtures = new Set(originalValidationCases.map(item => canonicalSha256(item.fixture?.context ?? item.fixture ?? item)));
  const overlap = [...trainFixtures].some(fingerprint => validationFixtures.has(fingerprint));
  if (!trainCases.length || !validationCases.length || overlap) {
    const error = new TypeError('Live GEPA requires non-overlapping train and validation fixtures.');
    error.code = 'LIVE_OPTIMIZER_PARTITIONS_NOT_INDEPENDENT';
    throw error;
  }
  const requestedCandidates = Number(maxCandidates);
  return {
    allowedMutationSurfaces: ['promptBundle.plannerInstruction'],
    trainCases,
    validationCases,
    failureFeedback: [],
    budget: {
      maxCandidates: Math.min(12, Math.max(1, Number.isInteger(requestedCandidates) ? requestedCandidates : 2)),
      maxMetricCalls: 12,
    },
    optimizerConfig,
    pythonWorkingDirectory,
  };
}
