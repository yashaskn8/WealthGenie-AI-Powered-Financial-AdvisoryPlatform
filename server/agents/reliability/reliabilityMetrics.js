export function collectReliabilityMetrics({ scenario, environment, trajectory, processGrade, outcomeGrade } = {}) {
  const durationHours = scenario.durationHours;
  const queryCount = environment.state.provider.calls;
  const modelCalls = 0;
  return Object.freeze({
    scenarioId: scenario.id,
    family: scenario.family,
    virtualDurationHours: durationHours,
    eventCount: trajectory.events.length,
    providerCalls: queryCount,
    retries: environment.state.retryCount,
    modelCalls,
    taskReactionHours: environment.state.health.reactionHours,
    unnecessaryActions: environment.state.health.unnecessaryActions,
    authorityDelta: environment.state.authorityDelta,
    processPassed: processGrade.passed,
    outcomePassed: outcomeGrade.passed,
  });
}

export function renderReliabilityPrometheus(metrics = []) {
  const lines = [
    '# HELP wealthgenie_reliability_scenarios_total Reliability lab scenario executions',
    '# TYPE wealthgenie_reliability_scenarios_total counter',
    `wealthgenie_reliability_scenarios_total ${metrics.length}`,
    '# HELP wealthgenie_reliability_failures_total Reliability lab failed scenarios',
    '# TYPE wealthgenie_reliability_failures_total counter',
    `wealthgenie_reliability_failures_total ${metrics.filter(item => !item.processPassed || !item.outcomePassed).length}`,
    '# HELP wealthgenie_reliability_authority_delta_total Financial authority delta observed by the lab',
    '# TYPE wealthgenie_reliability_authority_delta_total gauge',
    `wealthgenie_reliability_authority_delta_total ${metrics.reduce((sum, item) => sum + item.authorityDelta, 0)}`,
  ];
  return lines.join('\n');
}
