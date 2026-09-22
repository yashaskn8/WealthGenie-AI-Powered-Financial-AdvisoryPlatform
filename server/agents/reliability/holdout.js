import crypto from 'node:crypto';

function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

export function createReliabilityHoldoutManifest({ scenarios = [], version = 'reliability-holdout-1' } = {}) {
  const ids = scenarios.map(item => item.id).sort();
  return Object.freeze({ version, scenarioCount: ids.length, scenarioIdsHash: hash(ids), sealed: true });
}

export function evaluateReliabilityHoldout({ scenarios = [], runner }) {
  if (typeof runner !== 'function') throw new Error('A holdout runner is required.');
  const results = scenarios.map(scenario => runner(scenario));
  return Object.freeze({
    sealed: true,
    scenarioCount: results.length,
    passed: results.every(result => result.scorecard?.passed),
    hardFailures: results.reduce((sum, result) => sum + (result.scorecard?.criticalFailures?.length || 0), 0),
    authorityDelta: results.reduce((sum, result) => sum + (result.metrics?.authorityDelta || 0), 0),
  });
}

export function assertReliabilityHoldoutIsolation(value) {
  if (value && (value.expected || value.answerKey || value.scenarios?.some(item => item.partition === 'holdout'))) {
    const error = new Error('Reliability holdout answer keys are sealed from optimizers.');
    error.code = 'RELIABILITY_HOLDOUT_LEAK';
    throw error;
  }
  return true;
}
