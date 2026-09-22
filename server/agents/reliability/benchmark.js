function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

export function durationBucket(hours) {
  if (hours <= 24) return 'SHORT';
  if (hours <= 24 * 30) return 'MEDIUM';
  return 'LONG';
}

export function buildReliabilityBenchmark(results = []) {
  const metrics = results.map(result => result.metrics).filter(Boolean);
  const queries = metrics.map(item => item.providerCalls);
  const modelCalls = metrics.map(item => item.modelCalls);
  const passed = results.filter(result => result.scorecard?.passed).length;
  const buckets = Object.fromEntries(['SHORT', 'MEDIUM', 'LONG'].map(bucket => [bucket, { total: 0, passed: 0 }]));
  results.forEach(result => {
    const bucket = durationBucket(result.metrics.virtualDurationHours);
    buckets[bucket].total += 1;
    if (result.scorecard?.passed) buckets[bucket].passed += 1;
  });
  return Object.freeze({
    scenarioCount: results.length,
    passRate: results.length ? passed / results.length : 1,
    buckets,
    meanQueries: queries.length ? queries.reduce((sum, value) => sum + value, 0) / queries.length : 0,
    p95Queries: percentile(queries, 0.95) || 0,
    meanModelCalls: modelCalls.length ? modelCalls.reduce((sum, value) => sum + value, 0) / modelCalls.length : 0,
    p95ModelCalls: percentile(modelCalls, 0.95) || 0,
    authorityDelta: metrics.reduce((sum, item) => sum + item.authorityDelta, 0),
  });
}

export function assertDeterministicReplay(first, second) {
  if (first?.trajectory?.contentHash !== second?.trajectory?.contentHash || first?.scorecard?.passed !== second?.scorecard?.passed) {
    const error = new Error('Reliability replay is not deterministic.');
    error.code = 'NON_DETERMINISTIC_RELIABILITY_REPLAY';
    throw error;
  }
  return true;
}
